/**
 * jiaoyifu-studio · 任务收割器（工作 -> 内容桥）
 *
 * 只读任务账本 track.json + 任务线 taskline.json + git log + CONTEXT.md，
 * 组装选题素材包并建一期内容。零新 npm 依赖。
 */
import { execFile as execFileCb } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createEpisode,
  listEpisodes,
  readMeta,
  updateEpisodeMeta,
  type EpisodeMeta,
} from './store.ts'

export { readMeta }

const GIT_MAX_BUFFER = 10 * 1024 * 1024
const SOURCE_TASK_CAP = 10

export interface HarvestedTask {
  id: string
  title: string
  description: string
  outcome: string
  status: string
  createdAt: string
  updatedAt: string
  closedAt: string
}

export interface TasklineAcceptance {
  text: string
  status: string
  note: string
  verifiedAt: string
}

export interface TasklineEntry {
  taskId: string
  title: string
  goal: string
  effort: string
  acceptance: TasklineAcceptance[]
  status: string
}

export interface CommitInfo {
  hash: string
  date: string
  subject: string
  files: string[]
}

export interface TopicMaterialMeta {
  title: string
  harvestedAt: string
  repo: string
}

export interface HarvestSummary {
  taskIds: string[]
  title: string
  repo: string
  harvestedAt: string
  skipped: string[]
  lines: string[]
}

export interface HarvestResult {
  slug: string
  meta: EpisodeMeta
  summary: HarvestSummary
}

export interface HarvestOpts {
  title?: string
  repo?: string
  workRepo?: string
}

interface TrackIssue {
  id: string
  title: string
  description: string
  outcome: string
  status: string
  createdAt: string
  updatedAt: string
  closedAt: string
}

const STATUS_ZH: Record<string, string> = {
  todo: '待办',
  in_progress: '进行中',
  done: '已完成',
  canceled: '已取消',
  cancelled: '已取消',
}

function execFile(cmd: string, args: string[], opts: { maxBuffer: number }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileCb(cmd, args, opts, (err, stdout, stderr) => {
      if (err) reject(err)
      else resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

function statusZh(status: string): string {
  return STATUS_ZH[status] || status || '未知'
}

function formatLocalStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function ymd(raw: string): string {
  const m = /(\d{4}-\d{2}-\d{2})/.exec(String(raw ?? ''))
  return m ? m[1] : ''
}

function firstSentence(text: string): string {
  const t = String(text ?? '').trim()
  if (!t) return ''
  const cut = t.split(/[。\n]/)[0]
  return (cut || t).trim()
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

function parseIssue(raw: unknown): TrackIssue | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = asString(o.id).trim()
  if (!id) return null
  return {
    id,
    title: asString(o.title),
    description: asString(o.description),
    outcome: asString(o.outcome),
    status: asString(o.status),
    createdAt: asString(o.createdAt),
    updatedAt: asString(o.updatedAt),
    closedAt: asString(o.closedAt),
  }
}

async function loadIssues(trackPath: string): Promise<TrackIssue[]> {
  const raw = JSON.parse(await readFile(trackPath, 'utf8'))
  const list = raw && typeof raw === 'object' ? (raw as { issues?: unknown }).issues : null
  if (!Array.isArray(list)) return []
  const out: TrackIssue[] = []
  for (const item of list) {
    const issue = parseIssue(item)
    if (issue) out.push(issue)
  }
  return out
}

function normalizeAcceptance(raw: unknown): TasklineAcceptance[] {
  if (!Array.isArray(raw)) return []
  const out: TasklineAcceptance[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const text = asString(o.text).trim()
    if (!text) continue
    const status = asString(o.status) || 'pending'
    out.push({
      text,
      status,
      note: asString(o.note),
      verifiedAt: asString(o.verifiedAt),
    })
  }
  return out
}

function normalizeTasklineEntry(raw: unknown): TasklineEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const taskId = asString(o.taskId).trim()
  if (!taskId) return null
  return {
    taskId,
    title: asString(o.title),
    goal: asString(o.goal),
    effort: asString(o.effort),
    acceptance: normalizeAcceptance(o.acceptance),
    status: asString(o.status),
  }
}

async function loadTasklineEntries(tasklinePath: string): Promise<Map<string, TasklineEntry>> {
  const map = new Map<string, TasklineEntry>()
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(tasklinePath, 'utf8'))
  } catch {
    return map
  }
  if (!raw || typeof raw !== 'object') return map
  const obj = raw as { current?: unknown; history?: unknown }
  const current = normalizeTasklineEntry(obj.current)
  if (current) map.set(current.taskId, current)
  if (Array.isArray(obj.history)) {
    for (const item of obj.history) {
      const entry = normalizeTasklineEntry(item)
      if (entry && !map.has(entry.taskId)) map.set(entry.taskId, entry)
    }
  }
  return map
}

