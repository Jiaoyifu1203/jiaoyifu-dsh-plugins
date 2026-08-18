/**
 * jiaoyifu-studio · 发布适配器
 *
 * 发布铁律（结构强制，任何路径都不得违反）：
 *   1. 只负责「生成发布包」和「把草稿填进平台后台」；
 *   2. 绝不点击发布 / 提交 / 上传 类按钮；公开发布永远留给人在平台后台完成；
 *   3. RPA 仅 fill 输入框 + 截图；选择器 miss 不 crash，返回未填字段。
 *
 * playwright 是可选依赖，本文件只用动态 import（await import('playwright')），
 * 绝不顶层 import，缺包时插件仍能加载。不要写进 package.json。
 * 可选安装：npm i --cache .tmp-tooling/npm-cache playwright
 */
import { execFile, spawn } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  PLATFORM_KEYS,
  findCoverFile,
  findEpisode,
  nowIso,
  readMeta,
  safeItemDir,
  updatePublishInfo,
  type PlatformKey,
} from './store.ts'

const exec = promisify(execFile)
const requireFromHere = createRequire(import.meta.url)

const XHS_TRUNCATE_NOTE = '-- 已按平台上限截断，发布前人工润色'

/** 平台规格表（约：公开文档/社区经验上限，发布前人工核对）。 */
export const PLATFORM_SPECS: Record<PlatformKey, {
  titleMax: number
  bodyMax: number
  digestMax?: number
  tagsMin?: number
  tagsMax?: number
  hashtags?: boolean
}> = {
  xhs: { titleMax: 20, bodyMax: 1000, tagsMin: 3, tagsMax: 6 },
  bilibili: { titleMax: 80, bodyMax: 2000 },
  douyin: { titleMax: 55, bodyMax: 1000, hashtags: true },
  shipinhao: { titleMax: 30, bodyMax: 1000 },
  gzh: { titleMax: 64, digestMax: 120 },
}

export const DEFAULT_CREATOR_URLS: Record<PlatformKey, string> = {
  xhs: 'https://creator.xiaohongshu.com/publish/publish',
  bilibili: 'https://member.bilibili.com/platform/upload/text/draft',
  douyin: 'https://creator.douyin.com/creator-micro/content/publish',
  shipinhao: 'https://channels.weixin.qq.com/platform/post/create',
  // gzh 后台需扫码，rpa 仅打开，不填表
  gzh: 'https://mp.weixin.qq.com',
}

/** 每平台 best-effort 选择器（只用于 fill，不用于任何提交按钮）。 */
const FIELD_SELECTORS: Record<PlatformKey, { title: string[]; body: string[]; tags: string[] }> = {
  xhs: {
    title: ['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]', '.title input', 'input.title'],
    body: ['.ql-editor', 'div[contenteditable="true"]', 'textarea[placeholder*="正文"]'],
    tags: ['input[placeholder*="话题"]', 'input[placeholder*="标签"]'],
  },
  bilibili: {
    title: ['input[placeholder*="标题"]', 'input[maxlength]', '.title-input input'],
    body: ['textarea', '.ql-editor', 'div[contenteditable="true"]'],
    tags: ['input[placeholder*="标签"]', 'input[placeholder*="话题"]'],
  },
  douyin: {
    title: ['input[placeholder*="标题"]', 'textarea[placeholder*="作品描述"]'],
    body: ['.zone-container', 'div[contenteditable="true"]', 'textarea'],
    tags: ['input[placeholder*="话题"]', 'input[placeholder*="标签"]'],
  },
  shipinhao: {
    title: ['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]'],
    body: ['textarea', 'div[contenteditable="true"]'],
    tags: ['input[placeholder*="话题"]', 'input[placeholder*="标签"]'],
  },
  gzh: { title: [], body: [], tags: [] },
}

export interface PublishConfig {
  publishRpa?: boolean
  publishUrls?: Partial<Record<PlatformKey, string>>
}

export interface PackItem {
  platform: PlatformKey
  path: string
  title: string
  truncated: boolean
}

export interface PackResult {
  ok: boolean
  error?: string
  slug?: string
  source?: 'article' | 'script'
  files?: string[]
  items?: PackItem[]
}

