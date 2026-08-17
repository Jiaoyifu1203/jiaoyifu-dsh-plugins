/**
 * jiaoyifu-studio · 脚姨夫内容工作台（自媒体内容运营工作台）
 *
 * 复刻小红书笔记《DeepSeek Harness 爆改自媒体工作台》（oil欧呦 / Oil Creator）的核心：
 *  1. 内容库 = 本地目录映射（目录即数据库，规范见 store.ts）；
 *  2. 对话创作：content_* 工具 + /content 斜杠绑定「当前期」为会话上下文（agent/pre-step 注入）；
 *  3. 工作台面板：/jiaoyifu/studio 同源挂载（ctx.webServer 路由），
 *     左内容列表 + 五 Tab 详情（概览/视频/脚本/字幕/文章）+ 多平台状态卡；
 *  4. 发布铁律：自动发布默认只写草稿，公开动作留给人（本地 RPA 二期再做）。
 *
 * 升级自笔记作者演示的 Oil Creator 工作台（dsh-theme + 内容 Tab + /firm content），
 * 依 jiaoyifu 铁律改造：零 UI 构建（HTML 内联）、零外部依赖、数据落盘 ~/.dsh/content。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  PLATFORM_KEYS,
  PLATFORM_LABELS,
  PUBLISH_LABELS,
  STATUS_LABELS,
  contentRoot,
  createEpisode,
  ensureRoot,
  findEpisode,
  getEpisode,
  listEpisodes,
  loadBinds,
  safeItemDir,
  saveBinds,
  updateEpisode,
  writeEpisodeFile,
  type EpisodeMeta,
  type EpisodeView,
  type PlatformKey,
} from './store.ts'
import { PANEL_HTML } from './panel.ts'

export const name = 'jiaoyifu-studio'
export const inject = ['tools', 'commands', 'webServer']

export interface Config {
  /** 内容根目录；留空默认 ~/.dsh/content */
  contentRoot?: string
  /** 面板挂载路径（同源路由） */
  panelPath?: string
  /** 绑定上下文注入的最大字符数 */
  maxInjectChars?: number
}

export const Config: Schema<Config> = Schema.object({
  contentRoot: Schema.string().default(''),
  panelPath: Schema.string().default('/jiaoyifu/studio'),
  maxInjectChars: Schema.number().default(600),
})

const STATUS_EMOJI: Record<string, string> = {
  not_started: '⬜',
  preparing: '🟡',
  ready: '🔵',
  published: '🟢',
}

const MIME: Record<string, string> = {
  '.md': 'text/plain; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function truncate(text: string, max: number): string {
  const t = String(text ?? '')
  return t.length <= max ? t : `${t.slice(0, max)}\n…（已截断，完整内容见目录文件）`
}

function platformLine(meta: EpisodeMeta): string {
  const parts: string[] = []
  for (const key of PLATFORM_KEYS) {
    const p = meta.platforms[key]
    if (!p || p.publishStatus === 'unpublished') continue
    const stats = [p.plays, p.likes, p.comments, p.favorites].some((n) => n !== undefined)
      ? `（${[p.plays !== undefined ? `${p.plays} 播放` : '', p.likes !== undefined ? `${p.likes} 赞` : '', p.comments !== undefined ? `${p.comments} 评论` : '', p.favorites !== undefined ? `${p.favorites} 藏` : ''].filter(Boolean).join(' / ')}）`
      : ''
    parts.push(`${PLATFORM_LABELS[key]} ${PUBLISH_LABELS[p.publishStatus]}${stats}`)
  }
  return parts.length ? parts.join(' · ') : '尚未发布'
}

function formatMeta(ep: EpisodeMeta): string {
  return `《${ep.title}》（${ep.slug}）｜状态：${STATUS_LABELS[ep.status]}｜平台：${platformLine(ep)}｜更新 ${ep.updatedAt.slice(0, 16).replace('T', ' ')}`
}

