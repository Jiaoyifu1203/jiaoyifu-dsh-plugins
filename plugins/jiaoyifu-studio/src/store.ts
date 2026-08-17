/**
 * jiaoyifu-studio · 内容库存储层
 *
 * 目录规范（一期内容一个目录，目录即数据库）：
 *   <contentRoot>/<slug>/
 *     meta.json   元数据 + 状态 + 各平台发布状态与数据
 *     topic.md    选题
 *     script.md   脚本
 *     subs.srt    字幕
 *     article.md  文章
 *     cover.{png,jpg,jpeg,webp}  封面
 *     video.mp4   成片
 *
 * 期状态机：not_started(未开始) → preparing(准备中) → ready(待发布) → published(已发布)
 * 平台状态：unpublished(未发布) / draft(草稿已备) / published(已发布)
 */
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type EpisodeStatus = 'not_started' | 'preparing' | 'ready' | 'published'
export type PublishStatus = 'unpublished' | 'draft' | 'published'
export type PlatformKey = 'xhs' | 'bilibili' | 'douyin' | 'shipinhao' | 'gzh'

export const PLATFORM_LABELS: Record<PlatformKey, string> = {
  xhs: '小红书',
  bilibili: 'B站',
  douyin: '抖音',
  shipinhao: '视频号',
  gzh: '公众号',
}

export const PLATFORM_KEYS: PlatformKey[] = ['xhs', 'bilibili', 'douyin', 'shipinhao', 'gzh']

export const STATUS_LABELS: Record<EpisodeStatus, string> = {
  not_started: '未开始',
  preparing: '准备中',
  ready: '待发布',
  published: '已发布',
}

export const PUBLISH_LABELS: Record<PublishStatus, string> = {
  unpublished: '未发布',
  draft: '草稿已备',
  published: '已发布',
}

export interface PlatformInfo {
  publishStatus: PublishStatus
  plays?: number
  likes?: number
  comments?: number
  favorites?: number
  url?: string
}

export interface EpisodeMeta {
  slug: string
  title: string
  status: EpisodeStatus
  createdAt: string
  updatedAt: string
  platforms: Partial<Record<PlatformKey, PlatformInfo>>
}

export interface EpisodeFiles {
  topic: string
  script: string
  article: string
  subs: string
}

export interface EpisodeView {
  meta: EpisodeMeta
  dir: string
  files: EpisodeFiles
  hasCover: boolean
  coverExt: string
  hasVideo: boolean
}

export function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

export function contentRoot(configRoot: string): string {
  const r = String(configRoot ?? '').trim()
  return r ? r : join(dshHome(), 'content')
}

export function bindPath(): string {
  return join(dshHome(), 'studio-bind.json')
}

export function nowIso(): string {
  return new Date().toISOString()
}

