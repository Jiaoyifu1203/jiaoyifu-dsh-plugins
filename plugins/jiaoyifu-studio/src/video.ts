/**
 * jiaoyifu-studio · 视频生产流水线引擎
 *
 * 产线概念升级自 MoneyPrinterTurbo（https://github.com/harry0703/MoneyPrinterTurbo，MIT），
 * 按 jiaoyifu 铁律做本地化零 API 改造：
 *   文案   = DSH 对话生成（script.md，已由 content_write 落盘）
 *   配音   = macOS `say`（本机 TTS，中文音色自动探测；时长用 `afinfo` 测量）
 *   字幕   = 按句配音时长累加生成 SRT（替代 whisper 方案，零依赖零识别误差）
 *   分镜   = 本地切句 + 停用词抽关键词 + materials/ 文件名对位（零 API）
 *   素材   = 本地 materials/ 图片按文件名序轮播（替代 Pexels/Pixabay API 下载）
 *   BGM    = 本地 bgm/ 第一个音频文件，循环混音（可关）
 *   合成   = ffmpeg（分镜分段 concat 或旧轮播 + 配音 + amix BGM + 烧字幕），成片直接写本期 video.mp4
 *
 * 全部子进程走 execFile（无 shell 注入面）；能力缺失时优雅降级并给出安装指引。
 */
import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { readMeta, safeItemDir, updateVideoInfo } from './store.ts'

const exec = promisify(execFile)

export interface VoiceEntry {
  name: string
  locale: string
}

export interface Probe {
  say: boolean
  afinfo: boolean
  ffmpeg: boolean
  ffprobe: boolean
  voices: VoiceEntry[]
  zhVoices: VoiceEntry[]
  defaultVoice: string
}

export interface SentenceTts {
  index: number
  text: string
  file: string
  durationSec: number
}

export interface VoiceManifest {
  voice: string
  rate: number
  generatedAt: string
  totalSec: number
  items: SentenceTts[]
}

export interface StageResult {
  ok: boolean
  error?: string
  message?: string
  voice?: string
  fallbackVoice?: boolean
  sentences?: number
  durationSec?: number
  output?: string
  usedSubs?: boolean
  usedBgm?: boolean
  composeMode?: 'storyboard' | 'legacy'
  shots?: number
}

let probeCache: Probe | null = null

async function run(cmd: string, args: string[], opts: { timeout?: number; maxBuffer?: number; cwd?: string } = {}): Promise<{ stdout: string; stderr: string }> {
  return exec(cmd, args, {
    timeout: opts.timeout ?? 120000,
    maxBuffer: opts.maxBuffer ?? 10 * 1024 * 1024,
    cwd: opts.cwd,
  })
}

function isMissingCommand(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as NodeJS.ErrnoException).code === 'ENOENT')
}

function errTail(err: unknown, max = 600): string {
  const e = err as { stderr?: string; message?: string }
  const tail = String(e?.stderr ?? e?.message ?? err ?? '')
  return tail.slice(-max).trim()
}

/** 探测本机媒体工具链与中文音色（进程内缓存一次）。 */
export async function probe(): Promise<Probe> {
  if (probeCache) return probeCache
  const p: Probe = { say: false, afinfo: false, ffmpeg: false, ffprobe: false, voices: [], zhVoices: [], defaultVoice: '' }
  try {
    const { stdout } = await run('say', ['-v', '?'], { timeout: 20000 })
    p.say = true
    for (const line of String(stdout).split('\n')) {
      const m = /^(.+?)\s{2,}(zh_[A-Z]{2,3})\s+#/.exec(line)
      if (m) {
        const entry: VoiceEntry = { name: m[1].trim(), locale: m[2] }
        p.voices.push(entry)
        p.zhVoices.push(entry)
      }
    }
  } catch {
    p.say = false
  }
  const preferred = p.zhVoices.find((v) => /tingting|meijia|婷婷|美佳/i.test(v.name))
  p.defaultVoice = preferred?.name ?? p.zhVoices[0]?.name ?? ''
  try {
    await run('afinfo', ['-h'], { timeout: 15000 })
    p.afinfo = true
  } catch (err) {
    p.afinfo = !isMissingCommand(err)
  }
  try {
    await run('ffmpeg', ['-version'], { timeout: 15000 })
    p.ffmpeg = true
  } catch {
    p.ffmpeg = false
  }
  try {
    await run('ffprobe', ['-version'], { timeout: 15000 })
    p.ffprobe = true
  } catch {
    p.ffprobe = false
  }
  probeCache = p
  return p
}