export interface DraftResultBody {
  ok: boolean
  error?: string
  message?: string
  openedUrl?: string
  screenshot?: string
  missed?: string[]
  clipboard?: boolean
}

export interface DraftResult {
  platform: PlatformKey
  mode: 'rpa' | 'open'
  result: DraftResultBody
  browserLeftOpen?: boolean
}

export interface PublishFact {
  exists: boolean
  pack?: string
  at?: string
  title?: string
  source?: string
}

export type PublishFacts = Record<PlatformKey, PublishFact>

function chars(text: string): string[] {
  return Array.from(String(text ?? ''))
}

function clipChars(text: string, max: number): string {
  const arr = chars(text)
  return arr.length <= max ? arr.join('') : arr.slice(0, max).join('')
}

function yamlScalar(value: string): string {
  const s = String(value ?? '')
  if (s === '' || /[:#\n\r"'{}[\],&*!|>%@`]/.test(s) || /^\s|\s$/.test(s)) return JSON.stringify(s)
  return s
}

function yamlFrontmatter(fields: Record<string, string | string[] | undefined>): string {
  const lines = ['---']
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`)
      } else {
        lines.push(`${key}:`)
        for (const item of value) lines.push(`  - ${yamlScalar(item)}`)
      }
    } else {
      lines.push(`${key}: ${yamlScalar(value ?? '')}`)
    }
  }
  lines.push('---')
  return lines.join('\n')
}

function parsePlatforms(raw: unknown): PlatformKey[] {
  let list: string[] = []
  if (Array.isArray(raw)) list = raw.map((x) => String(x))
  else if (typeof raw === 'string' && raw.trim()) list = raw.split(/[,|\s]+/).filter(Boolean)
  else return [...PLATFORM_KEYS]
  const out: PlatformKey[] = []
  for (const item of list) {
    if (PLATFORM_KEYS.includes(item as PlatformKey) && !out.includes(item as PlatformKey)) {
      out.push(item as PlatformKey)
    }
  }
  return out.length ? out : [...PLATFORM_KEYS]
}

function clipTags(tags: string[], spec: (typeof PLATFORM_SPECS)[PlatformKey]): string[] {
  const clean = tags.map((t) => t.replace(/^#/, '').trim()).filter(Boolean)
  const max = spec.tagsMax ?? 20
  return clean.slice(0, max)
}

function hashtagLine(tags: string[]): string {
  return tags.map((t) => `#${t.replace(/^#/, '').trim()}`).filter((t) => t.length > 1).join(' ')
}

function deriveTitle(metaTitle: string, body: string, max: number): string {
  const heading = /^#\s+(.+)$/m.exec(body)
  const raw = String(heading?.[1] ?? metaTitle ?? '').replace(/\s+/g, ' ').trim()
  return clipChars(raw || '未命名', max)
}

function stripMdLight(text: string): string {
  return String(text ?? '')
    .replace(/^---[\s\S]*?---\s*/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .trim()
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function loadSource(dir: string): Promise<{ text: string; source: 'article' | 'script' } | { error: string }> {
  const article = await readText(join(dir, 'article.md'))
  if (article.trim()) return { text: article, source: 'article' }
  const script = await readText(join(dir, 'script.md'))
  if (script.trim()) return { text: script, source: 'script' }
  return { error: '缺少 article.md / script.md，无法生成发布包' }
}

function buildPackBody(
  platform: PlatformKey,
  raw: string,
  tags: string[],
): { body: string; digest: string; truncated: boolean } {
  const spec = PLATFORM_SPECS[platform]
  const cleaned = stripMdLight(raw)
  let truncated = false
  let body = cleaned
  if (spec.bodyMax !== undefined && chars(body).length > spec.bodyMax) {
    body = clipChars(body, spec.bodyMax)
    if (platform === 'xhs') body = `${body}\n${XHS_TRUNCATE_NOTE}`
    truncated = true
  }
  if (spec.hashtags) {
    const hashes = hashtagLine(tags)
    if (hashes) body = body ? `${body}\n\n${hashes}` : hashes
  }
  const digest = spec.digestMax !== undefined ? clipChars(cleaned.replace(/\s+/g, ' ').trim(), spec.digestMax) : ''
  return { body, digest, truncated }
}

/** 工具 1：按平台规格生成 publish/<platform>.md，幂等覆盖。 */
export async function packEpisode(root: string, query: string, platforms?: unknown): Promise<PackResult> {
  const meta = await findEpisode(root, query)
  if (!meta) return { ok: false, error: `找不到内容：${query}` }
  const dir = safeItemDir(root, meta.slug)
  if (!dir) return { ok: false, error: '非法 slug' }
  const src = await loadSource(dir)
  if ('error' in src) return { ok: false, error: src.error }

  const keys = parsePlatforms(platforms)
  const tags = Array.isArray(meta.tags) ? meta.tags : []
  const cover = await findCoverFile(dir)
  const generatedAt = nowIso()
  await mkdir(join(dir, 'publish'), { recursive: true })

  const items: PackItem[] = []
  for (const platform of keys) {
    const spec = PLATFORM_SPECS[platform]
    const title = deriveTitle(meta.title, src.text, spec.titleMax)
    const usedTags = clipTags(tags, spec)
    const { body, digest, truncated } = buildPackBody(platform, src.text, usedTags)
    const fields: Record<string, string | string[] | undefined> = {
      platform,
      title,
      tags: usedTags,
      cover,
      generatedAt,
      source: src.source,
    }
    if (spec.digestMax !== undefined) fields.digest = digest
    const md = `${yamlFrontmatter(fields)}\n\n${body}\n`
    const rel = `publish/${platform}.md`
    await writeFile(join(dir, rel), md, 'utf8')
    await updatePublishInfo(root, meta.slug, platform, { pack: rel, at: generatedAt, title, source: src.source })
    items.push({ platform, path: rel, title, truncated })
  }
  return { ok: true, slug: meta.slug, source: src.source, files: items.map((it) => it.path), items }
}

export async function episodePublishFacts(root: string, slug: string): Promise<PublishFacts> {
  const dir = safeItemDir(root, slug)
  const meta = dir ? await readMeta(root, slug) : null
  const facts = {} as PublishFacts
  for (const key of PLATFORM_KEYS) {
    const rec = meta?.publish?.[key]
    const pack = rec?.pack || `publish/${key}.md`
    const exists = dir ? await fileExists(join(dir, pack)) : false
    facts[key] = {
      exists,
      pack,
      at: rec?.at,
      title: rec?.title,
      source: rec?.source,
    }
  }
  return facts
}

export function hasPlaywright(): boolean {
  try {
    requireFromHere.resolve('playwright')
    return true
  } catch {
    return false
  }
}

export function resolveCreatorUrl(platform: PlatformKey, config: PublishConfig = {}): string {
  const override = config.publishUrls?.[platform]
  if (typeof override === 'string' && override.trim()) return override.trim()
  return DEFAULT_CREATOR_URLS[platform]
}

function appleScriptPath(p: string): string {
  return `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

async function setClipboard(text: string): Promise<void> {
  const tmp = join(tmpdir(), `dsh-studio-clip-${process.pid}-${Date.now()}.txt`)
  await writeFile(tmp, text, 'utf8')
  try {
    await exec('osascript', [
      '-e',
      `set the clipboard to (read POSIX file ${appleScriptPath(tmp)} as «class utf8»)`,
    ], { timeout: 20000 })
  } catch {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'pipe'] })
      child.on('error', reject)
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pbcopy exit ${code}`))))
      child.stdin.end(text)
    })
  } finally {
    await writeFile(tmp, '', 'utf8').catch(() => undefined)
  }
}