/** 标题 → 安全的目录段（保留中文，去掉文件系统危险字符）。 */
export function sanitizeSegment(text: string): string {
  return String(text ?? '')
    .replace(/[\\/:*?"<>|#%&\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ /g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '') || 'untitled'
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/** 生成唯一 slug；同名冲突自动加 -2/-3。 */
export async function makeSlug(title: string, root: string): Promise<string> {
  const base = `${stamp()}-${sanitizeSegment(title)}`
  let slug = base
  let i = 2
  while (await exists(join(root, slug))) {
    slug = `${base}-${i++}`
  }
  return slug
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/** slug 必须是单个安全目录名（防路径穿越）。 */
export function safeItemDir(root: string, slug: string): string | null {
  const s = String(slug ?? '').trim()
  if (!s || s === '.' || s === '..' || /[/\\]/.test(s) || /[\u0000-\u001f]/.test(s)) return null
  const dir = join(root, s)
  if (!dir.startsWith(root)) return null
  return dir
}

export async function readMeta(root: string, slug: string): Promise<EpisodeMeta | null> {
  const dir = safeItemDir(root, slug)
  if (!dir) return null
  try {
    const raw = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
    if (!raw || typeof raw.title !== 'string' || typeof raw.slug !== 'string') return null
    const meta: EpisodeMeta = {
      slug: raw.slug,
      title: raw.title,
      status: isEpisodeStatus(raw.status) ? raw.status : 'not_started',
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : nowIso(),
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso(),
      platforms: sanitizePlatforms(raw.platforms),
    }
    return meta
  } catch {
    return null
  }
}

function isEpisodeStatus(v: unknown): v is EpisodeStatus {
  return v === 'not_started' || v === 'preparing' || v === 'ready' || v === 'published'
}

function isPublishStatus(v: unknown): v is PublishStatus {
  return v === 'unpublished' || v === 'draft' || v === 'published'
}

function sanitizePlatforms(raw: unknown): EpisodeMeta['platforms'] {
  const out: EpisodeMeta['platforms'] = {}
  if (!raw || typeof raw !== 'object') return out
  for (const key of PLATFORM_KEYS) {
    const p = (raw as Record<string, unknown>)[key]
    if (!p || typeof p !== 'object') continue
    const o = p as Record<string, unknown>
    const info: PlatformInfo = {
      publishStatus: isPublishStatus(o.publishStatus) ? o.publishStatus : 'unpublished',
    }
    for (const numKey of ['plays', 'likes', 'comments', 'favorites'] as const) {
      const v = o[numKey]
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) info[numKey] = Math.floor(v)
    }
    if (typeof o.url === 'string' && o.url) info.url = o.url
    out[key] = info
  }
  return out
}

/** 列出全部期次，按更新时间倒序。 */
export async function listEpisodes(root: string): Promise<EpisodeMeta[]> {
  let entries: string[] = []
  try {
    entries = await readdir(root)
  } catch {
    return []
  }
  const metas: EpisodeMeta[] = []
  for (const name of entries) {
    const meta = await readMeta(root, name)
    if (meta) metas.push(meta)
  }
  return metas.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
}

/** 按 slug（前缀/全等）或标题关键词找一期。 */
export async function findEpisode(root: string, query: string): Promise<EpisodeMeta | null> {
  const q = String(query ?? '').trim()
  if (!q) return null
  const direct = await readMeta(root, q)
  if (direct) return direct
  const metas = await listEpisodes(root)
  const bySlug = metas.find((m) => m.slug.startsWith(q))
  if (bySlug) return bySlug
  const lower = q.toLowerCase()
  const byTitle = metas.find((m) => m.title.toLowerCase().includes(lower))
  if (byTitle) return byTitle
  return null
}

const FILE_NAMES: Record<'topic' | 'script' | 'article' | 'subs', string> = {
  topic: 'topic.md',
  script: 'script.md',
  article: 'article.md',
  subs: 'subs.srt',
}

async function readText(p: string): Promise<string> {
  try {
    return await readFile(p, 'utf8')
  } catch {
    return ''
  }
}

export async function getEpisode(root: string, slug: string): Promise<EpisodeView | null> {
  const dir = safeItemDir(root, slug)
  if (!dir) return null
  const meta = await readMeta(root, slug)
  if (!meta) return null
  const [topic, script, article, subs] = await Promise.all([
    readText(join(dir, FILE_NAMES.topic)),
    readText(join(dir, FILE_NAMES.script)),
    readText(join(dir, FILE_NAMES.article)),
    readText(join(dir, FILE_NAMES.subs)),
  ])
  let coverExt = ''
  let hasCover = false
  for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
    if (await exists(join(dir, `cover.${ext}`))) {
      coverExt = ext
      hasCover = true
      break
    }
  }
  const hasVideo = await exists(join(dir, 'video.mp4'))
  return { meta, dir, files: { topic, script, article, subs }, hasCover, coverExt, hasVideo }
}

export async function createEpisode(root: string, title: string, topic?: string): Promise<EpisodeMeta> {
  const t = String(title ?? '').trim()
  if (!t) throw new Error('标题不能为空')
  const slug = await makeSlug(t, root)
  const dir = join(root, slug)
  await mkdir(dir, { recursive: true })
  const meta: EpisodeMeta = {
    slug,
    title: t,
    status: 'not_started',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    platforms: {},
  }
  await writeFile(join(dir, 'topic.md'), String(topic ?? '').trim() || `# ${t}\n\n（选题待定，在对话里定这一期讲什么，笔记写进 topic.md。）\n`, 'utf8')
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
  return meta
}

export async function writeEpisodeFile(
  root: string,
  slug: string,
  file: keyof typeof FILE_NAMES,
  content: string,
  append: boolean,
): Promise<string> {
  const dir = safeItemDir(root, slug)
  if (!dir) throw new Error('非法 slug')
  const meta = await readMeta(root, slug)
  if (!meta) throw new Error(`找不到内容：${slug}`)
  const path = join(dir, FILE_NAMES[file])
  const body = String(content ?? '')
  if (append) {
    const prev = await readText(path)
    await writeFile(path, prev ? `${prev.replace(/\n+$/, '')}\n\n${body}\n` : `${body}\n`, 'utf8')
  } else {
    await writeFile(path, body.endsWith('\n') ? body : `${body}\n`, 'utf8')
  }
  meta.updatedAt = nowIso()
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
  return path
}

export interface StatusPatch {
  status?: EpisodeStatus
  platform?: PlatformKey
  publishStatus?: PublishStatus
  plays?: number
  likes?: number
  comments?: number
  favorites?: number
  url?: string
}

export async function updateEpisode(root: string, slug: string, patch: StatusPatch): Promise<EpisodeMeta> {
  const dir = safeItemDir(root, slug)
  if (!dir) throw new Error('非法 slug')
  const meta = await readMeta(root, slug)
  if (!meta) throw new Error(`找不到内容：${slug}`)
  if (patch.status !== undefined) {
    if (!isEpisodeStatus(patch.status)) throw new Error(`非法状态：${patch.status}`)
    meta.status = patch.status
  }
  if (patch.platform !== undefined) {
    const key = PLATFORM_KEYS.includes(patch.platform) ? patch.platform : null
    if (!key) throw new Error(`非法平台：${patch.platform}`)
    const info: PlatformInfo = meta.platforms[key] ?? { publishStatus: 'unpublished' }
    if (patch.publishStatus !== undefined) {
      if (!isPublishStatus(patch.publishStatus)) throw new Error(`非法发布状态：${patch.publishStatus}`)
      info.publishStatus = patch.publishStatus
    }
    for (const numKey of ['plays', 'likes', 'comments', 'favorites'] as const) {
      const v = patch[numKey]
      if (v !== undefined) {
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`非法的 ${numKey} 数值`)
        info[numKey] = Math.floor(v)
      }
    }
    if (patch.url !== undefined) {
      info.url = String(patch.url ?? '')
      if (!info.url) delete info.url
    }
    meta.platforms[key] = info
  }
  meta.updatedAt = nowIso()
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
  return meta
}

/** 会话绑定落盘：{ agentId: slug }。 */
export async function loadBinds(): Promise<Record<string, string>> {
  try {
    const raw = JSON.parse(await readFile(bindPath(), 'utf8'))
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') out[k] = v
      return out
    }
  } catch {
    /* 首次运行 */
  }
  return {}
}

