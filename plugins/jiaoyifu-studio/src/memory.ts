/**
 * jiaoyifu-studio · 三层记忆注入（mnemon 模式）
 *
 * 纯函数：构建 /content 绑定后每轮注入的上下文。
 * L1 选题常驻 / L2 现势每轮刷新 / L3 记忆 FIFO 沉淀。
 * 不碰绑定机制（studio-bind.json）。
 */

export const MEMORY_KEEP = 8
export const MEMORY_INJECT = 3
export const L1_TOPIC_CHARS = 200
export const QC_LINE_MAX = 120

export const LAYER_RATIOS = { l1: 0.45, l2: 0.35, l3: 0.2 } as const

export interface MemoryEntry {
  at: string
  file: string
  summary: string
}

export interface QcInfo {
  file: string
  at: string
  notes: string[]
  verdict: '通过' | '建议修改'
}

export interface InjectFiles {
  topic: string
  script: string
  article: string
  subs: string
  storyboard?: string
}

export interface InjectEpisode {
  meta: {
    title: string
    slug: string
    status: string
    video?: { stage?: string; sentences?: number; durationSec?: number }
    memory?: MemoryEntry[]
    qc?: QcInfo
    publish?: Partial<Record<string, { pack?: string }>>
  }
  dir: string
  files: InjectFiles
  hasVideo?: boolean
}

export interface InjectPayload {
  text: string
  l1: string
  l2: string
  l3: string
  budgets: { l1: number; l2: number; l3: number }
}

const STATUS_LABELS: Record<string, string> = {
  not_started: '未开始',
  preparing: '准备中',
  ready: '待发布',
  published: '已发布',
}

const PLATFORM_KEYS = ['xhs', 'bilibili', 'douyin', 'shipinhao', 'gzh'] as const

const STAGE_DONE: Record<string, readonly string[]> = {
  文案: [],
  配音: ['voice', 'subs', 'storyboard', 'done'],
  字幕: ['subs', 'storyboard', 'done'],
  分镜: ['storyboard', 'done'],
  合成: ['done'],
}

export function layerBudgets(budget: number): { l1: number; l2: number; l3: number } {
  const cap = Math.max(0, Math.floor(Number(budget) || 0))
  const l1 = Math.floor(cap * LAYER_RATIOS.l1)
  const l2 = Math.floor(cap * LAYER_RATIOS.l2)
  const l3 = Math.max(0, cap - l1 - l2)
  return { l1, l2, l3 }
}

export function appendMemory(prev: MemoryEntry[] | undefined, entry: MemoryEntry): MemoryEntry[] {
  return [...(prev ?? []), entry].slice(-MEMORY_KEEP)
}

export function makeMemoryEntry(file: string, content: string, now = new Date()): MemoryEntry {
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const text = String(content ?? '')
  const first = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? ''
  const summary = first
    ? Array.from(first).slice(0, 30).join('')
    : `${Array.from(text).length} 字`
  return { at: `${hh}:${mm}`, file: String(file ?? ''), summary }
}

export function formatQcLine(qc?: QcInfo | null): string {
  if (!qc || (qc.verdict !== '通过' && qc.verdict !== '建议修改')) return ''
  const note = String(qc.notes?.[0] ?? '').replace(/\s+/g, ' ').trim()
  const line = note ? `⚠️质检(${qc.verdict}): ${note}` : `⚠️质检(${qc.verdict})`
  return Array.from(line).length <= QC_LINE_MAX ? line : `${Array.from(line).slice(0, QC_LINE_MAX - 1).join('')}…`
}

function clip(text: string, max: number): string {
  const t = String(text ?? '')
  if (max <= 0) return ''
  if (t.length <= max) return t
  if (max === 1) return '…'
  return `${t.slice(0, max - 1)}…`
}

function mark(ok: boolean): string {
  return ok ? '✓' : '✗'
}

function wordCount(text: string): number {
  return Array.from(String(text ?? '')).length
}