/** script.md -> 朗读句列表（去 Markdown 标记，按句末标点切分，超长句按逗号二次切）。 */
export function splitSentences(script: string): string[] {
  const cleaned = String(script ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .filter((line) => !/^\s*(#{1,6}\s|>|---|\*\s|-\s|\d+\.\s)/.test(line))
    .join('\n')
    .replace(/[*`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return []
  const out: string[] = []
  for (const para of cleaned.split(/(?<=[。！？!?])/)) {
    const piece = para.trim()
    if (!piece) continue
    if (piece.length <= 90) {
      out.push(piece)
      continue
    }
    let buf = ''
    for (const sub of piece.split(/(?<=[，,、；;])/)) {
      buf += sub
      if (buf.length >= 40) {
        out.push(buf.trim())
        buf = ''
      }
    }
    if (buf.trim()) out.push(buf.trim())
  }
  return out.filter((s) => s.length > 0).slice(0, 300)
}

async function audioDuration(path: string): Promise<number> {
  try {
    const { stdout } = await run('afinfo', [path], { timeout: 30000 })
    const m = /estimated duration:\s*([\d.]+)/.exec(stdout)
    if (m) return parseFloat(m[1])
  } catch {
    /* afinfo 不可用或读取失败 */
  }
  return 0
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/** 阶段一：逐句配音。say 生成 voice/NN.aiff，afinfo 测时长，落盘 voice.json。 */
export async function ttsEpisode(
  root: string,
  slug: string,
  opts: { voice?: string; rate?: number } = {},
): Promise<StageResult> {
  const dir = safeItemDir(root, slug)
  if (!dir) return { ok: false, error: '非法 slug' }
  const meta = await readMeta(root, slug)
  if (!meta) return { ok: false, error: `找不到内容：${slug}` }
  const p = await probe()
  if (!p.say) return { ok: false, error: '本机没有 say 命令（需要 macOS）。' }

  const script = await readFile(join(dir, 'script.md'), 'utf8').catch(() => '')
  const sentences = splitSentences(script)
  if (sentences.length === 0) {
    return { ok: false, error: 'script.md 还是空的：先在对话里写脚本（content_write），再生成配音。' }
  }

  const rate = Math.max(80, Math.min(400, Math.floor(opts.rate ?? 190)))
  let voice = String(opts.voice ?? '').trim() || p.defaultVoice
  let fallback = false

  const voiceDir = join(dir, 'voice')
  await rm(voiceDir, { recursive: true, force: true })
  await mkdir(voiceDir, { recursive: true })

  const synth = async (useVoice: string): Promise<SentenceTts[]> => {
    const items: SentenceTts[] = []
    for (let i = 0; i < sentences.length; i++) {
      const file = `${String(i + 1).padStart(2, '0')}.aiff`
      const args = useVoice
        ? ['-v', useVoice, '-r', String(rate), '-o', file, sentences[i]]
        : ['-r', String(rate), '-o', file, sentences[i]]
      await run('say', args, { timeout: 120000, cwd: voiceDir })
      const dur = await audioDuration(join(voiceDir, file))
      items.push({ index: i + 1, text: sentences[i], file, durationSec: dur })
    }
    return items
  }

  let items: SentenceTts[]
  try {
    items = await synth(voice)
  } catch (err) {
    // 音色不存在等错误：回退到探测到的默认中文音色重试一次
    if (voice && voice !== p.defaultVoice) {
      fallback = true
      voice = p.defaultVoice
      items = await synth(voice).catch((e) => {
        throw e
      })
    } else {
      return { ok: false, error: `配音失败：${errTail(err)}` }
    }
  }

  const totalSec = Math.round(items.reduce((s, it) => s + it.durationSec, 0) * 10) / 10
  const manifest: VoiceManifest = { voice, rate, generatedAt: new Date().toISOString(), totalSec, items }
  await writeFile(join(voiceDir, 'voice.json'), JSON.stringify(manifest, null, 2), 'utf8')
  await updateVideoInfo(root, slug, { stage: 'voice', voice, rate, sentences: items.length, durationSec: totalSec })
  return {
    ok: true,
    voice,
    fallbackVoice: fallback,
    sentences: items.length,
    durationSec: totalSec,
    message: `配音完成：${items.length} 句 / ${totalSec}s（音色 ${voice}${fallback ? '，已自动回退' : ''}）`,
  }
}

async function readVoiceManifest(dir: string): Promise<VoiceManifest | null> {
  try {
    const raw = JSON.parse(await readFile(join(dir, 'voice', 'voice.json'), 'utf8'))
    if (raw && Array.isArray(raw.items) && raw.items.length > 0) return raw as VoiceManifest
  } catch {
    /* 未配音 */
  }
  return null
}

function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const mm = ms % 1000
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(mm, 3)}`
}

/** 阶段二：按句配音时长生成 SRT，写 subs.srt（字幕 Tab 直接可读）。 */
export async function buildSrt(root: string, slug: string): Promise<StageResult> {
  const dir = safeItemDir(root, slug)
  if (!dir) return { ok: false, error: '非法 slug' }
  const meta = await readMeta(root, slug)
  if (!meta) return { ok: false, error: `找不到内容：${slug}` }
  const manifest = await readVoiceManifest(dir)
  if (!manifest) return { ok: false, error: '还没有配音数据（voice/voice.json）。先执行「生成配音」。' }

  const blocks: string[] = []
  let t = 0
  for (const it of manifest.items) {
    const start = t
    const end = t + Math.max(0.6, it.durationSec || 2)
    blocks.push(`${it.index}\n${srtTime(start)} --> ${srtTime(end)}\n${it.text}\n`)
    t = end
  }
  await writeFile(join(dir, 'subs.srt'), blocks.join('\n'), 'utf8')
  await updateVideoInfo(root, slug, { stage: 'subs', sentences: manifest.items.length, durationSec: manifest.totalSec })
  return { ok: true, sentences: manifest.items.length, durationSec: manifest.totalSec, message: `字幕完成：${manifest.items.length} 条，写入 subs.srt` }
}

/** 中文停用词（内联约 50 词，零 API 抽关键词用）。 */
const STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很',
  '到', '说', '要', '去', '你', '会', '着', '看', '好', '这', '那', '里', '为', '与', '及', '或',
  '但', '而', '还', '把', '被', '让', '从', '对', '能', '没', '他', '她', '它', '们', '我们', '这个',
  '那个', '什么', '怎么', '可以', '已经', '因为', '所以', '然后', '如果', '以及',
])

export interface StoryboardShot {
  index: number
  text: string
  durationSec: number
  keywords: string[]
  slot: string
  material: string
}

function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1
}

/**
 * 按长词优先 + 频次 + 首次位置取 1–3 个双字以上词。
 * 跨 n-gram 去重：已选词的子串丢掉；同一句里字符区间重叠的短窗也丢掉（避免「第一句/一句测/句测试」）。
 */
export function extractKeywords(sentence: string, max = 3): string[] {
  const cap = Math.max(1, Math.min(3, Number.isFinite(max) ? Math.floor(max) : 3))
  const text = String(sentence ?? '')
  const tokens: { w: string; i: number }[] = []
  const re = /[\u4e00-\u9fff]{2,}|[A-Za-z][A-Za-z0-9]{1,}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const run = m[0]
    if (/^[A-Za-z]/.test(run)) {
      if (run.length >= 2 && !STOP_WORDS.has(run.toLowerCase())) tokens.push({ w: run, i: m.index })
      continue
    }
    for (let n = 2; n <= 3; n++) {
      for (let k = 0; k + n <= run.length; k++) {
        const w = run.slice(k, k + n)
        if (!STOP_WORDS.has(w)) tokens.push({ w, i: m.index + k })
      }
    }
  }
  const freq = new Map<string, { n: number; first: number }>()
  for (const t of tokens) {
    const cur = freq.get(t.w)
    if (!cur) freq.set(t.w, { n: 1, first: t.i })
    else cur.n += 1
  }
  const ranked = [...freq.entries()]
    .filter(([w]) => w.length >= 2 && !STOP_WORDS.has(w))
    .sort((a, b) => b[0].length - a[0].length || b[1].n - a[1].n || a[1].first - b[1].first)
  const out: string[] = []
  const spans: Array<{ s: number; e: number }> = []
  for (const [w, info] of ranked) {
    if (out.some((x) => x.includes(w) || w.includes(x))) continue
    const s = info.first
    const e = s + w.length
    if (spans.some((sp) => overlaps(s, e, sp.s, sp.e))) continue
    out.push(w)
    spans.push({ s, e })
    if (out.length >= cap) break
  }
  if (out.length === 0) {
    const fb = text.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '')
    if (fb.length >= 2) out.push(fb.slice(0, Math.min(4, fb.length)))
  }
  return out.slice(0, cap)
}

