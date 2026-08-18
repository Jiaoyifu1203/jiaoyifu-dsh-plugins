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
 *     voice/      视频产线：逐句 TTS 音频 NN.aiff + voice.json（句子/时长）
 *     materials/  视频产线：本地素材（图片，按文件名序轮播）
 *     bgm/        视频产线：可选背景音乐（取第一个音频文件，循环混音）
 *     storyboard.md  视频产线：分镜表（镜号/台词/时长/关键词/素材槽）
 *     publish/    发布包：<platform>.md（只填草稿，不点发布）
 *
 * 期状态机：not_started(未开始) → preparing(准备中) → ready(待发布) → published(已发布)
 * 平台状态：unpublished(未发布) / draft(草稿已备) / published(已发布)
 * 视频产线：script -> voice -> subs -> storyboard -> done，见 video.ts
 */
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  appendMemory,
  makeMemoryEntry,
  type MemoryEntry,
  type QcInfo,
} from './memory.ts'

export type { MemoryEntry, QcInfo }

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

export type VideoStage = 'script' | 'voice' | 'subs' | 'storyboard' | 'done'

export interface VideoStoryboardInfo {
  shots: number
  totalSec: number
  at: string
}

/** 视频生产流水线状态（产线概念升级自 MoneyPrinterTurbo） */
export interface VideoInfo {
  stage?: VideoStage
  voice?: string
  rate?: number
  sentences?: number
  durationSec?: number
  updatedAt?: string
  storyboard?: VideoStoryboardInfo
  composeMode?: 'storyboard' | 'legacy'
}

/** 某一平台发布包落盘记录（适配器只生成草稿包，不点发布）。 */
export interface PublishPackInfo {
  pack: string
  at: string
  title: string
  source: 'article' | 'script'
}

export interface EpisodeMeta {
  slug: string
  title: string
  status: EpisodeStatus
  createdAt: string
  updatedAt: string
  platforms: Partial<Record<PlatformKey, PlatformInfo>>
  video?: VideoInfo
  tags?: string[]
  publish?: Partial<Record<PlatformKey, PublishPackInfo>>
  memory?: MemoryEntry[]
  qc?: QcInfo
}

export interface EpisodeFiles {
  topic: string
  script: string
  article: string
  subs: string
  storyboard: string
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

function sanitizeVideo(raw: unknown): VideoInfo | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const out: VideoInfo = {}
  if (o.stage === 'script' || o.stage === 'voice' || o.stage === 'subs' || o.stage === 'storyboard' || o.stage === 'done') out.stage = o.stage
  if (typeof o.voice === 'string' && o.voice) out.voice = o.voice
  if (typeof o.rate === 'number' && Number.isFinite(o.rate) && o.rate > 0) out.rate = Math.floor(o.rate)
  if (typeof o.sentences === 'number' && Number.isFinite(o.sentences) && o.sentences >= 0) out.sentences = Math.floor(o.sentences)
  if (typeof o.durationSec === 'number' && Number.isFinite(o.durationSec) && o.durationSec >= 0) out.durationSec = Math.round(o.durationSec * 10) / 10
  if (typeof o.updatedAt === 'string' && o.updatedAt) out.updatedAt = o.updatedAt
  if (o.composeMode === 'storyboard' || o.composeMode === 'legacy') out.composeMode = o.composeMode
  if (o.storyboard && typeof o.storyboard === 'object') {
    const s = o.storyboard as Record<string, unknown>
    const sb: VideoStoryboardInfo = { shots: 0, totalSec: 0, at: '' }
    if (typeof s.shots === 'number' && Number.isFinite(s.shots) && s.shots >= 0) sb.shots = Math.floor(s.shots)
    if (typeof s.totalSec === 'number' && Number.isFinite(s.totalSec) && s.totalSec >= 0) sb.totalSec = Math.round(s.totalSec * 10) / 10
    if (typeof s.at === 'string' && s.at) sb.at = s.at
    if (sb.shots || sb.totalSec || sb.at) out.storyboard = sb
  }
  return Object.keys(out).length ? out : undefined
}

function sanitizeTags(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const tags = raw
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20)
  return tags
}

function sanitizePublish(raw: unknown): EpisodeMeta['publish'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: NonNullable<EpisodeMeta['publish']> = {}
  for (const key of PLATFORM_KEYS) {
    const p = (raw as Record<string, unknown>)[key]
    if (!p || typeof p !== 'object') continue
    const o = p as Record<string, unknown>
    const source = o.source === 'script' ? 'script' : o.source === 'article' ? 'article' : ''
    const pack = typeof o.pack === 'string' ? o.pack : ''
    const at = typeof o.at === 'string' ? o.at : ''
    const title = typeof o.title === 'string' ? o.title : ''
    if (!pack && !at && !title && !source) continue
    out[key] = {
      pack: pack || `publish/${key}.md`,
      at,
      title,
      source: source || 'article',
    }
  }
  return Object.keys(out).length ? out : undefined
}