function stageDone(ep: InjectEpisode): { 文案: boolean; 配音: boolean; 字幕: boolean; 分镜: boolean; 合成: boolean } {
  const files = ep.files
  const stage = String(ep.meta.video?.stage ?? '')
  const scriptOk = String(files.script ?? '').trim().length > 0
  const voiceOk = STAGE_DONE.配音.includes(stage) || (ep.meta.video?.sentences ?? 0) > 0
  const subsOk = String(files.subs ?? '').trim().length > 0 || STAGE_DONE.字幕.includes(stage)
  const boardOk = String(files.storyboard ?? '').trim().length > 0 || STAGE_DONE.分镜.includes(stage)
  const composed = ep.hasVideo === true || stage === 'done'
  return { 文案: scriptOk, 配音: voiceOk, 字幕: subsOk, 分镜: boardOk, 合成: composed }
}

function publishMarks(ep: InjectEpisode): { line: string; ready: number } {
  let ready = 0
  const parts: string[] = []
  for (const key of PLATFORM_KEYS) {
    const ok = Boolean(ep.meta.publish?.[key]?.pack)
    if (ok) ready += 1
    parts.push(`${key}${mark(ok)}`)
  }
  return { line: `发布包 ${parts.join('/')} (${ready}/5)`, ready }
}

function buildL1(ep: InjectEpisode, budget: number): string {
  const title = `《${ep.meta.title}》`
  const topic = String(ep.files.topic ?? '').trim()
  const topicHead = clip(topic, L1_TOPIC_CHARS)
  const head = `### L1 选题\n${title}`
  if (head.length >= budget) return head
  const rest = topicHead ? `\n${topicHead}` : ''
  return head + clip(rest, budget - head.length)
}

function buildL2(ep: InjectEpisode, budget: number): string {
  const st = stageDone(ep)
  const stages = `阶段 文案${mark(st.文案)} 配音${mark(st.配音)} 字幕${mark(st.字幕)} 分镜${mark(st.分镜)} 合成${mark(st.合成)}`
  const counts =
    `字数 topic=${wordCount(ep.files.topic)} script=${wordCount(ep.files.script)}` +
    ` article=${wordCount(ep.files.article)} subs=${wordCount(ep.files.subs)}` +
    ` storyboard=${wordCount(ep.files.storyboard ?? '')}`
  const pub = publishMarks(ep).line
  const qcLine = formatQcLine(ep.meta.qc)
  const head = `### L2 现势\n${stages}\n${counts}\n${pub}`
  if (!qcLine) return clip(head, budget)
  const reserved = Math.min(qcLine.length + 1, budget)
  const body = clip(head, Math.max(0, budget - reserved))
  const joined = body ? `${body}\n${qcLine}` : qcLine
  return joined.length <= budget ? joined : clip(joined, budget)
}

function buildL3(ep: InjectEpisode, budget: number): string {
  const recent = (ep.meta.memory ?? []).slice(-MEMORY_INJECT)
  const lines = recent.length
    ? recent.map((e) => `- ${e.at} ${e.file} ${e.summary}`)
    : ['- （暂无）']
  return clip(`### L3 记忆\n${lines.join('\n')}`, budget)
}

/**
 * 三层按 45%/35%/20% 切预算。L1 标题永不截断；总长 ≤ budget。
 * 格式沿用【内容工作台】开头 + markdown 分层。
 */
export function buildInjectPayload(episode: InjectEpisode, budget: number): InjectPayload {
  const cap = Math.max(0, Math.floor(Number(budget) || 0))
  const budgets = layerBudgets(cap)
  const status = STATUS_LABELS[episode.meta.status] ?? episode.meta.status
  const header = `【内容工作台】当前绑定本期：《${episode.meta.title}》（${episode.meta.slug}，状态：${status}）。`
  const footer =
    `目录：${episode.dir}。围绕本期用 content_* / video_* / publish_*（公开发布前人工确认）。`

  const l1 = buildL1(episode, budgets.l1)
  const l2 = buildL2(episode, budgets.l2)
  const l3 = buildL3(episode, budgets.l3)

  const candidates = [
    [header, l1, l2, l3, footer],
    [header, l1, l2, l3],
    [header, l1, l2],
    [header, l1],
    [header],
  ]
  let text = header
  for (const parts of candidates) {
    const joined = parts.filter(Boolean).join('\n')
    if (joined.length <= cap) {
      text = joined
      break
    }
    text = joined
  }
  if (text.length > cap) {
    const room = cap - header.length
    text = room > 1 ? `${header}\n${clip(l1, room - 1)}` : header
    if (text.length > cap) text = header
  }
  return { text, l1, l2, l3, budgets }
}
