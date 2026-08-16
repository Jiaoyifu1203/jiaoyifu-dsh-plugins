/**
 * jiaoyifu-track · 嵌入式任务管理引擎
 *
 * 升级自开源 dsh-track（决策点协议 + 捕获墙 + Linear 形 issue 存储）：
 * - 精简到零 UI 依赖：数据落盘 ~/.dsh/track.json，工具即界面；
 * - todo_write 自动捕获：模型每次写待办，自动同步进任务账本（带会话溯源）；
 * - 任务生命周期：todo → in_progress → done/canceled，done 必须显式 close（带结果），
 *   canceled 保留原因，永不静默达成；
 * - 决策账本：track_decide 上报决策点，track_respond 落盘选择与理由；
 * - 念头捕获墙：track_capture 零摩擦记想法，带标签与来源会话。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'jiaoyifu-track'
export const inject = ['tools']

export interface Config {
  /** 账本文件目录；留空默认 ~/.dsh */
  ledgerDir?: string
}

export const Config: Schema<Config> = Schema.object({
  ledgerDir: Schema.string().default(''),
})

type IssueStatus = 'todo' | 'in_progress' | 'done' | 'canceled'
type Priority = 'high' | 'medium' | 'low'

interface Issue {
  id: string
  title: string
  description?: string
  priority: Priority
  status: IssueStatus
  project?: string
  tags: string[]
  createdAt: string
  updatedAt: string
  closedAt?: string
  outcome?: string
  source: 'manual' | 'todo_write'
  sessionId?: string
}

interface Decision {
  id: string
  question: string
  options: string[]
  preference?: string
  choice?: string
  rationale?: string
  createdAt: string
  decidedAt?: string
}

interface Thought {
  id: string
  content: string
  tags: string[]
  createdAt: string
  sessionId?: string
}

interface Ledger {
  updatedAt: string
  issues: Issue[]
  decisions: Decision[]
  thoughts: Thought[]
}

function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

