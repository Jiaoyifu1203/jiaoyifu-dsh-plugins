/**
 * jiaoyifu-skill-router · 技能自动分类 + 项目实时路由
 *
 * 升级自开源生态（dsh-skillport 的导入思路 + dsh-skills 的全局技能库思路）：
 * 1. 自动分类 —— 在 agent scope 下取技能目录（原生 skill 工具同款 lookup），
 *    按用途归入 14 个分类，落盘 ~/.dsh/skill-catalog.json + skill-catalog.md（人读）；
 * 2. 实时路由 —— skill_route 工具按当前任务打分排序；agent/pre-step 钩子
 *    在会话首轮 / 话题变化时自动注入 ≤3 行技能提示（阈值+次数双限，省 token）；
 * 3. 用量学习 —— 统计 skill 工具的实际调用，路由时加权，越用越准；
 * 4. 目录速查 —— skill_catalog 工具按分类返回紧凑清单；
 * 5. 工具自治 —— 任务是在维护插件系统本身时，提示「直接改源码」，不推业务技能；
 * 6. LLM 兜底 —— 词面打分低于阈值时，用一次廉价模型调用重排候选（缓存去重）。
 *
 * 注意：技能 provider 挂在 agent preset 层，宿主 scope 的 ctx.skills.list() 恒为空，
 * 因此所有目录读取都带 { scope: agent, cwd } 的 lookup（与官方 skill 工具一致）。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { classify } from './taxonomy.ts'
import { isAutonomyTask, routeSkills, topicFingerprint, withLlmFallback, type RankedSkill, type SkillEntry, type SkillUsage } from './router.ts'
import { catalogPaths, loadCatalog, saveCatalogDebounced, type Catalog } from './persist.ts'

export const name = 'jiaoyifu-skill-router'
export const inject = ['skills', 'tools', 'llm']

export interface Config {
  /** 是否自动注入技能路由提示（默认开） */
  autoInject?: boolean
  /** 常规注入阈值（0-100），低于不注入（默认 30） */
  injectThreshold?: number
  /** 会话首条消息的注入阈值（默认 20，首轮提示价值更高） */
  firstTurnThreshold?: number
  /** 每个会话最多注入次数（默认 5，防刷屏防 token 浪费） */
  maxInjectionsPerSession?: number
  /** 提示文本最大长度（默认 260 字符） */
  hintMaxChars?: number
  /** 提示中最多列出的技能数（默认 3） */
  topK?: number
  /** 目录文件存放目录；留空默认 ~/.dsh */
  catalogDir?: string
  /** LLM 兜底重排开关（默认开） */
  llmFallback?: boolean
  /** 词面 Top1 得分 ≤ 该阈值（0-100）时触发兜底重排（默认 30） */
  llmFallbackThreshold?: number
  /** 兜底模型 provider（默认 deepseek-official） */
  llmProvider?: string
  /** 兜底模型名，用便宜档（默认 deepseek-v4-flash） */
  llmModel?: string
  /** 主模型失败时的 fallback（默认 deepseek-v4-pro） */
  llmFallbackModel?: string
  /** 兜底调用超时（毫秒，默认 20s） */
  llmTimeoutMs?: number
}

export const Config: Schema<Config> = Schema.object({
  autoInject: Schema.boolean().default(true),
  injectThreshold: Schema.number().default(30),
  firstTurnThreshold: Schema.number().default(20),
  maxInjectionsPerSession: Schema.number().default(5),
  hintMaxChars: Schema.number().default(260),
  topK: Schema.number().default(3),
  catalogDir: Schema.string().default(''),
  llmFallback: Schema.boolean().default(true),
  llmFallbackThreshold: Schema.number().default(30),
  llmProvider: Schema.string().default('deepseek-official'),
  llmModel: Schema.string().default('deepseek-v4-flash'),
  llmFallbackModel: Schema.string().default('deepseek-v4-pro'),
  llmTimeoutMs: Schema.number().default(20000),
})

interface SessionState {
  fingerprint: string
  injections: number
}

interface CatalogCache {
  catalog: Catalog
  cwd: string
  builtAt: number
}

const CACHE_TTL_MS = 60_000

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

/** 从消息内容块里抽文本。 */
function textOf(message: any): string {
  const content = message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('\n')
  }
  return ''
}

