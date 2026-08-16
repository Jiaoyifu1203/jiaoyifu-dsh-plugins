/**
 * jiaoyifu-token-doctor · 上下文与 token 审计
 *
 * 升级自开源 dsh-context-doctor（上下文注入审计）：
 * - 监听 request/header 快照，拿到每轮真实渲染后的 system prompt + 工具 schema，
 *   估算 token 成本（中文 0.7/字，其他 0.25/字符），按会话累计；
 * - token_audit 工具输出审计报告：本轮/会话峰值、技能目录成本 Top-N、
 *   目录瘦身建议（catalogDescriptionMaxLength 可省多少）；
 * - 统计持久化到 ~/.dsh/token-stats.json，跨会话可对比。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'jiaoyifu-token-doctor'
export const inject = ['skills', 'tools']

export interface Config {
  /** 单轮 system prompt 预算（估 token），超过会在报告里标红 */
  warnBudget?: number
  /** 统计文件目录；留空默认 ~/.dsh */
  statsDir?: string
}

export const Config: Schema<Config> = Schema.object({
  warnBudget: Schema.number().default(45000),
  statsDir: Schema.string().default(''),
})

interface SessionStats {
  sessionId: string
  turns: number
  promptTokensAvg: number
  promptTokensMax: number
  toolTokensAvg: number
  lastUpdatedAt: string
}

interface PersistedStats {
  updatedAt: string
  sessions: SessionStats[]
  latestPromptTokens: number
  latestSkillCatalogChars: number
  latestSkillCount: number
}

/** 估算 token：CJK 按 0.7 token/字，其余按 0.25 token/字符（贴近 DeepSeek 分词器）。 */
export function estimateTokens(text: string): number {
  let cjk = 0
  let other = 0
  for (const ch of text) {
    if (/[\u4e00-\u9fff]/.test(ch)) cjk += 1
    else if (!/\s/.test(ch)) other += 1
  }
  return Math.ceil(cjk * 0.7 + other * 0.25)
}

function estimateToolSchemas(tools: any[]): number {
  if (!Array.isArray(tools)) return 0
  let total = 0
  for (const t of tools) {
    const nameLen = typeof t?.name === 'string' ? t.name.length : 0
    const descLen = typeof t?.description === 'string' ? t.description.length : 0
    total += nameLen + descLen
  }
  return Math.ceil(total * 0.35)
}

function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