function hasTasklineBody(entry: TasklineEntry | null | undefined): boolean {
  if (!entry) return false
  return Boolean(entry.goal.trim() || entry.effort.trim() || entry.acceptance.length)
}

function parseGitLog(stdout: string): CommitInfo[] {
  const commits: CommitInfo[] = []
  let current: CommitInfo | null = null
  const lines = String(stdout ?? '').replace(/\r/g, '').split('\n')
  for (const line of lines) {
    const tab = line.indexOf('\t')
    if (tab > 0 && /^[0-9a-f]{7,40}$/.test(line.slice(0, tab))) {
      const rest = line.slice(tab + 1)
      const tab2 = rest.indexOf('\t')
      if (tab2 >= 0) {
        if (current) commits.push(current)
        current = {
          hash: line.slice(0, tab),
          date: rest.slice(0, tab2),
          subject: rest.slice(tab2 + 1),
          files: [],
        }
        continue
      }
    }
    if (!current) continue
    if (!line.trim()) continue
    current.files.push(line.trim())
  }
  if (current) commits.push(current)
  return commits
}

export async function resolveTaskIds(trackPath: string, input: string): Promise<string[]> {
  const raw = String(input ?? '').trim()
  if (!raw) throw new Error('tasks 不能为空')
  if (raw.toLowerCase() === 'latest') {
    const issues = await loadIssues(trackPath)
    if (!issues.length) throw new Error('任务账本为空，无法取 latest')
    const sorted = [...issues].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    return [sorted[0].id]
  }
  const seen = new Set<string>()
  const ids: string[] = []
  for (const part of raw.split(',')) {
    const id = part.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    if (ids.length >= SOURCE_TASK_CAP) break
  }
  if (!ids.length) throw new Error('tasks 不能为空')
  return ids
}

export async function readTrackTasks(trackPath: string, taskIds: string[]): Promise<HarvestedTask[]> {
  let issues: TrackIssue[]
  try {
    issues = await loadIssues(trackPath)
  } catch {
    throw new Error(`找不到任务账本：${trackPath}`)
  }
  const byId = new Map(issues.map((i) => [i.id, i]))
  const missing = taskIds.filter((id) => !byId.has(id))
  if (missing.length) {
    const recent = [...issues]
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .slice(0, 5)
      .map((i) => `${i.id} ${i.title}`)
      .join('；')
    throw new Error(`找不到任务：${missing.join(', ')}。最近 5 条：${recent || '（账本为空）'}`)
  }
  return taskIds.map((id) => {
    const i = byId.get(id) as TrackIssue
    return {
      id: i.id,
      title: i.title,
      description: i.description,
      outcome: i.outcome,
      status: i.status,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
      closedAt: i.closedAt,
    }
  })
}

export async function readTasklineEntries(
  tasklinePath: string,
  taskIds: string[],
): Promise<Map<string, TasklineEntry | null>> {
  const all = await loadTasklineEntries(tasklinePath)
  const out = new Map<string, TasklineEntry | null>()
  for (const id of taskIds) out.set(id, all.get(id) ?? null)
  return out
}

export async function readGitCommits(repo: string, sinceIso: string, untilIso: string): Promise<CommitInfo[]> {
  const root = String(repo ?? '').trim()
  if (!root) return []
  if (!(await pathExists(root))) return []
  const since = String(sinceIso ?? '').trim()
  const until = String(untilIso ?? '').trim()
  if (!since || !until) return []
  try {
    const { stdout } = await execFile(
      'git',
      [
        '-C',
        root,
        'log',
        `--since=${since}`,
        `--until=${until}`,
        '--pretty=format:%h%x09%ad%x09%s',
        '--date=iso',
        '--name-only',
      ],
      { maxBuffer: GIT_MAX_BUFFER },
    )
    return parseGitLog(stdout)
  } catch {
    return []
  }
}

export async function readContextAnchors(repo: string, sinceDate: string, untilDate: string): Promise<string[]> {
  const root = String(repo ?? '').trim()
  if (!root) return []
  const since = ymd(sinceDate)
  const until = ymd(untilDate)
  if (!since || !until) return []
  let text = ''
  try {
    text = await readFile(join(root, 'CONTEXT.md'), 'utf8')
  } catch {
    return []
  }
  const lines = text.replace(/\r/g, '').split('\n')
  const sections: { date: string; body: string[] }[] = []
  let cur: { date: string; body: string[] } | null = null
  for (const line of lines) {
    const m = /^## (\d{4}-\d{2}-\d{2})\b/.exec(line)
    if (m) {
      if (cur) sections.push(cur)
      cur = { date: m[1], body: [line] }
      continue
    }
    if (cur) cur.body.push(line)
  }
  if (cur) sections.push(cur)
  return sections
    .filter((s) => s.date >= since && s.date <= until)
    .map((s) => s.body.join('\n').replace(/\n+$/, ''))
    .filter(Boolean)
}