function estimateSec(text: string, rate: number): number {
  const chars = Array.from(text).length
  const r = Math.max(80, rate || 190)
  return Math.round(Math.max(1.2, chars * 3.2 / (r / 190)) * 10) / 10
}

function matchMaterial(files: string[], keywords: string[]): string {
  const kws = keywords.map((k) => k.toLowerCase()).filter(Boolean)
  if (!kws.length) return ''
  for (const f of files) {
    const base = f.slice(0, f.lastIndexOf('.') >= 0 ? f.lastIndexOf('.') : f.length).toLowerCase()
    if (kws.some((k) => base.includes(k))) return f
  }
  return ''
}

function escapeTableCell(s: string): string {
  return String(s ?? '').replace(/\|/g, '｜').replace(/\n/g, ' ')
}

/** 解析 storyboard.md 表格；失败返回空数组（合成侧走 legacy）。 */
export function parseStoryboardMarkdown(md: string): StoryboardShot[] {
  const shots: StoryboardShot[] = []
  for (const line of String(md ?? '').split('\n')) {
    const t = line.trim()
    if (!t.startsWith('|')) continue
    if (/镜号/.test(t) || /^\|\s*-+/.test(t) || /^\|\s*:?-+/.test(t)) continue
    const raw = t.split('|').map((c) => c.trim())
    const cells = raw[0] === '' ? raw.slice(1, raw[raw.length - 1] === '' ? -1 : undefined) : raw
    if (cells.length < 4) continue
    const index = parseInt(cells[0], 10)
    if (!Number.isFinite(index) || index <= 0) continue
    const text = cells[1] || ''
    const durationSec = Math.max(0.5, parseFloat(cells[2]) || 1.2)
    const keywords = (cells[3] || '').split(/[、,，\s]+/).map((k) => k.trim()).filter(Boolean)
    const slotCell = cells[4] || ''
    const slotMatch = /(m\d{2}\.(?:png|jpg|jpeg|webp))/i.exec(slotCell)
    const matMatch = /(?:←|<-)\s*(?:materials\/)?([^\s|]+\.(?:png|jpg|jpeg|webp))/i.exec(slotCell)
    shots.push({
      index,
      text,
      durationSec,
      keywords,
      slot: slotMatch?.[1] ?? `m${String(index).padStart(2, '0')}.png`,
      material: matMatch?.[1] ?? '',
    })
  }
  return shots
}