export function apply(ctx: Context, config: Config): void {
  const { json: catalogJson, md: catalogMd } = catalogPaths(config.catalogDir ?? '')
  const threshold = config.injectThreshold ?? 30
  const firstThreshold = config.firstTurnThreshold ?? 20
  const maxInjections = config.maxInjectionsPerSession ?? 5
  const hintMaxChars = config.hintMaxChars ?? 260
  const topK = clampNum(config.topK, 1, 5, 3)
  const llmFallback = config.llmFallback !== false
  const llmFallbackThreshold = config.llmFallbackThreshold ?? 30
  const llmProvider = config.llmProvider ?? 'deepseek-official'
  const llmModel = config.llmModel ?? 'deepseek-v4-flash'
  const llmFallbackModel = config.llmFallbackModel ?? 'deepseek-v4-pro'
  const llmTimeoutMs = config.llmTimeoutMs ?? 20000

  /** 会话级注入状态 */
  const sessionStates = new Map<string, SessionState>()
  /** 用量表：技能名 → 统计（跨会话、跨 scope 共享） */
  const usageMap = new Map<string, SkillUsage>()
  /** 按 agent 缓存的分类目录 */
  const catalogs = new Map<string, CatalogCache>()

  // ---------- 目录构建（agent scope 下） ----------
  async function ensureCatalog(agent: any, cwd: any, signal: any): Promise<Catalog | null> {
    const key = String(agent?.id ?? 'global')
    const cwdKey = typeof cwd === 'string' ? cwd : ''
    const cached = catalogs.get(key)
    if (cached && cached.cwd === cwdKey && Date.now() - cached.builtAt < CACHE_TTL_MS) return cached.catalog
    try {
      const summaries: any[] = await ctx.skills.list({
        scope: agent,
        cwd: cwdKey || undefined,
        signal,
      })
      const entries: SkillEntry[] = []
      for (const s of summaries) {
        const cls = classify(s)
        entries.push({
          name: s.name,
          description: s.description ?? '',
          whenToUse: s.whenToUse,
          category: cls.category,
          categoryLabel: cls.label,
          source: s.source,
          provider: s.provider,
          usage: usageMap.get(s.name) ?? { count: 0 },
        })
      }
      entries.sort((a, b) => a.name.localeCompare(b.name))
      const catCounts = new Map<string, { key: string; label: string; count: number }>()
      for (const e of entries) {
        const cur = catCounts.get(e.category) ?? { key: e.category, label: e.categoryLabel, count: 0 }
        cur.count += 1
        catCounts.set(e.category, cur)
      }
      const catalog: Catalog = {
        updatedAt: new Date().toISOString(),
        total: entries.length,
        categories: [...catCounts.values()].sort((a, b) => b.count - a.count),
        skills: entries,
      }
      catalogs.set(key, { catalog, cwd: cwdKey, builtAt: Date.now() })
      saveCatalogDebounced(catalogJson, catalogMd, catalog)
      if (entries.length > 0) {
        console.log(`[jiaoyifu-skill-router] 技能目录已重建（${key.slice(0, 8)}）：${entries.length} 个技能 / ${catCounts.size} 个分类`)
      }
      return catalog
    } catch (err) {
      console.error('[jiaoyifu-skill-router] 重建技能目录失败:', err)
      return cached?.catalog ?? null
    }
  }

  // skills/change 使全部缓存失效（事件无过滤，宿主 scope 也能收到）
  ctx.on('skills/change', (): void => {
    catalogs.clear()
  })

  // 启动加载上次目录：只为恢复用量表（技能列表本身要按 scope 现取）
  void loadCatalog(catalogJson).then((prev) => {
    if (prev) {
      for (const s of prev.skills) {
        if (s.usage) usageMap.set(s.name, s.usage)
      }
      console.log(`[jiaoyifu-skill-router] 已恢复用量记录：${usageMap.size} 个技能`)
    }
  })

  // ---------- 用量学习 ----------
  function bumpUsage(skillName: string): void {
    const cur = usageMap.get(skillName) ?? { count: 0 }
    cur.count += 1
    cur.lastUsedAt = Date.now()
    usageMap.set(skillName, cur)
    for (const entry of catalogs.values()) {
      const skill = entry.catalog.skills.find((s) => s.name === skillName)
      if (skill) skill.usage = cur
    }
    const latest = [...catalogs.values()].sort((a, b) => b.builtAt - a.builtAt)[0]
    if (latest) saveCatalogDebounced(catalogJson, catalogMd, latest.catalog)
  }

  ctx.on('tools/result', (exec: any): void => {
    if (exec?.name === 'skill' && typeof exec?.arguments?.name === 'string') {
      bumpUsage(exec.arguments.name)
    }
  })

  // ---------- LLM 兜底：词面低置信时的一次廉价重排 ----------
  const rerankCache = new Map<string, string[]>()
  const RERANK_CACHE_MAX = 64

  /** 从模型输出里按行提取候选技能名（容忍序号/符号/解释文字）。 */
  function parseOrder(text: string, candidates: RankedSkill[]): string[] | null {
    const mentioned: string[] = []
    for (const line of text.split(/\r?\n/)) {
      const first = line.replace(/^[-*\d.\s、]+/, '').trim()
      const token = first.split(/[｜|\s(（,:，]/)[0].replace(/[`'"「」]/g, '').trim()
      if (candidates.some((c) => c.name === token)) mentioned.push(token)
    }
    return mentioned.length > 0 ? mentioned : null
  }

  /** 词面 Top1 得分 ≤ 阈值时，用一次廉价模型调用重排候选；失败/未命中退回 null。 */
  async function llmRerank(query: string, candidates: RankedSkill[], exec: any): Promise<RankedSkill[] | null> {
    if (!llmFallback) return null
    const top = candidates[0]
    if (!top || top.score > llmFallbackThreshold) return null
    const cacheKey = query.slice(0, 120)
    let order = rerankCache.get(cacheKey)
    if (order === undefined) {
      const prompt = [
        '你是技能路由排序器。给定任务需求与候选技能，只输出你认为最相关的技能名（kebab-case），',
        '按相关性从高到低，每行一个，最多 5 个；不要输出任何解释。',
        '',
        `任务需求：${query.slice(0, 300)}`,
        '',
        '候选技能：',
        ...candidates.map((c, i) => `${i + 1}. ${c.name} — ${(c.description ?? '').replace(/\s+/g, ' ').slice(0, 80)}`),
      ].join('\n')
      const parsed = await withLlmFallback(
        [llmModel, llmFallbackModel],
        async (model) => {
          const assembler = new BlockAssembler()
          const stream = ctx.llm.stream({
            provider: llmProvider,
            model,
            messages: [createUserMessage({
              content: [{ type: 'text', text: prompt }],
              source: { kind: 'plugin', plugin: 'jiaoyifu-skill-router' },
            })],
            maxTokens: 80,
            temperature: 0,
          })
          for await (const chunk of stream) assembler.push(chunk)
          const text = assembler.blocks()
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('\n')
          return parseOrder(text, candidates)
        },
        llmTimeoutMs,
      )
      if (!parsed) return null
      order = parsed
      if (rerankCache.size >= RERANK_CACHE_MAX) {
        const oldest = rerankCache.keys().next().value
        if (oldest !== undefined) rerankCache.delete(oldest)
      }
      rerankCache.set(cacheKey, order)
    }
    // 按模型给出的顺序重建列表；模型没提的候选按原词面序补在尾部
    const byName = new Map(candidates.map((c) => [c.name, c]))
    const reordered: RankedSkill[] = []
    for (const n of order) {
      const c = byName.get(n)
      if (c) {
        reordered.push({ ...c, reasons: [...c.reasons, 'LLM 兜底重排'] })
        byName.delete(n)
      }
    }
    for (const c of candidates) {
      if (byName.has(c.name)) reordered.push(c)
    }
    return reordered.length > 0 ? reordered : null
  }

  /** 工具自治任务报告（skill_route 命中时返回）。 */
  function autonomyReport(query: string): string {
    return [
      '## Skill Router · 工具自治',
      `检测到「维护插件系统本身」类任务：${query.slice(0, 100)}`,
      '',
      '这不是业务任务，业务技能不适用。正确路径：',
      '1. 直接改仓库 plugins/ 下的插件源码（taxonomy.ts / router.ts / index.ts / cordis.yml）；',
      '2. 语法校验：./node_modules/.bin/esbuild <文件> --bundle --external:@deepseek-ai/* --outfile=/dev/null；',
      '3. 改完重启 dsh web 生效（主机插件源码无热加载）。',
      '相关记录见项目 CONTEXT.md「jiaoyifu 插件集」。',
    ].join('\n')
  }

  // ---------- 实时路由：自动注入 ----------
  if (config.autoInject !== false) {
    ctx.on('agent/pre-step', async (payload: any, next: any): Promise<any> => {
      const messages: any[] = Array.isArray(payload?.messages) ? payload.messages : []
      const userTexts = messages
        .filter((m) => m?.source?.kind === 'user')
        .map(textOf)
        .filter(Boolean)
      if (userTexts.length === 0) return next()
      const query = userTexts.join('\n').slice(0, 1500)
      if (!query.trim()) return next()

      const agent = payload?.agent
      const agentId = String(agent?.id ?? 'global')
      const fingerprint = topicFingerprint(query)
      const state = sessionStates.get(agentId)
      const isFirst = !state
      // 话题没变且不是首条 → 不重复注入
      if (!isFirst && state.fingerprint === fingerprint) return next()
      if (state && state.injections >= maxInjections) {
        state.fingerprint = fingerprint
        return next()
      }

      // 工具自治分支：维护插件系统本身 → 提示直接改源码，不推业务技能
      if (isAutonomyTask(query)) {
        const nextState: SessionState = { fingerprint, injections: (state?.injections ?? 0) + 1 }
        sessionStates.set(agentId, nextState)
        return appendHint(next, buildAutonomyHint(hintMaxChars), '工具自治提示')
      }

      const catalog = await ensureCatalog(agent, agent?.session?.header?.cwd, payload?.signal)
      const ranked = catalog ? routeSkills(query, catalog.skills, topK) : []
      const bar = isFirst ? firstThreshold : threshold
      const passed = ranked.length > 0 && ranked[0].score >= bar

      const nextState: SessionState = { fingerprint, injections: state?.injections ?? 0 }
      if (!passed) {
        sessionStates.set(agentId, nextState)
        return next()
      }

      const hint = buildHint(ranked, hintMaxChars)
      nextState.injections += 1
      sessionStates.set(agentId, nextState)
      return appendHint(next, hint, '技能路由提示')
    })

    ctx.on('agent/disposed', (payload: any): void => {
      if (payload?.agent?.id) {
        sessionStates.delete(String(payload.agent.id))
        catalogs.delete(String(payload.agent.id))
      }
    })
  }

  /** 把提示作为 user-role 消息追加进本批次（agent/pre-step enter 决策）。 */
  async function appendHint(next: any, hint: string, summary: string): Promise<any> {
    const downstream = await next()
    if (!downstream || downstream.kind !== 'enter') return downstream
    return {
      kind: 'enter',
      messages: [
        ...(downstream.messages ?? []),
        createUserMessage({
          content: [{ type: 'text', text: hint }],
          source: { kind: 'plugin', plugin: 'jiaoyifu-skill-router', form: 'notice', summary },
        }),
      ],
    }
  }

  function buildHint(ranked: RankedSkill[], maxChars: number): string {
    const parts = ranked.slice(0, topK).map((r) => `${r.name}（${r.categoryLabel}）`)
    const text =
      `【技能路由提示】本任务可能相关的技能：${parts.join('、')}。` +
      `若确实匹配，用 skill 工具加载对应技能的完整说明后再执行；不确定可先调 skill_route 细查。`
    return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`
  }

  function buildAutonomyHint(maxChars: number): string {
    const text =
      '【工具自治】本任务是在维护/修改 jiaoyifu 插件系统本身（技能分类/路由）。' +
      '直接改仓库 plugins/ 下的源码（taxonomy.ts / router.ts / index.ts），esbuild 校验后重启 dsh web 生效；不要调用业务技能。'
    return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`
  }

  // ---------- 工具：skill_route ----------
  ctx.tools.register(defineTool({
    name: 'skill_route',
    description:
      '分析当前任务与技能库的匹配度，返回最相关技能及理由。开始复杂任务前、或不确定该用哪个技能时调用；' +
      '可传 category 限定在某分类内匹配（分类键如 dev/content/design/research/ops/product/office/finance 等）。',
    parameters: {
      query: { type: 'string', required: true, description: '任务描述或用户需求原文，1-2 句即可' },
      top_n: { type: 'number', description: '返回前 N 名，默认 5，最大 10' },
      category: { type: 'string', description: '可选：只在该分类内匹配' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: any, value: any) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: any, exec: any) {
      const query = String(args?.query ?? '')
      // 工具自治：维护插件系统本身 → 返回自治指引，不做业务匹配
      if (isAutonomyTask(query)) return autonomyReport(query)

      const catalog = await ensureCatalog(exec?.agent, exec?.agent?.session?.header?.cwd, exec?.signal)
      if (!catalog || catalog.skills.length === 0) {
        return '技能目录尚未建立（当前 scope 没有可见技能）。检查 ~/.dsh/skills 链接是否已建立，或稍后重试。'
      }
      const topN = clampNum(args?.top_n, 1, 10, 5)
      let pool = catalog.skills
      let scopeNote = `全部 ${catalog.skills.length} 个技能（${catalog.categories.length} 个分类）`
      if (typeof args?.category === 'string' && args.category) {
        pool = pool.filter((s) => s.category === args.category || s.categoryLabel === args.category)
        scopeNote = `分类「${args.category}」内 ${pool.length} 个技能`
      }
      if (pool.length === 0) return '该分类下没有技能。用 skill_catalog 查看全部分类。'

      // 词面初排取 Top-8，低置信时交给 LLM 兜底重排一次
      let ranked = routeSkills(query, pool, Math.min(topN * 2, 8))
      let routeMode = '词面直排（零 token）'
      if (ranked.length > 0) {
        const lexicalTop = ranked[0].score
        const reranked = await llmRerank(query, ranked, exec)
        if (reranked) {
          ranked = reranked.slice(0, topN)
          routeMode = `LLM 兜底重排（词面 Top1=${lexicalTop} ≤ 阈值 ${llmFallbackThreshold}，一次廉价调用）`
        } else {
          ranked = ranked.slice(0, topN)
        }
      }
      if (ranked.length === 0) return `没有技能匹配「${query.slice(0, 80)}」。试试换更具体的描述，或用 skill_catalog 浏览全部分类。`
      const lines: string[] = []
      lines.push(`## Skill Router 匹配结果`)
      lines.push(`查询：${query.slice(0, 120)}`)
      lines.push(`匹配范围：${scopeNote}`)
      lines.push(`路由模式：${routeMode}`)
      lines.push('')
      ranked.forEach((r, i) => {
        lines.push(`${i + 1}. \`${r.name}\` ｜ ${r.categoryLabel} ｜ 得分 ${r.score}`)
        const desc = (r.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 90)
        if (desc) lines.push(`   简介：${desc}`)
        if (r.reasons.length > 0) lines.push(`   理由：${r.reasons.join('；')}`)
      })
      lines.push('')
      lines.push(`建议：先用 skill 工具加载 \`${ranked[0].name}\` 的完整说明，再开始执行。`)
      return lines.join('\n')
    },
  }))

  // ---------- 工具：skill_catalog ----------
  ctx.tools.register(defineTool({
    name: 'skill_catalog',
    description:
      '查看技能分类目录（紧凑清单）。不带参数返回各分类统计；带 category 参数返回该分类下全部技能及一句话简介。' +
      '分类键：dev 开发工程 / content 内容创作 / design 设计UI / research 调研检索 / perspective 角色视角 / ' +
      'ops 运营管理 / product 产品规划 / hr 求职人力 / office 办公文档 / finance 投资金融 / knowledge 知识学习 / ai-tools AI工具 / utility 效率工具 / other 其他',
    parameters: {
      category: { type: 'string', description: '可选：分类键或分类中文名；留空返回分类总览' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: any, value: any) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: any, exec: any) {
      const catalog = await ensureCatalog(exec?.agent, exec?.agent?.session?.header?.cwd, exec?.signal)
      if (!catalog || catalog.skills.length === 0) {
        return '技能目录尚未建立（当前 scope 没有可见技能）。检查 ~/.dsh/skills 链接是否已建立，或稍后重试。'
      }
      const cat = typeof args?.category === 'string' ? args.category : ''
      if (!cat) {
        const lines = [
          `## 技能分类总览（共 ${catalog.total} 个技能 · 更新于 ${catalog.updatedAt.slice(0, 16).replace('T', ' ')}）`,
          '',
        ]
        for (const c of catalog.categories) {
          lines.push(`- ${c.label}（${c.key}）：${c.count} 个`)
        }
        lines.push('')
        lines.push('用 skill_catalog 传分类键查看明细；用 skill_route 按任务匹配技能。')
        return lines.join('\n')
      }
      const pool = catalog.skills.filter((s) => s.category === cat || s.categoryLabel === cat)
      if (pool.length === 0) return `找不到分类「${cat}」。可用分类：${catalog.categories.map((c) => `${c.label}(${c.key})`).join('、')}`
      const lines = [`## ${pool[0].categoryLabel}（${pool.length} 个技能）`, '']
      for (const s of pool) {
        const desc = (s.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 90)
        lines.push(`- \`${s.name}\` — ${desc}`)
      }
      return lines.join('\n')
    },
  }))

  // ---------- 清理 ----------
  ctx.on('dispose', () => {
    sessionStates.clear()
    catalogs.clear()
    console.log('[jiaoyifu-skill-router] 已卸载')
  })
}