async function readPackFile(dir: string, platform: PlatformKey): Promise<{ title: string; body: string; tags: string[] } | null> {
  const raw = await readText(join(dir, 'publish', `${platform}.md`))
  if (!raw.trim()) return null
  const fm = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw)
  if (!fm) return { title: '', body: raw.trim(), tags: [] }
  const title = /^title:\s*(.*)$/m.exec(fm[1])?.[1]?.trim().replace(/^["']|["']$/g, '') ?? ''
  const tags: string[] = []
  const block = fm[1].split('\n')
  let inTags = false
  for (const line of block) {
    if (/^tags:\s*\[\]\s*$/.test(line)) { inTags = false; continue }
    if (/^tags:\s*$/.test(line)) { inTags = true; continue }
    if (inTags) {
      const m = /^\s*-\s+(.*)$/.exec(line)
      if (m) tags.push(m[1].replace(/^["']|["']$/g, '').trim())
      else inTags = false
    }
  }
  return { title, body: fm[2].trim(), tags }
}

function resolveMode(requested: string | undefined, config: PublishConfig): 'rpa' | 'open' {
  const mode = String(requested ?? 'auto').trim().toLowerCase()
  if (mode === 'open') return 'open'
  if (mode === 'rpa') return 'rpa'
  return config.publishRpa === true && hasPlaywright() ? 'rpa' : 'open'
}

async function draftOpen(dir: string, platform: PlatformKey, url: string): Promise<DraftResult> {
  const pack = await readPackFile(dir, platform)
  const title = pack?.title ?? ''
  const body = pack?.body ?? ''
  const clip = `${title}\n\n${body}`
  const errors: string[] = []
  let clipboard = false
  try {
    await setClipboard(clip)
    clipboard = true
  } catch (err) {
    errors.push(`剪贴板：${(err as Error)?.message ?? err}`)
  }
  try {
    await exec('open', [url], { timeout: 20000 })
  } catch (err) {
    errors.push(`open：${(err as Error)?.message ?? err}`)
  }
  if (errors.length && !clipboard) {
    return {
      platform,
      mode: 'open',
      result: { ok: false, error: errors.join('；'), openedUrl: url, clipboard: false },
    }
  }
  return {
    platform,
    mode: 'open',
    result: {
      ok: true,
      message: clipboard
        ? `已打开创作后台，标题+正文已进剪贴板。请人工粘贴并自行点击发布。`
        : `已打开创作后台，剪贴板未写入（${errors.join('；')}）。请人工粘贴。`,
      openedUrl: url,
      clipboard,
    },
  }
}

type PwPage = {
  goto: (url: string, opts?: object) => Promise<unknown>
  locator: (sel: string) => {
    first: () => {
      waitFor: (opts: object) => Promise<void>
      fill: (value: string, opts?: object) => Promise<void>
      click: (opts?: object) => Promise<void>
    }
  }
  keyboard: { insertText: (value: string) => Promise<void> }
  screenshot: (opts: object) => Promise<unknown>
}

async function tryFillField(page: PwPage, selectors: string[], value: string): Promise<boolean> {
  if (!selectors.length || !value) return false
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first()
      await loc.waitFor({ timeout: 10000 })
      try {
        await loc.fill(value, { timeout: 10000 })
        return true
      } catch {
        await loc.click({ timeout: 5000 })
        await page.keyboard.insertText(value)
        return true
      }
    } catch {
      continue
    }
  }
  return false
}

async function draftRpa(
  dir: string,
  slug: string,
  platform: PlatformKey,
  url: string,
  config: PublishConfig,
): Promise<DraftResult> {
  if (config.publishRpa !== true) {
    return { platform, mode: 'rpa', result: { ok: false, error: 'config.publishRpa 未开启，拒绝启动浏览器' } }
  }
  if (!hasPlaywright()) {
    return {
      platform,
      mode: 'rpa',
      result: { ok: false, error: '未安装 playwright。可选：npm i --cache .tmp-tooling/npm-cache playwright' },
    }
  }
  let pw: { chromium: { launchPersistentContext: (userDataDir: string, opts: object) => Promise<{ pages: () => PwPage[]; newPage: () => Promise<PwPage> }> } }
  try {
    pw = await import('playwright') as unknown as typeof pw
  } catch (err) {
    return { platform, mode: 'rpa', result: { ok: false, error: `动态加载 playwright 失败：${(err as Error)?.message ?? err}` } }
  }

  const pack = await readPackFile(dir, platform)
  const title = pack?.title ?? ''
  const body = pack?.body ?? ''
  const tags = pack?.tags ?? []
  const userDataDir = join(dir, '..', '.publish-profiles', platform)
  await mkdir(userDataDir, { recursive: true })

  let context: { pages: () => PwPage[]; newPage: () => Promise<PwPage> }
  try {
    context = await pw.chromium.launchPersistentContext(userDataDir, { headless: false })
  } catch (err) {
    return { platform, mode: 'rpa', result: { ok: false, error: `启动浏览器失败：${(err as Error)?.message ?? err}` } }
  }

  const pages = context.pages()
  const page = pages[0] ?? await context.newPage()
  const missed: string[] = []
  try {
    await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' })
  } catch (err) {
    missed.push(`打开页面（${(err as Error)?.message ?? err}）`)
  }

  // gzh 需扫码：只打开，不填表。其他平台 best-effort fill，不点任何提交类按钮。
  if (platform !== 'gzh') {
    const sel = FIELD_SELECTORS[platform]
    if (title && !(await tryFillField(page, sel.title, title))) missed.push('title')
    if (body && !(await tryFillField(page, sel.body, body))) missed.push('body')
    if (tags.length && !(await tryFillField(page, sel.tags, tags.join(' ')))) missed.push('tags')
  } else {
    missed.push('gzh 仅打开后台（需扫码，不自动填表）')
  }

  const shotRel = `publish/${platform}.draft.png`
  await mkdir(join(dir, 'publish'), { recursive: true })
  try {
    await page.screenshot({ path: join(dir, shotRel), fullPage: true })
  } catch {
    missed.push('screenshot')
  }

  return {
    platform,
    mode: 'rpa',
    browserLeftOpen: true,
    result: {
      ok: true,
      message: missed.length
        ? `草稿已尽量填入浏览器（未填：${missed.join('、')}）。请人工检查后自行点击发布。浏览器保持打开。`
        : '草稿已填入浏览器，请人工检查后自行点击发布。浏览器保持打开。',
      openedUrl: url,
      screenshot: shotRel,
      missed,
    },
  }
}

/** 工具 2：open 打开后台+剪贴板，或 rpa 填输入框。任何路径都不点发布。 */
export async function draftEpisode(
  root: string,
  query: string,
  platformRaw: string,
  modeRaw?: string,
  config: PublishConfig = {},
): Promise<DraftResult> {
  const platform = String(platformRaw ?? '').trim() as PlatformKey
  if (!PLATFORM_KEYS.includes(platform)) {
    return {
      platform: (platform || 'xhs') as PlatformKey,
      mode: 'open',
      result: { ok: false, error: `非法平台：${platformRaw}（可选 ${PLATFORM_KEYS.join('/')}）` },
    }
  }
  const meta = await findEpisode(root, query)
  if (!meta) return { platform, mode: 'open', result: { ok: false, error: `找不到内容：${query}` } }
  const dir = safeItemDir(root, meta.slug)
  if (!dir) return { platform, mode: 'open', result: { ok: false, error: '非法 slug' } }

  const packPath = join(dir, 'publish', `${platform}.md`)
  if (!(await fileExists(packPath))) {
    const packed = await packEpisode(root, meta.slug, [platform])
    if (!packed.ok) return { platform, mode: 'open', result: { ok: false, error: packed.error || '生成发布包失败' } }
  }

  const url = resolveCreatorUrl(platform, config)
  const mode = resolveMode(modeRaw, config)
  if (mode === 'rpa') {
    if (config.publishRpa !== true || !hasPlaywright()) {
      const opened = await draftOpen(dir, platform, url)
      if (opened.result.ok) {
        opened.result.message = `rpa 不可用（publishRpa=${Boolean(config.publishRpa)} playwright=${hasPlaywright()}），已回退 open。${opened.result.message ?? ''}`
      }
      return opened
    }
    try {
      return await draftRpa(dir, meta.slug, platform, url, config)
    } catch (err) {
      return { platform, mode: 'rpa', result: { ok: false, error: `rpa 失败（进程未崩溃）：${(err as Error)?.message ?? err}` } }
    }
  }
  try {
    return await draftOpen(dir, platform, url)
  } catch (err) {
    return { platform, mode: 'open', result: { ok: false, error: `open 失败（进程未崩溃）：${(err as Error)?.message ?? err}` } }
  }
}