function sanitizeMemory(raw: unknown): MemoryEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: MemoryEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const at = typeof o.at === 'string' ? o.at : ''
    const file = typeof o.file === 'string' ? o.file : ''
    const summary = typeof o.summary === 'string' ? o.summary : ''
    if (!at && !file && !summary) continue
    out.push({ at, file, summary })
  }
  return out.length ? out.slice(-8) : undefined
}

function sanitizeQc(raw: unknown): QcInfo | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const verdict = o.verdict === '通过' || o.verdict === '建议修改' ? o.verdict : ''
  if (!verdict) return undefined
  const notes = Array.isArray(o.notes)
    ? o.notes.filter((n): n is string => typeof n === 'string').map((n) => n.trim()).filter(Boolean).slice(0, 3)
    : []
  return {
    file: typeof o.file === 'string' ? o.file : '',
    at: typeof o.at === 'string' ? o.at : '',
    notes,
    verdict,
  }
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
      video: sanitizeVideo(raw.video),
    }
    const tags = sanitizeTags(raw.tags)
    if (tags) meta.tags = tags
    const publish = sanitizePublish(raw.publish)
    if (publish) meta.publish = publish
    const memory = sanitizeMemory(raw.memory)
    if (memory) meta.memory = memory
    const qc = sanitizeQc(raw.qc)
    if (qc) meta.qc = qc
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
  const [topic, script, article, subs, storyboard] = await Promise.all([
    readText(join(dir, FILE_NAMES.topic)),
    readText(join(dir, FILE_NAMES.script)),
    readText(join(dir, FILE_NAMES.article)),
    readText(join(dir, FILE_NAMES.subs)),
    readText(join(dir, 'storyboard.md')),
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
  return { meta, dir, files: { topic, script, article, subs, storyboard }, hasCover, coverExt, hasVideo }
}

/** 封面相对文件名（cover.png 等），没有则空串。 */
export async function findCoverFile(dir: string): Promise<string> {
  for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
    const name = `cover.${ext}`
    if (await exists(join(dir, name))) return name
  }
  return ''
}

/** 合并写回某一平台的发布包记录。 */
export async function updatePublishInfo(
  root: string,
  slug: string,
  platform: PlatformKey,
  info: PublishPackInfo,
): Promise<EpisodeMeta> {
  const dir = safeItemDir(root, slug)
  if (!dir) throw new Error('非法 slug')
  const meta = await readMeta(root, slug)
  if (!meta) throw new Error(`找不到内容：${slug}`)
  meta.publish = { ...(meta.publish ?? {}), [platform]: info }
  meta.updatedAt = nowIso()
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
  return meta
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
  meta.memory = appendMemory(meta.memory, makeMemoryEntry(FILE_NAMES[file], body))
  meta.updatedAt = nowIso()
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
  return path
}

/** 追加一条记忆（FIFO 8）。content_write 成功路径也会走 writeEpisodeFile。 */
export async function updateMemory(root: string, slug: string, entry: MemoryEntry): Promise<EpisodeMeta> {
  const dir = safeItemDir(root, slug)
  if (!dir) throw new Error('非法 slug')
  const meta = await readMeta(root, slug)
  if (!meta) throw new Error(`找不到内容：${slug}`)
  meta.memory = appendMemory(meta.memory, entry)
  meta.updatedAt = nowIso()
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
  return meta
}

/** 写入被动质检结果。 */
export async function updateQc(root: string, slug: string, qc: QcInfo): Promise<EpisodeMeta> {
  const dir = safeItemDir(root, slug)
  if (!dir) throw new Error('非法 slug')
  const meta = await readMeta(root, slug)
  if (!meta) throw new Error(`找不到内容：${slug}`)
  meta.qc = qc
  meta.updatedAt = nowIso()
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
  return meta
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

/** 更新视频产线状态（合并写回，bump updatedAt）。 */
export async function updateVideoInfo(root: string, slug: string, patch: VideoInfo): Promise<EpisodeMeta> {
  const dir = safeItemDir(root, slug)
  if (!dir) throw new Error('非法 slug')
  const meta = await readMeta(root, slug)
  if (!meta) throw new Error(`找不到内容：${slug}`)
  meta.video = { ...(meta.video ?? {}), ...patch, updatedAt: nowIso() }
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