function nowIso(): string {
  return new Date().toISOString()
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`
}

function normStatus(value: unknown, fallback: IssueStatus): IssueStatus {
  if (value === 'todo' || value === 'in_progress' || value === 'done' || value === 'canceled') return value
  return fallback
}

function normPriority(value: unknown, fallback: Priority): Priority {
  if (value === 'high' || value === 'medium' || value === 'low') return value
  return fallback
}

/** todo_write 状态 → issue 状态映射 */
const TODO_TO_ISSUE: Record<string, IssueStatus> = {
  pending: 'todo',
  in_progress: 'in_progress',
  completed: 'done',
  cancelled: 'canceled',
}

export function apply(ctx: Context, config: Config): void {
  const ledgerPath = join(config.ledgerDir || dshHome(), 'track.json')
  const ledger: Ledger = { updatedAt: '', issues: [], decisions: [], thoughts: [] }
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  // 启动加载账本
  void (async () => {
    try {
      const raw = await readFile(ledgerPath, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.issues)) {
        ledger.issues = parsed.issues
        ledger.decisions = Array.isArray(parsed.decisions) ? parsed.decisions : []
        ledger.thoughts = Array.isArray(parsed.thoughts) ? parsed.thoughts : []
        console.log(`[jiaoyifu-track] 已加载任务账本：${ledger.issues.length} 个任务 / ${ledger.decisions.length} 条决策 / ${ledger.thoughts.length} 条念头`)
      }
    } catch {
      /* 首次运行 */
    }
  })()

  function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void saveNow()
    }, 500)
  }

  async function saveNow(): Promise<void> {
    try {
      ledger.updatedAt = nowIso()
      await mkdir(dirname(ledgerPath), { recursive: true })
      await writeFile(ledgerPath, JSON.stringify(ledger, null, 2), 'utf8')
    } catch (err) {
      console.error('[jiaoyifu-track] 保存账本失败:', err)
    }
  }

  // ---------- todo_write 自动捕获 ----------
  ctx.on('tools/result', (exec: any, _result: any): void => {
    if (exec?.name !== 'todo_write' || !Array.isArray(exec?.arguments?.todos)) return
    const sessionId = exec?.sessionId ?? undefined
    let changed = false
    for (const item of exec.arguments.todos) {
      const title = typeof item?.content === 'string' ? item.content.trim() : ''
      if (!title) continue
      const status: IssueStatus = TODO_TO_ISSUE[item?.status] ?? 'todo'
      const existing = ledger.issues.find((i) => i.title === title && i.source === 'todo_write' && i.status !== 'done' && i.status !== 'canceled')
      if (existing) {
        if (existing.status !== status) {
          existing.status = status
          existing.updatedAt = nowIso()
          if (status === 'done' || status === 'canceled') {
            existing.closedAt = nowIso()
            existing.outcome = existing.outcome ?? (status === 'done' ? 'todo 标记完成' : 'todo 取消')
          }
          changed = true
        }
      } else {
        ledger.issues.push({
          id: newId('ISS'),
          title,
          priority: 'medium',
          status,
          tags: [],
          createdAt: nowIso(),
          updatedAt: nowIso(),
          source: 'todo_write',
          sessionId: sessionId ? String(sessionId).slice(0, 12) : undefined,
        })
        changed = true
      }
    }
    if (changed) scheduleSave()
  })

  // ---------- 工具 ----------
  ctx.tools.register(defineTool({
    name: 'track_capture',
    description: '把临时想法/灵感零摩擦收进捕获墙，稍后统一整理。带可选标签。',
    parameters: {
      content: { type: 'string', required: true, description: '想法内容' },
      tags: { type: 'string', description: '逗号分隔的标签，如：小红书,AI' },
    },
    output: { schema: { type: 'string' }, render: (_args: any, value: any) => [{ type: 'text', text: String(value) }] },
    async execute(args: any) {
      const content = String(args?.content ?? '').trim()
      if (!content) return '内容为空，未捕获。'
      const tags = String(args?.tags ?? '').split(/[,，]/).map((t) => t.trim()).filter(Boolean)
      const thought: Thought = { id: newId('THT'), content, tags, createdAt: nowIso() }
      ledger.thoughts.push(thought)
      scheduleSave()
      return `已捕获念头 ${thought.id}：${content.slice(0, 60)}${content.length > 60 ? '…' : ''}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'track_create',
    description: '创建任务（Linear 兼容的任务模型）。可指定优先级与项目名。',
    parameters: {
      title: { type: 'string', required: true, description: '任务标题' },
      description: { type: 'string', description: '任务说明/验收标准' },
      priority: { type: 'string', description: 'high / medium / low，默认 medium' },
      project: { type: 'string', description: '项目名，如 deepseek-harness' },
    },
    output: { schema: { type: 'string' }, render: (_args: any, value: any) => [{ type: 'text', text: String(value) }] },
    async execute(args: any) {
      const title = String(args?.title ?? '').trim()
      if (!title) return '任务标题不能为空。'
      const issue: Issue = {
        id: newId('ISS'),
        title,
        description: typeof args?.description === 'string' ? args.description : undefined,
        priority: normPriority(args?.priority, 'medium'),
        status: 'todo',
        project: typeof args?.project === 'string' && args.project ? args.project : undefined,
        tags: [],
        createdAt: nowIso(),
        updatedAt: nowIso(),
        source: 'manual',
      }
      ledger.issues.push(issue)
      scheduleSave()
      return `已创建任务 ${issue.id}（${issue.priority}）：${title}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'track_list',
    description: '列出任务：按状态/项目过滤。默认返回进行中与待办。',
    parameters: {
      status: { type: 'string', description: 'todo / in_progress / done / canceled / all' },
      project: { type: 'string', description: '可选：只看某项目' },
    },
    output: { schema: { type: 'string' }, render: (_args: any, value: any) => [{ type: 'text', text: String(value) }] },
    async execute(args: any) {
      const status = typeof args?.status === 'string' ? args.status : ''
      const project = typeof args?.project === 'string' ? args.project : ''
      let pool = ledger.issues
      if (project) pool = pool.filter((i) => i.project === project)
      if (status && status !== 'all') pool = pool.filter((i) => i.status === status)
      else if (!status) pool = pool.filter((i) => i.status === 'todo' || i.status === 'in_progress')
      pool = pool.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      if (pool.length === 0) return '没有符合条件的任务。'
      const lines = [`## 任务列表（${pool.length}）`, '']
      const icon: Record<IssueStatus, string> = { todo: '⬜', in_progress: '🔄', done: '✅', canceled: '🚫' }
      for (const i of pool) {
        const proj = i.project ? ` [${i.project}]` : ''
        const src = i.source === 'todo_write' ? ' · 自动捕获' : ''
        lines.push(`${icon[i.status]} ${i.id} ${i.title}${proj}（${i.priority}）${src}`)
        if (i.outcome) lines.push(`   结果：${i.outcome.slice(0, 60)}`)
      }
      return lines.join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'track_update',
    description: '推进任务：改状态（todo/in_progress/done/canceled）或补一条进展说明。done/canceled 必须在这里显式给出，防止静默完成。',
    parameters: {
      id: { type: 'string', required: true, description: '任务 ID（如 ISS-xxx）' },
      status: { type: 'string', description: '新状态：todo / in_progress / done / canceled' },
      note: { type: 'string', description: '进展说明或关闭原因/结果' },
    },
    output: { schema: { type: 'string' }, render: (_args: any, value: any) => [{ type: 'text', text: String(value) }] },
    async execute(args: any) {
      const issue = ledger.issues.find((i) => i.id === String(args?.id ?? ''))
      if (!issue) return `找不到任务 ${args?.id}。用 track_list 查现有 ID。`
      const note = typeof args?.note === 'string' ? args.note.trim() : ''
      if (args?.status) {
        const next = normStatus(args.status, issue.status)
        if (next === issue.status && !note) return `任务 ${issue.id} 无变化。`
        issue.status = next
        issue.updatedAt = nowIso()
        if (next === 'done' || next === 'canceled') {
          issue.closedAt = nowIso()
          if (note) issue.outcome = note
          else if (!issue.outcome) issue.outcome = next === 'done' ? '已确认完成' : '已取消'
        }
      }
      scheduleSave()
      return `任务 ${issue.id} 已更新：${issue.status}「${issue.title}」${note ? ` · ${note.slice(0, 60)}` : ''}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'track_decide',
    description: '上报决策点：遇到不可逆/风险/范围类决策时记录问题与选项，稍后由 track_respond 落盘选择与理由。',
    parameters: {
      question: { type: 'string', required: true, description: '需要决策的问题' },
      options: { type: 'string', required: true, description: '选项，逗号分隔，如：A方案,B方案' },
      preference: { type: 'string', description: '模型自己的倾向与理由' },
    },
    output: { schema: { type: 'string' }, render: (_args: any, value: any) => [{ type: 'text', text: String(value) }] },
    async execute(args: any) {
      const question = String(args?.question ?? '').trim()
      const options = String(args?.options ?? '').split(/[,，]/).map((t) => t.trim()).filter(Boolean)
      if (!question || options.length === 0) return '问题和选项不能为空。'
      const decision: Decision = {
        id: newId('DEC'),
        question,
        options,
        preference: typeof args?.preference === 'string' ? args.preference : undefined,
        createdAt: nowIso(),
      }
      ledger.decisions.push(decision)
      scheduleSave()
      return `已上报决策点 ${decision.id}：${question}（选项：${options.join(' / ')}）`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'track_respond',
    description: '记录决策结果：用户（或模型代用户）对决策点做出选择与理由。',
    parameters: {
      decision_id: { type: 'string', required: true, description: '决策 ID（如 DEC-xxx）' },
      choice: { type: 'string', required: true, description: '选中的选项' },
      rationale: { type: 'string', description: '选择理由' },
    },
    output: { schema: { type: 'string' }, render: (_args: any, value: any) => [{ type: 'text', text: String(value) }] },
    async execute(args: any) {
      const decision = ledger.decisions.find((d) => d.id === String(args?.decision_id ?? ''))
      if (!decision) return `找不到决策 ${args?.decision_id}。`
      decision.choice = String(args?.choice ?? '')
      decision.rationale = typeof args?.rationale === 'string' ? args.rationale : undefined
      decision.decidedAt = nowIso()
      scheduleSave()
      return `决策 ${decision.id} 已落盘：${decision.question} → ${decision.choice}${decision.rationale ? `（理由：${decision.rationale.slice(0, 60)}）` : ''}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'track_report',
    description: '任务总览：各状态数量、待决策项、最近念头。项目收尾或想复盘时调用。',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args: any, value: any) => [{ type: 'text', text: String(value) }] },
    async execute() {
      const count = (s: IssueStatus) => ledger.issues.filter((i) => i.status === s).length
      const pending = ledger.decisions.filter((d) => !d.decidedAt)
      const lines: string[] = []
      lines.push('## 任务总览')
      lines.push('')
      lines.push(`- 待办 ⬜ ${count('todo')} · 进行中 🔄 ${count('in_progress')} · 已完成 ✅ ${count('done')} · 已取消 🚫 ${count('canceled')}`)
      lines.push(`- 待决策 ${pending.length} 条 · 念头墙 ${ledger.thoughts.length} 条`)
      if (pending.length > 0) {
        lines.push('')
        lines.push('**待决策**：')
        for (const d of pending.slice(0, 5)) lines.push(`- ${d.id}：${d.question.slice(0, 60)}`)
      }
      const active = ledger.issues.filter((i) => i.status === 'in_progress' || i.status === 'todo').slice(0, 5)
      if (active.length > 0) {
        lines.push('')
        lines.push('**当前活跃任务**：')
        for (const i of active) lines.push(`- ${i.id} ${i.title.slice(0, 60)}`)
      }
      return lines.join('\n')
    },
  }))

  ctx.on('dispose', () => {
    if (saveTimer) clearTimeout(saveTimer)
    void saveNow()
    console.log('[jiaoyifu-track] 已卸载（账本已落盘）')
  })
}