export async function saveBinds(binds: Record<string, string>): Promise<void> {
  try {
    await writeFile(bindPath(), JSON.stringify(binds, null, 2), 'utf8')
  } catch (err) {
    console.error('[jiaoyifu-studio] 保存绑定失败:', err)
  }
}

/** 首次运行：在内容根写一份目录规范说明。 */
export async function ensureRoot(root: string): Promise<void> {
  await mkdir(root, { recursive: true })
  const readme = join(root, 'README.md')
  if (await exists(readme)) return
  const doc = [
    '# 内容库 · 目录规范（jiaoyifu-studio）',
    '',
    '一期内容一个目录，目录即数据库：',
    '',
    '```',
    '<contentRoot>/<slug>/',
    '  meta.json    元数据 + 状态 + 各平台发布状态与数据（机器可读写）',
    '  topic.md     选题',
    '  script.md    脚本',
    '  subs.srt     字幕（SRT）',
    '  article.md   文章',
    '  cover.{png,jpg,jpeg,webp}  封面',
    '  video.mp4    成片',
    '```',
    '',
    '- 期状态：`not_started` 未开始 → `preparing` 准备中 → `ready` 待发布 → `published` 已发布',
    '- 平台：`xhs` 小红书 / `bilibili` B站 / `douyin` 抖音 / `shipinhao` 视频号 / `gzh` 公众号',
    '- 平台状态：`unpublished` 未发布 / `draft` 草稿已备 / `published` 已发布',
    '- 发布铁律：自动发布默认只写草稿，公开动作留给人。',
    '',
    '工作台面板：http://127.0.0.1:3080/jiaoyifu/studio',
    '对话绑定：/content <slug>',
    '',
  ].join('\n')
  await writeFile(readme, doc, 'utf8')
}