export function apply(ctx: Context, config: Config): void {
  const budget = config.warnBudget ?? 45000
  const statsPath = join(config.statsDir || dshHome(), 'token-stats.json')

  /** 会话级统计：sessionId → { turns, promptSum, promptMax, toolSum } */
  const live = new Map<string, { turns: number; promptSum: number; promptMax: number; toolSum: number }>()
  let latestPromptTokens = 0
  let persisted: PersistedStats = { updatedAt: '', sessions: [], latestPromptTokens: 0, latestSkillCatalogChars: 0, latestSkillCount: 0 }
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  // 启动加载历史统计
  void (async () => {
    try {
      const raw = await readFile(statsPath, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.sessions)) persisted = parsed as PersistedStats
    } catch {
      /* 首次运行无文件 */
    }
  })()

  // 每轮真实 prompt 快照
  ctx.on('session/event', (_session: any, event: any): void => {
    if (event?.type !== 'request/header') return
    const header = event?.data?.header
    if (!header) return
    const system = typeof header?.system === 'string' ? header.system : ''
    if (system.length === 0) return
    const promptTokens = estimateTokens(system)
    const toolTokens = estimateToolSchemas(header?.tools)
    latestPromptTokens = promptTokens
    const id = String(_session?.id ?? 'global')
    const cur = live.get(id) ?? { turns: 0, promptSum: 0, promptMax: 0, toolSum: 0 }
    cur.turns += 1
    cur.promptSum += promptTokens
    cur.promptMax = Math.max(cur.promptMax, promptTokens)
    cur.toolSum += toolTokens
    live.set(id, cur)
    scheduleSave()
  })

  function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void saveNow()
    }, 3000)
  }

  async function saveNow(): Promise<void> {
    try {
      const sessions: SessionStats[] = []
      for (const [id, s] of live) {
        sessions.push({
          sessionId: id.slice(0, 12),
          turns: s.turns,
          promptTokensAvg: Math.round(s.promptSum / Math.max(1, s.turns)),
          promptTokensMax: s.promptMax,
          toolTokensAvg: Math.round(s.toolSum / Math.max(1, s.turns)),
          lastUpdatedAt: new Date().toISOString(),
        })
      }
      persisted = { ...persisted, updatedAt: new Date().toISOString(), sessions, latestPromptTokens }
      await mkdir(dirname(statsPath), { recursive: true })
      await writeFile(statsPath, JSON.stringify(persisted, null, 2), 'utf8')
    } catch (err) {
      console.error('[jiaoyifu-token-doctor] 保存统计失败:', err)
    }
  }

  ctx.tools.register(defineTool({
    name: 'token_audit',
    description:
      '审计上下文 token 成本：本轮 system prompt 估算、本会话峰值/均值、技能目录成本 Top-N、以及可立即执行的瘦身建议。' +
      '用户问「token 花在哪」「上下文为什么这么贵」或想省钱时调用。',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args: any, value: any) => [{ type: 'text', text: String(value) }],
    },
    async execute(_args: any, exec: any) {
      const lines: string[] = []
      lines.push('## Token 审计报告')
      lines.push('')

      // 1. 本轮快照
      if (latestPromptTokens > 0) {
        const over = latestPromptTokens > budget ? ' 🔴 超预算' : ' 🟢 预算内'
        lines.push(`**当前轮 system prompt 估算**：约 ${latestPromptTokens.toLocaleString()} tokens（预算 ${budget.toLocaleString()}）${over}`)
        if (latestPromptTokens > budget) {
          lines.push('> 建议：压缩技能目录描述（见下方瘦身建议）或收紧 AGENTS.md 注入。')
        }
      } else {
        lines.push('**当前轮**：暂无快照（等待下一轮请求）。')
      }

      // 2. 会话统计
      if (live.size > 0) {
        lines.push('')
        lines.push('**本进程会话统计**：')
        for (const [id, s] of live) {
          lines.push(`- ${id.slice(0, 12)}：${s.turns} 轮 · 均值 ${Math.round(s.promptSum / s.turns).toLocaleString()} · 峰值 ${s.promptMax.toLocaleString()} tokens`)
        }
      }

      // 3. 技能目录成本（agent scope 下取，宿主 scope 恒为空）
      try {
        const summaries: any[] = await ctx.skills.list({
          scope: exec?.agent,
          cwd: exec?.agent?.session?.header?.cwd,
          signal: exec?.signal,
        })
        const items = summaries.map((s) => ({
          name: s.name,
          len: (s.name?.length ?? 0) + (s.description?.length ?? 0),
          descLen: s.description?.length ?? 0,
        })).sort((a, b) => b.len - a.len)
        const totalChars = items.reduce((sum, i) => sum + i.len, 0)
        const joined = items.map((i) => `${i.name} ${'x'.repeat(Math.min(i.descLen, 200))}`).join(' ')
        lines.push('')
        lines.push(`**技能目录注入成本**：${summaries.length} 个技能，共约 ${totalChars.toLocaleString()} 字符 ≈ ${estimateTokens(joined).toLocaleString()} tokens`)
        lines.push('')
        lines.push('**目录最重的 10 个技能**：')
        for (const i of items.slice(0, 10)) {
          lines.push(`- \`${i.name}\`：${i.len} 字符`)
        }
        const trimChars = items.filter((i) => i.descLen > 60).reduce((s, i) => s + (i.descLen - 60), 0)
        if (trimChars > 0) {
          const trimTokens = estimateTokens('x'.repeat(Math.min(trimChars, 100000)))
          lines.push('')
          lines.push(`**瘦身建议**：把 tool-skill 的 catalogDescriptionMaxLength 设为 60，目录注入可减少约 ${trimTokens.toLocaleString()} tokens；` +
            `或用 jiaoyifu-skill-router 的 skill_catalog 按需查目录，减少对全量目录的依赖。`)
        }
      } catch {
        lines.push('')
        lines.push('（技能目录读取失败，跳过该节）')
      }

      // 4. 历史对比
      if (persisted.sessions.length > 0) {
        lines.push('')
        lines.push('**历史会话峰值（最近 5 条）**：')
        for (const s of persisted.sessions.slice(-5).reverse()) {
          lines.push(`- ${s.sessionId}：峰值 ${s.promptTokensMax.toLocaleString()} · 均值 ${s.promptTokensAvg.toLocaleString()}`)
        }
      }
      return lines.join('\n')
    },
  }))

  ctx.on('dispose', () => {
    if (saveTimer) clearTimeout(saveTimer)
    void saveNow()
    console.log('[jiaoyifu-token-doctor] 已卸载（统计已落盘）')
  })
}