/** 阶段：按 script.md 切句生成分镜表（零 API）。 */
export async function buildStoryboard(
  root: string,
  slug: string,
  opts: { rate?: number } = {},
): Promise<StageResult> {
  const dir = safeItemDir(root, slug)
  if (!dir) return { ok: false, error: '非法 slug' }
  const meta = await readMeta(root, slug)
  if (!meta) return { ok: false, error: `找不到内容：${slug}` }
  const script = await readFile(join(dir, 'script.md'), 'utf8').catch(() => '')
  const sentences = splitSentences(script)
  if (sentences.length === 0) {
    return { ok: false, error: 'script.md 还是空的：先写脚本再生成分镜表。' }
  }

  const rate = Math.max(80, Math.min(400, Math.floor(opts.rate ?? meta.video?.rate ?? 190)))
  const manifest = await readVoiceManifest(dir)
  const materials = await listByExt(join(dir, 'materials'), IMG_EXTS)
  const shots: StoryboardShot[] = []
  for (let i = 0; i < sentences.length; i++) {
    const measured = manifest?.items[i]?.durationSec
    const durationSec = typeof measured === 'number' && measured > 0 ? Math.round(measured * 10) / 10 : estimateSec(sentences[i], rate)
    const keywords = extractKeywords(sentences[i], 3)
    const material = matchMaterial(materials, keywords)
    shots.push({
      index: i + 1,
      text: sentences[i],
      durationSec,
      keywords,
      slot: `m${String(i + 1).padStart(2, '0')}.png`,
      material,
    })
  }
  const totalSec = Math.round(shots.reduce((s, sh) => s + sh.durationSec, 0) * 10) / 10
  const at = new Date().toISOString()
  const lines = [
    `# 分镜表 · ${meta.title}`,
    '',
    `- 生成时间：${at}`,
    `- 镜数：${shots.length}`,
    `- 总时长：${totalSec}s`,
    `- 规则：零 API 本地切句；时长优先配音实测，否则按字数估算；素材槽 mNN 顺序编号，文件名命中关键词则自动对位。`,
    '',
    '| 镜号 | 台词 | 时长(s) | 画面关键词 | 素材槽 |',
    '| --- | --- | --- | --- | --- |',
  ]
  for (const sh of shots) {
    const slot = sh.material ? `${sh.slot} ← materials/${sh.material}` : sh.slot
    lines.push(`| ${sh.index} | ${escapeTableCell(sh.text)} | ${sh.durationSec} | ${escapeTableCell(sh.keywords.join('、'))} | ${slot} |`)
  }
  lines.push('')
  await writeFile(join(dir, 'storyboard.md'), `${lines.join('\n')}\n`, 'utf8')
  await updateVideoInfo(root, slug, {
    stage: 'storyboard',
    sentences: shots.length,
    durationSec: totalSec,
    storyboard: { shots: shots.length, totalSec, at },
  })
  return {
    ok: true,
    sentences: shots.length,
    durationSec: totalSec,
    shots: shots.length,
    message: `分镜完成：${shots.length} 镜 / ${totalSec}s，写入 storyboard.md`,
  }
}