export function buildTopicMaterial(
  tasks: HarvestedTask[],
  tasklines: Map<string, TasklineEntry | null>,
  git: CommitInfo[],
  context: string[],
  meta: TopicMaterialMeta,
): string {
  const ids = tasks.map((t) => t.id).join(', ')
  const repoLabel = meta.repo || '未配置'
  const lines: string[] = []
  lines.push(`# ${meta.title}`)
  lines.push('')
  lines.push(`> 来源任务：${ids}（收割于 ${meta.harvestedAt}）｜仓库：${repoLabel}`)
  lines.push('')

  lines.push('## 做了什么')
  if (!tasks.length) {
    lines.push('（无任务）')
  } else {
    for (const t of tasks) {
      lines.push(`### ${t.id} ${t.title}（${statusZh(t.status)}）`)
      lines.push(t.description.trim() || '（无描述）')
      if (t.outcome.trim()) {
        lines.push('')
        lines.push(`结果：${t.outcome.trim()}`)
      }
      lines.push('')
    }
  }

  lines.push('## 为什么做')
  if (!tasks.length) {
    lines.push('（无任务）')
  } else {
    for (const t of tasks) {
      const entry = tasklines.get(t.id) ?? null
      lines.push(`### ${t.id}`)
      if (hasTasklineBody(entry)) {
        lines.push(`目标：${entry!.goal.trim() || '（无目标记录）'}`)
        lines.push(`Effort：${entry!.effort.trim() || '（无）'}`)
      } else {
        lines.push('（该任务未走任务线，无目标记录）')
      }
      lines.push('')
    }
  }

  lines.push('## 怎么验证的')
  if (!tasks.length) {
    lines.push('（无任务）')
  } else {
    for (const t of tasks) {
      const entry = tasklines.get(t.id) ?? null
      lines.push(`### ${t.id}`)
      if (entry && entry.acceptance.length) {
        for (const a of entry.acceptance) {
          const mark = a.status === 'pass' ? '✅' : a.status === 'fail' ? '❌' : '⬜'
          const note = a.note.trim() ? `——${a.note.trim()}` : ''
          lines.push(`- ${mark} ${a.text}${note}`)
        }
      } else {
        lines.push('（该任务未走任务线，无验收记录）')
      }
      lines.push('')
    }
  }

  lines.push('## 产出物（git）')
  if (!git.length) {
    lines.push('（本窗口无提交记录或未配置仓库）')
  } else {
    for (const c of git) {
      const n = c.files.length
      const shown = c.files.slice(0, 5)
      const extra = n > 5 ? '…' : ''
      const filePart = n ? `：${shown.join('、')}${extra}` : ''
      lines.push(`- \`${c.hash}\` ${c.subject}（${n} 个文件${filePart}）`)
    }
  }
  lines.push('')

  lines.push('## 进度锚点（CONTEXT.md）')
  if (!context.length) {
    lines.push('（时间窗内无进度锚点）')
  } else {
    lines.push(context.join('\n\n'))
  }
  lines.push('')

  let pass = 0
  let total = 0
  let firstGoal = ''
  for (const t of tasks) {
    const entry = tasklines.get(t.id)
    if (!entry) continue
    if (!firstGoal && entry.goal.trim()) firstGoal = entry.goal.trim()
    for (const a of entry.acceptance) {
      total += 1
      if (a.status === 'pass') pass += 1
    }
  }
  const uniqueFiles = new Set<string>()
  for (const c of git) for (const f of c.files) uniqueFiles.add(f)
  const pain = firstGoal || firstSentence(tasks[0]?.description ?? '') || meta.title

  lines.push('## 可讲的故事点（创作起点，可自由删改）')
  lines.push(`- 痛点：${pain}`)
  lines.push(`- 干货：${pass} 条实测证据可展示（含文件/行号锚点）`)
  lines.push(`- 数字：${git.length} 个提交 · ${uniqueFiles.size} 个文件 · 验收 ${pass}/${total}`)
  lines.push('- 反差：从任务识别到收尾验收的完整轨迹（上文各节）就是叙事主线')
  lines.push('')
  return lines.join('\n')
}