export function apply(ctx: Context, config: Config): void {
  const root = contentRoot(config.contentRoot ?? '')
  const panelPath = String(config.panelPath || '/jiaoyifu/studio')
  const maxChars = clampNum(config.maxInjectChars, 200, 2000, 600)
  const binds: Record<string, string> = {}

  void (async () => {
    try {
      await ensureRoot(root)
      const loaded = await loadBinds()
      Object.assign(binds, loaded)
      const metas = await listEpisodes(root)
      console.log(`[jiaoyifu-studio] 内容工作台已就绪：${metas.length} 期内容（根目录 ${root}）`)
    } catch (err) {
      console.error('[jiaoyifu-studio] 初始化失败:', err)
    }
  })()

  // ---------- 工具：内容库 ----------

  ctx.tools.register(defineTool({
    name: 'content_list',
    description:
      '列出内容库里的所有期次（标题/状态/平台发布情况/更新时间）。' +
      '状态：not_started 未开始 / preparing 准备中 / ready 待发布 / published 已发布。',
    parameters: {
      status: { type: 'string', description: '只列某状态：not_started / preparing / ready / published / all' },
      query: { type: 'string', description: '按标题关键词过滤' },
    },
    output: { schema: { type: 'string' }, render: (_args: any, value: any) => [{ type: 'text', text: String(value) }] },
    async execute(args: any) {
      let metas = await listEpisodes(root)
      const status = typeof args?.status === 'string' ? args.status : ''
      const query = String(args?.query ?? '').trim().toLowerCase()
      if (status && status !== 'all') metas = metas.filter((m) => m.status === status)
      if (query) metas = metas.filter((m) => m.title.toLowerCase().includes(query) || m.slug.toLowerCase().includes(query))
      if (metas.length === 0) return `内容库为空。用 content_new 新建一期，或在工作台面板 ${panelUrl()} 里看。`
      const lines = [`## 内容库（${metas.length} 期）`, '']
      for (const m of metas.slice(0, 30)) {
        lines.push(`- ${STATUS_EMOJI[m.status] ?? '·'} ${formatMeta(m)}`)
      }
      if (metas.length > 30) lines.push(`…（共 ${metas.length} 期，仅列前 30）`)
      return lines.join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'content_get',
    description: '读取某一期的全部内容：meta + 选题 topic.md + 脚本 script.md + 文章 article.md + 字幕 subs.srt。用 slug 或标题关键词定位。',
    parameters: {
      query: { type: 'string', required: true, description: '期次 slug（目录名）或标题关键词' },
    },
    output: { schema: { type: 'string' }, render: (_args: any, value: any) => [{ type: 'text', text: String(value) }] },
    async execute(args: any) {
      const meta = await findEpisode(root, String(args?.query ?? ''))
      if (!meta) {
        const metas = await listEpisodes(root)
        const hint = metas.length
          ? `\n现有期次：${metas.slice(0, 5).map((m) => m.slug).join('、')}${metas.length > 5 ? ' …' : ''}`
          : '\n内容库为空，用 content_new 新建。'
        return `找不到「${args?.query}」。${hint}`
      }
      const ep = await getEpisode(root, meta.slug)
      if (!ep) return `读取失败：${meta.slug}`
      const lines = [`## ${ep.meta.title}（${ep.meta.slug}）`, '']
      lines.push(`状态：${STATUS_LABELS[ep.meta.status]}｜平台：${platformLine(ep.meta)}`)
      lines.push(`目录：${ep.dir}`)
      const fileNote = [
        'topic.md',
        'script.md',
        ep.files.subs ? 'subs.srt' : '',
        ep.files.article ? 'article.md' : '',
        ep.hasCover ? `cover.${ep.coverExt}` : '',
        ep.hasVideo ? 'video.mp4' : '',
      ].filter(Boolean).join(' / ')
      lines.push(`文件：${fileNote}`)
      lines.push('', '### topic.md（选题）', '')
      lines.push(ep.files.topic.trim() || '（空）')
      lines.push('', '### script.md（脚本）', '')
      lines.push(truncate(ep.files.script.trim() || '（还没有脚本，在对话里写）', 3000))
      if (ep.files.subs.trim()) {
        const subLines = ep.files.subs.trim().split('\n').slice(0, 40)
        lines.push('', '### subs.srt（字幕，前 40 行）', '')
        lines.push(subLines.join('\n'))
        if (ep.files.subs.trim().split('\n').length > 40) lines.push('…（已截断）')
      }
      if (ep.files.article.trim()) {
        lines.push('', '### article.md（文章）', '')
        lines.push(truncate(ep.files.article.trim(), 3000))
      }
      return lines.join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'content_new',
    description: '新建一期内容：生成目录 + topic.md + meta.json（状态：未开始）。给定选题后可直接开始准备。',
    parameters: {
      title: { type: 'string', required: true, description: '本期标题' },
      topic: { type: 'string', description: '选题说明，写入 topic.md；不填则生成占位' },
    },
    output: { schema: { type: 'string' }, render: (_args: any, value: any) => [{ type: 'text', text: String(value) }] },
    async execute(args: any) {
      const title = String(args?.title ?? '').trim()
      if (!title) return '标题不能为空。'
      const meta = await createEpisode(root, title, typeof args?.topic === 'string' ? args.topic : '')
      return [
        `已新建内容：《${meta.title}》`,
        `slug：${meta.slug}`,
        `目录：${root}/${meta.slug}`,
        '下一步：/content ' + meta.slug + ' 绑定本期；写脚本用 content_write；出封面/字幕交给对应技能；状态与发布用 content_status。',
      ].join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'content_write',
    description: '把内容写入某一期的文件：topic.md（选题）/ script.md（脚本）/ article.md（文章）/ subs.srt（字幕，SRT 格式）。',
    parameters: {
      query: { type: 'string', required: true, description: '期次 slug 或标题关键词' },
      file: { type: 'string', required: true, description: '写入哪个文件：topic / script / article / subs' },
      content: { type: 'string', required: true, description: '要写入的内容' },
      append: { type: 'boolean', description: '追加而非覆盖，默认 false' },
    },
    output: { schema: { type: 'string' }, render: (_args: any, value: any) => [{ type: 'text', text: String(value) }] },
    async execute(args: any) {
      const meta = await findEpisode(root, String(args?.query ?? ''))
      if (!meta) return `找不到「${args?.query}」。用 content_list 看现有期次。`
      const file = String(args?.file ?? '')
      if (!['topic', 'script', 'article', 'subs'].includes(file)) return `非法文件类型：${file}（可选 topic/script/article/subs）`
      const path = await writeEpisodeFile(root, meta.slug, file as 'topic' | 'script' | 'article' | 'subs', String(args?.content ?? ''), args?.append === true)
      return `已写入 ${file}：${path}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'content_status',
    description:
      '更新某一期的状态（not_started/preparing/ready/published）、某平台的发布状态（unpublished/draft/published，平台：xhs 小红书 / bilibili B站 / douyin 抖音 / shipinhao 视频号 / gzh 公众号）和播放数据。铁律：公开发布前必须人工确认。',
    parameters: {
      query: { type: 'string', required: true, description: '期次 slug 或标题关键词' },
      status: { type: 'string', description: '期状态：not_started / preparing / ready / published' },
      platform: { type: 'string', description: '平台：xhs / bilibili / douyin / shipinhao / gzh' },
      publishStatus: { type: 'string', description: '平台发布状态：unpublished / draft / published' },
      plays: { type: 'number', description: '播放数' },
      likes: { type: 'number', description: '点赞数' },
      comments: { type: 'number', description: '评论数' },
      favorites: { type: 'number', description: '收藏数' },
      url: { type: 'string', description: '作品链接' },
    },
    output: { schema: { type: 'string' }, render: (_args: any, value: any) => [{ type: 'text', text: String(value) }] },
    async execute(args: any) {
      const meta = await findEpisode(root, String(args?.query ?? ''))
      if (!meta) return `找不到「${args?.query}」。用 content_list 看现有期次。`
      const platform = typeof args?.platform === 'string' && args.platform ? (args.platform as PlatformKey) : undefined
      if (platform && !PLATFORM_KEYS.includes(platform)) return `非法平台：${platform}（可选 ${PLATFORM_KEYS.join('/')}）`
      const next = await updateEpisode(root, meta.slug, {
        status: typeof args?.status === 'string' && args.status ? (args.status as EpisodeMeta['status']) : undefined,
        platform,
        publishStatus: typeof args?.publishStatus === 'string' && args.publishStatus ? (args.publishStatus as 'unpublished' | 'draft' | 'published') : undefined,
        plays: args?.plays !== undefined ? args.plays : undefined,
        likes: args?.likes !== undefined ? args.likes : undefined,
        comments: args?.comments !== undefined ? args.comments : undefined,
        favorites: args?.favorites !== undefined ? args.favorites : undefined,
        url: args?.url !== undefined ? args.url : undefined,
      })
      return `已更新：${formatMeta(next)}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'content_bind',
    description: '把某一期内容绑定为当前会话的创作上下文（此后每轮自动注入该期状态与文件指引）。与斜杠 /content 等价。',
    parameters: {
      query: { type: 'string', required: true, description: '期次 slug 或标题关键词' },
    },
    output: { schema: { type: 'string' }, render: (_args: any, value: any) => [{ type: 'text', text: String(value) }] },
    async execute(args: any, exec: any) {
      const meta = await findEpisode(root, String(args?.query ?? ''))
      if (!meta) return `找不到「${args?.query}」。用 content_list 看现有期次。`
      const agentId = String(exec?.agent?.id ?? '')
      if (!agentId) return '当前执行上下文没有 agent id，无法绑定。'
      binds[agentId] = meta.slug
      void saveBinds(binds)
      return `已绑定本期：《${meta.title}》（${meta.slug}）。后续对话会自动带上该期上下文；/content 查看，/content unbind 解绑。`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'content_unbind',
    description: '解绑当前会话绑定的期次。',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args: any, value: any) => [{ type: 'text', text: String(value) }] },
    async execute(_args: any, exec: any) {
      const agentId = String(exec?.agent?.id ?? '')
      if (agentId && binds[agentId]) {
        delete binds[agentId]
        void saveBinds(binds)
        return '已解绑。'
      }
      return '当前会话没有绑定任何期次。'
    },
  }))

  // ---------- 斜杠命令 ----------

  // 面板地址（真实端口运行时才确定，避免写死 3080）
  const panelUrl = (): string => {
    const ws = (ctx as unknown as { webServer?: { port?: number } }).webServer
    const port = typeof ws?.port === 'number' ? ws.port : 3080
    return `http://127.0.0.1:${port}${panelPath}`
  }

  ctx.commands.register({
    name: 'content',
    description: '把某一期内容绑定为当前会话上下文（选题/脚本/平台状态自动随对话带入）',
    input: { hint: 'slug 或标题关键词（留空查看当前绑定；unbind 解绑）' },
    async handler(invocation: any) {
      const agentId = String(invocation?.agent?.id ?? '')
      const raw = String(invocation?.rawInput ?? '').trim()
      if (raw.toLowerCase() === 'unbind') {
        if (agentId && binds[agentId]) {
          const old = binds[agentId]
          delete binds[agentId]
          void saveBinds(binds)
          return { kind: 'success', text: `已解绑：${old}。` }
        }
        return { kind: 'success', text: '当前会话没有绑定任何期次。' }
      }
      if (!raw) {
        const slug = agentId ? binds[agentId] : ''
        if (slug) {
          const ep = await getEpisode(root, slug)
          return { kind: 'success', text: ep ? `当前绑定：${formatMeta(ep.meta)}` : `当前绑定：${slug}（已失效）` }
        }
        const metas = await listEpisodes(root)
        const lines = ['当前未绑定。用法：/content <slug 或标题关键词>', '']
        if (metas.length) {
          lines.push('最近期次：')
          for (const m of metas.slice(0, 5)) lines.push(`- ${m.slug}｜${m.title}`)
        } else {
          lines.push('内容库为空：先在对话里说「帮我新建一期《标题》」，或去面板新建。')
        }
        return { kind: 'success', text: lines.join('\n') }
      }
      const meta = await findEpisode(root, raw)
      if (!meta) return { kind: 'error', text: `找不到「${raw}」。用 /content 查看现有期次。` }
      if (!agentId) return { kind: 'error', text: '当前界面没有 agent 上下文，无法绑定。' }
      binds[agentId] = meta.slug
      void saveBinds(binds)
      return { kind: 'success', text: `已绑定本期：《${meta.title}》（${meta.slug}）。后续对话自动带入该期上下文。` }
    },
  })

  ctx.commands.register({
    name: 'studio',
    description: '打开内容工作台面板（或给出面板地址）',
    async handler() {
      return { kind: 'success', text: `内容工作台面板：${panelUrl()}\n内容根目录：${root}` }
    },
  })

  // ---------- 绑定上下文注入（agent/pre-step） ----------

  ctx.on('agent/pre-step', async (payload: any, next: any): Promise<any> => {
    const agentId = String(payload?.agent?.id ?? '')
    const slug = agentId ? binds[agentId] : ''
    if (!slug) return next()
    const ep = await getEpisode(root, slug)
    if (!ep) {
      delete binds[agentId]
      void saveBinds(binds)
      return next()
    }
    const hint = buildBindHint(ep, maxChars)
    const downstream = await next()
    if (!downstream || downstream.kind !== 'enter') return downstream
    return {
      kind: 'enter',
      messages: [
        ...(downstream.messages ?? []),
        createUserMessage({
          content: [{ type: 'text', text: hint }],
          source: { kind: 'plugin', plugin: 'jiaoyifu-studio', form: 'notice', summary: '内容工作台上下文' },
        }),
      ],
    }
  })

  function buildBindHint(ep: EpisodeView, max: number): string {
    const files = ['topic.md', 'script.md', 'subs.srt', 'article.md', 'meta.json'].join('/')
    const text =
      `【内容工作台】当前绑定本期：《${ep.meta.title}》（${ep.meta.slug}，状态：${STATUS_LABELS[ep.meta.status]}）。` +
      `目录：${ep.dir}（文件：${files}）。` +
      `平台：${platformLine(ep.meta)}。` +
      '围绕本期写脚本/封面/字幕/文章，直接读写该目录文件或调用 content_* 工具；状态与发布用 content_status（公开发布前人工确认）。'
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`
  }

  // ---------- 工作台面板（同源路由 /jiaoyifu/studio） ----------

  const webServer = (ctx as unknown as { webServer?: { register: (route: { kind: 'exact' | 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }) => () => void } }).webServer
  if (webServer && typeof webServer.register === 'function') {
    webServer.register({ kind: 'prefix', path: panelPath, handler: handlePanel })
    console.log(`[jiaoyifu-studio] 工作台面板已挂载：${panelUrl()}`)
  } else {
    console.warn('[jiaoyifu-studio] webServer 服务不可用，面板未挂载（content_* 工具与 /content 仍可用）')
  }

  function sendJson(res: ServerResponse, code: number, obj: unknown): void {
    const body = JSON.stringify(obj)
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(body)
  }

  async function readBody(req: IncomingMessage, limit = 1 << 20): Promise<string> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      const buf = chunk as Buffer
      size += buf.length
      if (size > limit) throw new Error('请求体过大')
      chunks.push(buf)
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  async function serveMedia(req: IncomingMessage, res: ServerResponse, filePath: string, mime: string): Promise<void> {
    let size: number
    try {
      size = (await stat(filePath)).size
    } catch {
      sendJson(res, 404, { ok: false, error: '文件不存在' })
      return
    }
    const range = typeof req.headers.range === 'string' ? req.headers.range.trim() : ''
    const m = /^bytes=(\d*)-(\d*)$/.exec(range)
    res.setHeader('accept-ranges', 'bytes')
    if (m && (m[1] !== '' || m[2] !== '')) {
      let start = m[1] === '' ? NaN : parseInt(m[1], 10)
      let end = m[2] === '' ? NaN : parseInt(m[2], 10)
      if (Number.isNaN(start)) {
        start = Math.max(0, size - end)
        end = size - 1
      } else if (Number.isNaN(end) || end >= size) {
        end = size - 1
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
        res.writeHead(416, { 'content-range': `bytes */${size}` })
        res.end()
        return
      }
      res.writeHead(206, {
        'content-type': mime,
        'content-length': end - start + 1,
        'content-range': `bytes ${start}-${end}/${size}`,
      })
      createReadStream(filePath, { start, end }).pipe(res)
    } else {
      res.writeHead(200, { 'content-type': mime, 'content-length': size })
      createReadStream(filePath).pipe(res)
    }
  }

  async function handlePanel(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const pathname = decodeURIComponent(url.pathname)
      const rest = pathname === panelPath || pathname === `${panelPath}/` ? '/' : pathname.slice(panelPath.length)
      const method = String(req.method ?? 'GET').toUpperCase()

      if (method === 'GET' && (rest === '/' || rest === '')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(PANEL_HTML)
        return
      }

      if (method === 'GET' && rest === '/api/list') {
        const metas = await listEpisodes(root)
        const items: Record<string, unknown>[] = []
        for (const m of metas) {
          const dir = safeItemDir(root, m.slug)
          const ep = dir ? await getEpisode(root, m.slug) : null
          items.push({
            slug: m.slug,
            title: m.title,
            status: m.status,
            createdAt: m.createdAt,
            updatedAt: m.updatedAt,
            platforms: m.platforms,
            hasCover: ep?.hasCover ?? false,
            coverExt: ep?.coverExt ?? '',
            hasVideo: ep?.hasVideo ?? false,
          })
        }
        sendJson(res, 200, { ok: true, root, items })
        return
      }

      if (method === 'GET' && rest === '/api/item') {
        const slug = url.searchParams.get('slug') ?? ''
        const ep = await getEpisode(root, slug)
        if (!ep) {
          sendJson(res, 404, { ok: false, error: '找不到该期内容' })
          return
        }
        sendJson(res, 200, {
          ok: true,
          item: {
            slug: ep.meta.slug,
            title: ep.meta.title,
            status: ep.meta.status,
            createdAt: ep.meta.createdAt,
            updatedAt: ep.meta.updatedAt,
            platforms: ep.meta.platforms,
            dir: ep.dir,
            files: ep.files,
            hasCover: ep.hasCover,
            coverExt: ep.coverExt,
            hasVideo: ep.hasVideo,
            coverUrl: ep.hasCover ? `${panelPath}/api/media?slug=${encodeURIComponent(ep.meta.slug)}&file=cover.${ep.coverExt}` : '',
            videoUrl: ep.hasVideo ? `${panelPath}/api/media?slug=${encodeURIComponent(ep.meta.slug)}&file=video.mp4` : '',
          },
        })
        return
      }

      if (method === 'GET' && rest === '/api/media') {
        const slug = url.searchParams.get('slug') ?? ''
        const file = url.searchParams.get('file') ?? ''
        const dir = safeItemDir(root, slug)
        const allowed = ['video.mp4', 'cover.png', 'cover.jpg', 'cover.jpeg', 'cover.webp']
        if (!dir || !allowed.includes(file)) {
          sendJson(res, 400, { ok: false, error: '非法请求' })
          return
        }
        const filePath = `${dir}/${file}`
        const ext = file.slice(file.lastIndexOf('.'))
        await serveMedia(req, res, filePath, MIME[ext] ?? 'application/octet-stream')
        return
      }

      if (method === 'POST' && rest === '/api/new') {
        const body = JSON.parse(await readBody(req))
        const title = String(body?.title ?? '').trim()
        if (!title) {
          sendJson(res, 400, { ok: false, error: '标题不能为空' })
          return
        }
        const meta = await createEpisode(root, title, typeof body?.topic === 'string' ? body.topic : '')
        sendJson(res, 200, { ok: true, slug: meta.slug, item: meta })
        return
      }

      if (method === 'POST' && rest === '/api/status') {
        const body = JSON.parse(await readBody(req))
        const slug = String(body?.slug ?? '')
        if (!slug) {
          sendJson(res, 400, { ok: false, error: '缺少 slug' })
          return
        }
        const next = await updateEpisode(root, slug, {
          status: body?.status !== undefined ? String(body.status) : undefined,
          platform: body?.platform !== undefined && PLATFORM_KEYS.includes(String(body.platform)) ? (String(body.platform) as PlatformKey) : undefined,
          publishStatus: body?.publishStatus !== undefined ? String(body.publishStatus) : undefined,
          plays: body?.plays !== undefined ? Number(body.plays) : undefined,
          likes: body?.likes !== undefined ? Number(body.likes) : undefined,
          comments: body?.comments !== undefined ? Number(body.comments) : undefined,
          favorites: body?.favorites !== undefined ? Number(body.favorites) : undefined,
          url: body?.url !== undefined ? String(body.url) : undefined,
        })
        sendJson(res, 200, { ok: true, meta: next })
        return
      }

      if (method === 'POST' && rest === '/api/write') {
        const body = JSON.parse(await readBody(req))
        const slug = String(body?.slug ?? '')
        const file = String(body?.file ?? '')
        if (!['topic', 'script', 'article', 'subs'].includes(file)) {
          sendJson(res, 400, { ok: false, error: '非法 file' })
          return
        }
        const path = await writeEpisodeFile(root, slug, file as 'topic' | 'script' | 'article' | 'subs', String(body?.content ?? ''), body?.append === true)
        sendJson(res, 200, { ok: true, path })
        return
      }

      sendJson(res, 404, { ok: false, error: '未知接口' })
    } catch (err) {
      console.error('[jiaoyifu-studio] 面板请求处理失败:', err)
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: String((err as Error)?.message ?? err) })
      else res.end()
    }
  }

  ctx.on('dispose', () => {
    void saveBinds(binds)
    console.log('[jiaoyifu-studio] 已卸载（会话绑定已落盘）')
  })
}