async function renderStoryboardVisual(
  dir: string,
  shots: StoryboardShot[],
  W: number,
  H: number,
): Promise<{ ok: boolean; output?: string; error?: string; visualLabel?: string }> {
  const shotDir = join(dir, 'voice', 'shots')
  await rm(shotDir, { recursive: true, force: true })
  await mkdir(shotDir, { recursive: true })
  const images = await listByExt(join(dir, 'materials'), IMG_EXTS)
  let cycle = 0
  const parts: string[] = []
  const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p`
  for (const sh of shots) {
    const dur = Math.max(0.5, sh.durationSec || 1.2)
    const name = `shot_${String(sh.index).padStart(2, '0')}.mp4`
    const outRel = join('voice', 'shots', name)
    let imgRel = ''
    if (sh.material && await fileExists(join(dir, 'materials', sh.material))) {
      imgRel = join('materials', sh.material)
    } else if (images.length) {
      imgRel = join('materials', images[cycle % images.length])
      cycle += 1
    }
    try {
      if (imgRel) {
        await run('ffmpeg', [
          '-y', '-loop', '1', '-framerate', '30', '-i', imgRel,
          '-t', String(dur), '-vf', vf,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
          '-pix_fmt', 'yuv420p', '-an', outRel,
        ], { cwd: dir, timeout: 180000 })
      } else {
        await run('ffmpeg', [
          '-y', '-f', 'lavfi', '-i', `color=c=0x10141D:s=${W}x${H}:r=30`,
          '-t', String(dur),
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
          '-pix_fmt', 'yuv420p', '-an', outRel,
        ], { cwd: dir, timeout: 180000 })
      }
      parts.push(name)
    } catch (err) {
      return { ok: false, error: `分镜第 ${sh.index} 镜渲染失败：${errTail(err)}` }
    }
  }
  const listPath = join(shotDir, 'concat.txt')
  await writeFile(listPath, parts.map((n) => `file '${n}'`).join('\n') + '\n', 'utf8')
  const visualRel = join('voice', 'shots', 'visual.mp4')
  try {
    await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', 'visual.mp4'], {
      cwd: shotDir,
      timeout: 180000,
    })
  } catch {
    try {
      await run('ffmpeg', [
        '-y', '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-an', 'visual.mp4',
      ], { cwd: shotDir, timeout: 300000 })
    } catch (err) {
      return { ok: false, error: `分镜拼接失败：${errTail(err)}` }
    }
  }
  if (!(await fileExists(join(dir, visualRel)))) return { ok: false, error: '分镜 visual.mp4 未生成' }
  return { ok: true, output: visualRel, visualLabel: `分镜合成 ${shots.length} 镜` }
}

async function muxPrebuiltVisual(
  dir: string,
  visualRel: string,
  allAudio: string,
  total: number,
  wantBgm: boolean,
  bgms: string[],
  burnSubsWanted: boolean,
  hasSrt: boolean,
): Promise<{ ok: true; usedSubs: boolean; usedBgm: boolean } | { ok: false; error: string }> {
  let burnSubs = burnSubsWanted && hasSrt
  const attempts: { subs: boolean; bgm: boolean }[] = []
  if (burnSubs && wantBgm) attempts.push({ subs: true, bgm: true })
  if (burnSubs) attempts.push({ subs: true, bgm: false })
  if (wantBgm) attempts.push({ subs: false, bgm: true })
  attempts.push({ subs: false, bgm: false })
  let lastErr = ''
  for (const at of attempts) {
    const args: string[] = ['-y', '-i', visualRel, '-i', `voice/${allAudio}`]
    if (at.bgm) args.push('-stream_loop', '-1', '-i', `bgm/${bgms[0]}`)
    const filters: string[] = []
    if (at.subs) filters.push(`[0:v]subtitles=subs.srt:force_style='FontName=PingFang SC,Fontsize=18,MarginV=60'[vout]`)
    if (at.bgm) filters.push(`[1:a][2:a]amix=inputs=2:duration=first:weights=1 0.25[aout]`)
    if (filters.length) args.push('-filter_complex', filters.join(';'))
    if (at.subs) args.push('-map', '[vout]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p')
    else args.push('-map', '0:v', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p')
    if (at.bgm) args.push('-map', '[aout]')
    else args.push('-map', '1:a')
    args.push('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', String(total + 0.5), 'video.tmp.mp4')
    try {
      await run('ffmpeg', args, { cwd: dir, timeout: 900000, maxBuffer: 30 * 1024 * 1024 })
      await rename(join(dir, 'video.tmp.mp4'), join(dir, 'video.mp4'))
      return { ok: true, usedSubs: at.subs, usedBgm: at.bgm }
    } catch (err) {
      lastErr = errTail(err)
      await rm(join(dir, 'video.tmp.mp4'), { force: true })
      continue
    }
  }
  return { ok: false, error: `合成失败（已尝试降级：去字幕/去 BGM）：${lastErr}` }
}

const IMG_EXTS = ['.jpg', '.jpeg', '.png', '.webp']
const AUDIO_EXTS = ['.mp3', '.m4a', '.aac', '.wav', '.aiff']

async function listByExt(dir: string, exts: string[]): Promise<string[]> {
  let names: string[] = []
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  return names
    .filter((n) => exts.includes(n.slice(n.lastIndexOf('.')).toLowerCase()))
    .sort()
}

function parseResolution(res: string): { w: number; h: number } {
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(String(res ?? '').trim())
  if (!m) return { w: 1080, h: 1920 }
  return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) }
}

/** 阶段三：ffmpeg 合成。素材轮播/纯色底 + 配音 + 可选 BGM + 可选烧字幕 -> video.mp4。 */
export async function composeEpisode(
  root: string,
  slug: string,
  opts: { resolution?: string; burnSubs?: boolean; withBgm?: boolean } = {},
): Promise<StageResult> {
  const dir = safeItemDir(root, slug)
  if (!dir) return { ok: false, error: '非法 slug' }
  const meta = await readMeta(root, slug)
  if (!meta) return { ok: false, error: `找不到内容：${slug}` }
  const p = await probe()
  if (!p.ffmpeg) {
    return { ok: false, error: '本机没有 ffmpeg：brew install ffmpeg 后重试（配音/字幕不受影响）。' }
  }
  const manifest = await readVoiceManifest(dir)
  if (!manifest) return { ok: false, error: '还没有配音数据。先执行「生成配音」，再合成。' }

  const { w: W, h: H } = parseResolution(opts.resolution)

  const boardRaw = await readFile(join(dir, 'storyboard.md'), 'utf8').catch(() => '')
  const shots = boardRaw.trim() ? parseStoryboardMarkdown(boardRaw) : []
  const composeMode: 'storyboard' | 'legacy' = shots.length > 0 ? 'storyboard' : 'legacy'

  // 1) 拼接配音 -> voice/all.m4a
  const voiceDir = join(dir, 'voice')
  const concatPath = join(voiceDir, 'concat.txt')
  await writeFile(concatPath, manifest.items.map((it) => `file '${it.file}'`).join('\n') + '\n', 'utf8')
  const allAudio = 'all.m4a'
  try {
    await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c:a', 'aac', '-b:a', '192k', allAudio], {
      cwd: voiceDir,
      timeout: 300000,
    })
  } catch (err) {
    return { ok: false, error: `配音拼接失败：${errTail(err)}` }
  }

  // 2) 计算总时长（ffprobe 实测优先，回退句时长求和）
  let total = manifest.totalSec
  if (p.ffprobe) {
    try {
      const { stdout } = await run(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', join('voice', allAudio)],
        { cwd: dir, timeout: 30000 },
      )
      const v = parseFloat(stdout.trim())
      if (Number.isFinite(v) && v > 0) total = Math.round(v * 10) / 10
    } catch {
      /* 回退求和值 */
    }
  }

  // 3) BGM / 字幕开关（分镜与 legacy 共用）
  const bgms = await listByExt(join(dir, 'bgm'), AUDIO_EXTS)
  const wantBgm = opts.withBgm !== false && bgms.length > 0
  const hasSrt = await fileExists(join(dir, 'subs.srt'))
  let burnSubs = opts.burnSubs !== false && hasSrt

  // 4) 视觉输入：storyboard 分段 或 materials/ 轮播 或 纯色底
  if (composeMode === 'storyboard') {
    const built = await renderStoryboardVisual(dir, shots, W, H)
    if (!built.ok || !built.output) return { ok: false, error: built.error || '分镜画面生成失败' }
    const mux = await muxPrebuiltVisual(dir, built.output, allAudio, total, wantBgm, bgms, burnSubs, hasSrt)
    if (!mux.ok) return { ok: false, error: mux.error }
    await updateVideoInfo(root, slug, { stage: 'done', durationSec: total, composeMode: 'storyboard' })
    return {
      ok: true,
      durationSec: total,
      output: 'video.mp4',
      usedSubs: mux.usedSubs,
      usedBgm: mux.usedBgm,
      composeMode: 'storyboard',
      shots: shots.length,
      message: `成片完成：${total}s · ${built.visualLabel}${mux.usedSubs ? ' · 烧字幕' : ''}${mux.usedBgm ? ' · BGM 混音' : ''}，已写入 video.mp4`,
    }
  }

  const images = await listByExt(join(dir, 'materials'), IMG_EXTS)
  const visualArgs: string[] = []
  let visualLabel = '纯色底'
  if (images.length > 0) {
    const per = Math.max(0.5, total / images.length)
    const lines: string[] = []
    for (const img of images) lines.push(`file '../materials/${img}'`, `duration ${per.toFixed(2)}`)
    lines.push(`file '../materials/${images[images.length - 1]}'`)
    await writeFile(join(voiceDir, 'visual.txt'), lines.join('\n') + '\n', 'utf8')
    visualArgs.push('-f', 'concat', '-safe', '0', '-i', 'voice/visual.txt')
    visualLabel = `${images.length} 张素材轮播`
  } else {
    visualArgs.push('-f', 'lavfi', '-i', `color=c=0x10141D:s=${W}x${H}:r=30`)
  }

  // 5) 逐级降级尝试：烧字幕 -> BGM -> 全关
  const attempts: { subs: boolean; bgm: boolean }[] = []
  if (burnSubs && wantBgm) attempts.push({ subs: true, bgm: true })
  if (burnSubs) attempts.push({ subs: true, bgm: false })
  if (wantBgm) attempts.push({ subs: false, bgm: true })
  attempts.push({ subs: false, bgm: false })

  const baseFilter = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p`
  let lastErr = ''
  for (const at of attempts) {
    const args: string[] = ['-y']
    args.push(...visualArgs, '-i', `voice/${allAudio}`)
    if (at.bgm) args.push('-stream_loop', '-1', '-i', `bgm/${bgms[0]}`)

    let chain = baseFilter
    if (at.subs) chain += `,subtitles=subs.srt:force_style='FontName=PingFang SC,Fontsize=18,MarginV=60'`
    let fc = `[0:v]${chain}[vout]`
    if (at.bgm) fc += `;[1:a][2:a]amix=inputs=2:duration=first:weights=1 0.25[aout]`
    args.push('-filter_complex', fc, '-map', '[vout]')
    if (at.bgm) args.push('-map', '[aout]')
    else args.push('-map', '1:a')
    args.push(
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      '-t', String(total + 0.5),
      'video.tmp.mp4',
    )
    try {
      await run('ffmpeg', args, { cwd: dir, timeout: 900000, maxBuffer: 30 * 1024 * 1024 })
      await rename(join(dir, 'video.tmp.mp4'), join(dir, 'video.mp4'))
      await updateVideoInfo(root, slug, { stage: 'done', durationSec: total, composeMode: 'legacy' })
      return {
        ok: true,
        durationSec: total,
        output: 'video.mp4',
        usedSubs: at.subs,
        usedBgm: at.bgm,
        composeMode: 'legacy',
        message: `成片完成：${total}s · ${visualLabel}${at.subs ? ' · 烧字幕' : ''}${at.bgm ? ' · BGM 混音' : ''}，已写入 video.mp4`,
      }
    } catch (err) {
      lastErr = errTail(err)
      await rm(join(dir, 'video.tmp.mp4'), { force: true })
      if (at.subs && hasSrt) burnSubs = true
      continue
    }
  }
  return { ok: false, error: `合成失败（已尝试降级：去字幕/去 BGM）：${lastErr}` }
}

export interface VideoFacts {
  voiceCount: number
  hasVoiceJson: boolean
  materialsCount: number
  hasBgm: boolean
  storyboard: boolean
}

/** 期目录的产线事实（面板/接口用）。 */
export async function episodeVideoFacts(dir: string): Promise<VideoFacts> {
  const voices = (await listByExt(join(dir, 'voice'), ['.aiff', '.m4a'])).filter((n) => n !== 'all.m4a')
  return {
    voiceCount: voices.length,
    hasVoiceJson: await fileExists(join(dir, 'voice', 'voice.json')),
    materialsCount: (await listByExt(join(dir, 'materials'), IMG_EXTS)).length,
    hasBgm: (await listByExt(join(dir, 'bgm'), AUDIO_EXTS)).length > 0,
    storyboard: await fileExists(join(dir, 'storyboard.md')),
  }
}