function timeWindow(tasks: HarvestedTask[]): { since: string; until: string } {
  const now = new Date().toISOString()
  const created = tasks.map((t) => t.createdAt).filter(Boolean)
  const closed = tasks.map((t) => t.closedAt || now)
  const since = created.length ? created.reduce((a, b) => (a < b ? a : b)) : now
  const until = closed.length ? closed.reduce((a, b) => (a > b ? a : b)) : now
  return { since, until }
}

export async function listTasksForHarvest(
  root: string,
  trackPath: string,
  tasklinePath: string,
  limit = 50,
): Promise<Array<{
  id: string
  title: string
  status: string
  updatedAt: string
  outcome: string
  goal: string
  harvested: boolean
}>> {
  let issues: TrackIssue[] = []
  try {
    issues = await loadIssues(trackPath)
  } catch {
    return []
  }
  const tasklines = await loadTasklineEntries(tasklinePath)
  const harvested = new Set<string>()
  try {
    const eps = await listEpisodes(root)
    for (const ep of eps) {
      for (const id of ep.sourceTask ?? []) harvested.add(id)
    }
  } catch {
    /* 内容库读失败时仍返回任务列表 */
  }
  return [...issues]
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, limit)
    .map((i) => ({
      id: i.id,
      title: i.title,
      status: i.status,
      updatedAt: i.updatedAt,
      outcome: i.outcome,
      goal: tasklines.get(i.id)?.goal ?? '',
      harvested: harvested.has(i.id),
    }))
}

export async function harvestToEpisode(
  root: string,
  trackPath: string,
  tasklinePath: string,
  input: string,
  opts: HarvestOpts = {},
): Promise<HarvestResult> {
  const taskIds = await resolveTaskIds(trackPath, input)
  const tasks = await readTrackTasks(trackPath, taskIds)
  const tasklines = await readTasklineEntries(tasklinePath, taskIds)
  const title = String(opts.title ?? '').trim() || tasks[0]?.title || '未命名收割'
  const repo = String(opts.repo ?? '').trim() || String(opts.workRepo ?? '').trim()
  const harvestedAt = formatLocalStamp()
  const skipped: string[] = []
  const { since, until } = timeWindow(tasks)

  let git: CommitInfo[] = []
  let context: string[] = []
  if (!repo) {
    skipped.push('git（未配置仓库）')
    skipped.push('CONTEXT.md（未配置仓库）')
  } else {
    git = await readGitCommits(repo, since, until)
    context = await readContextAnchors(repo, since, until)
    if (!git.length) skipped.push('git（本窗口无提交记录或仓库不可用）')
    if (!context.length) skipped.push('CONTEXT.md（时间窗内无进度锚点）')
  }

  const matched = taskIds.filter((id) => hasTasklineBody(tasklines.get(id) ?? null)).length
  const missed = taskIds.length - matched
  if (missed) skipped.push(`taskline（${missed} 条任务无任务线记录）`)

  const material = buildTopicMaterial(tasks, tasklines, git, context, {
    title,
    harvestedAt,
    repo,
  })
  const created = await createEpisode(root, title, material)
  const meta = await updateEpisodeMeta(root, created.slug, {
    sourceTask: taskIds,
    tags: ['from-task', ...taskIds],
  })

  const uniqueFiles = new Set<string>()
  for (const c of git) for (const f of c.files) uniqueFiles.add(f)
  const lines = [
    `- 任务账本 track：已收割 ${tasks.length} 条（${taskIds.join(', ')}）`,
    `- 任务线 taskline：命中 ${matched} 条，未走任务线 ${missed} 条`,
    repo
      ? `- git 提交：${git.length} 个提交 · ${uniqueFiles.size} 个文件（仓库 ${repo}）`
      : '- git 提交：跳过（未配置仓库）',
    repo
      ? `- CONTEXT 锚点：${context.length} 段`
      : '- CONTEXT 锚点：跳过（未配置仓库）',
  ]
  const summary: HarvestSummary = {
    taskIds,
    title,
    repo,
    harvestedAt,
    skipped,
    lines,
  }
  return { slug: meta.slug, meta, summary }
}

export function formatHarvestReport(root: string, result: HarvestResult): string {
  const { slug, meta, summary } = result
  return [
    `已新建内容：《${meta.title}》`,
    `slug：${slug}`,
    `目录：${join(root, slug)}`,
    '',
    '来源摘要：',
    ...summary.lines,
    summary.skipped.length ? `跳过：${summary.skipped.join('；')}` : '',
    '',
    `下一步：绑定：/content ${slug}；建议 track_update 给来源任务补记 note：已收割为内容 ${slug}（任务侧回链）`,
  ].filter((line, i, arr) => line !== '' || (arr[i - 1] !== '' && i !== 0)).join('\n')
}
