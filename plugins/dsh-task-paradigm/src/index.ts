/**
 * dsh-task-paradigm · 任务交互主线（四轴一线）
 *
 * 把推理接口 / 工具调用 / 长程状态 / 验证机制拧在一条线上：
 * 识别 → 配置 → 路由 → 执行 → 验证 → 收尾。一次一条主线。
 * 状态落盘 ~/.dsh/taskline.json，协议 + beacon 注入 systemPrompt。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname } from 'node:path'

export const name = 'dsh-task-paradigm'
export const inject = ['tools', 'systemPrompt']

export interface Config {
  /** 注入四轴一线协议段 */
  injectProtocol?: boolean
  /** 注入当前任务线 beacon */
  injectBeacon?: boolean
  /** 状态文件路径；~ 展开为家目录 */
  statePath?: string
}

export const Config: Schema<Config> = Schema.object({
  injectProtocol: Schema.boolean().default(true),
  injectBeacon: Schema.boolean().default(true),
  statePath: Schema.string().default('~/.dsh/taskline.json'),
})

const PROTOCOL_TEXT = `DSH 任务交互主线（dsh-task-paradigm · 四轴一线）

执行类任务一律走主线：识别 → 配置 → 路由 → 执行 → 验证 → 收尾。四轴拧在一条线上，模型可换、范式不变：

【识别·状态】识别卡确认后：track_create 建 ISS 账，随后 taskline_begin 开线（同一任务 ID）：登记目标、Effort、验收标准（逐条可核验断言，至少 1 条）。
【配置·推理接口】按 Effort 选执行面并在委派前一句话报模型：
  low → scout(flash)；medium → flash/pro 整包委派；xhigh → pro/grok 整包委派；max → pro 整包 + 全链锚点。
  父会话推理强度按任务档位切换（off/low/high/max，Web Models 页或会话选模）。
【路由·工具调用】插件工具（track/taskline/content/vision/skill_*/scout/publish 等）由父代理代办；执行类工作整包委派子代理。handoff 四件套：目标（一句话可验收）＋上下文（自包含路径与事实）＋验收标准（与 taskline 同源）＋回读自查指令。
【执行·状态】委派后不抢活；阶段推进用 taskline_advance 记锚点（note 写关键事实：委派了谁、改了什么）。
【验证·验证机制】子代理交付回来逐条 taskline_verify：pass 必须附证据（文件:行号/命令输出）；fail 必须二次委派修复后重验，不得带病过门。
【收尾·状态】全部 pass → taskline_advance(phase='close')（close 硬门：验收未全 pass 会被拒绝）→ 按收尾门协议询问「是否进入收尾流程？」。

状态存续：任务线落盘 ~/.dsh/taskline.json 并动态注入 systemPrompt；上下文压缩或新会话后，先调 taskline_get 恢复现场再继续。一次一条主线：开新线前必须 close 旧线。`

type Effort = 'low' | 'medium' | 'xhigh' | 'max'
type AccStatus = 'pending' | 'pass' | 'fail'
type AdvancePhase = 'configure' | 'route' | 'execute' | 'verify' | 'close'
type PhaseName = 'recognized' | AdvancePhase

interface AcceptanceItem {
  text: string
  status: AccStatus
  note: string
  verifiedAt: string
}

interface PhaseItem {
  phase: PhaseName
  at: string
  note: string
  anchor?: string
}

interface CurrentLine {
  taskId: string
  title: string
  goal: string
  effort: Effort
  model: string
  status: 'active' | 'closed'
  createdAt: string
  acceptance: AcceptanceItem[]
  phases: PhaseItem[]
}

interface HistoryItem {
  taskId: string
  title: string
  closedAt: string
  resultNote: string
}

interface StateFile {
  version: 1
  current: CurrentLine | null
  history: HistoryItem[]
}

const EFFORTS = new Set<Effort>(['low', 'medium', 'xhigh', 'max'])
const ADVANCES = new Set<AdvancePhase>(['configure', 'route', 'execute', 'verify', 'close'])
const HISTORY_CAP = 20

function nowIso(): string {
  return new Date().toISOString()
}

function expandHome(raw: string): string {
  const p = raw.trim()
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return `${homedir()}/${p.slice(2)}`
  return p
}

function emptyState(): StateFile {
  return { version: 1, current: null, history: [] }
}

function clip(text: string, n: number): string {
  return text.length <= n ? text : `${text.slice(0, n)}…`
}

function remainingUnpassed(items: AcceptanceItem[]): AcceptanceItem[] {
  return items.filter((a) => a.status !== 'pass')
}

export function apply(ctx: Context, config: Config): void {
  const statePath = expandHome(config.statePath || '~/.dsh/taskline.json')
  const state: StateFile = emptyState()

  function hydrate(parsed: unknown): void {
    if (!parsed || typeof parsed !== 'object') return
    const raw = parsed as Partial<StateFile>
    state.version = 1
    state.current = raw.current && typeof raw.current === 'object' ? raw.current as CurrentLine : null
    state.history = Array.isArray(raw.history) ? raw.history.slice(-HISTORY_CAP) : []
  }

  function loadFromDisk(): void {
    try {
      hydrate(JSON.parse(readFileSync(statePath, 'utf8')))
    } catch {
      /* 首次运行或损坏：保持内存态 */
    }
  }

  function saveNow(): void {
    try {
      mkdirSync(dirname(statePath), { recursive: true })
      writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8')
    } catch (err) {
      console.error('[dsh-task-paradigm] 保存任务线失败:', err)
    }
  }

  loadFromDisk()

  function renderBeacon(): string {
    loadFromDisk()
    const cur = state.current
    if (!cur) return ''
    const last = cur.phases[cur.phases.length - 1]
    const phase = last?.phase ?? 'recognized'
    const total = cur.acceptance.length
    const passN = cur.acceptance.filter((a) => a.status === 'pass').length
    const firstOpen = remainingUnpassed(cur.acceptance)[0]
    const pendingText = firstOpen ? clip(firstOpen.text, 40) : '（无）'
    return [
      `〔任务主线〕${cur.taskId} · ${cur.title} · effort=${cur.effort} · 阶段=${phase}`,
      `验收进度：${passN}/${total} pass；未验第 1 条：${pendingText}`,
    ].join('\n')
  }

  function formatCurrent(cur: CurrentLine): string {
    const last5 = cur.phases.slice(-5)
    const lines = [
      `## 任务线 ${cur.taskId}`,
      '',
      `- 标题：${cur.title}`,
      `- 目标：${cur.goal}`,
      `- effort=${cur.effort} · model=${cur.model || '（未登记）'} · status=${cur.status}`,
      `- 开线：${cur.createdAt}`,
      '',
      '### 验收',
    ]
    if (cur.acceptance.length === 0) {
      lines.push('（无验收项）')
    } else {
      cur.acceptance.forEach((a, i) => {
        const ev = a.note ? ` · ${a.note}` : ''
        const at = a.verifiedAt ? ` @ ${a.verifiedAt}` : ''
        lines.push(`${i}. [${a.status}] ${a.text}${ev}${at}`)
      })
    }
    lines.push('', '### 阶段（尾部 5 条）')
    if (last5.length === 0) {
      lines.push('（无）')
    } else {
      for (const p of last5) {
        const extra = [p.note, p.anchor].filter(Boolean).join(' · ')
        lines.push(`- ${p.at} ${p.phase}${extra ? ` · ${extra}` : ''}`)
      }
    }
    return lines.join('\n')
  }

  function formatHistory(items: HistoryItem[]): string {
    if (items.length === 0) return '### 最近历史\n（无）'
    const lines = ['### 最近历史']
    for (const h of items) {
      lines.push(`- ${h.taskId} ${h.title} · closed ${h.closedAt}${h.resultNote ? ` · ${h.resultNote}` : ''}`)
    }
    return lines.join('\n')
  }

  if (config.injectProtocol !== false) {
    ctx.systemPrompt.section({
      name: 'dsh-task-paradigm-protocol',
      order: 116.7,
      text: PROTOCOL_TEXT,
    })
  }

  if (config.injectBeacon !== false) {
    ctx.systemPrompt.section({
      name: 'dsh-task-paradigm-state',
      order: 116.71,
      text: () => renderBeacon(),
    })
  }

  ctx.tools.register(defineTool({
    name: 'taskline_begin',
    description: '开一条任务主线：登记 taskId / 目标 / Effort / 验收断言。已有活跃线时必须先 close。',
    parameters: {
      taskId: { type: 'string', required: true, description: '任务 ID（与 track ISS 对齐）' },
      title: { type: 'string', required: true, description: '任务标题' },
      goal: { type: 'string', required: true, description: '一句话可验收目标' },
      effort: { type: 'string', required: true, enum: ['low', 'medium', 'xhigh', 'max'], description: 'low / medium / xhigh / max' },
      model: { type: 'string', description: '执行模型（可选）' },
      acceptance: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: '逐条可核验断言，至少 1 条',
      },
    },
    output: { schema: { type: 'string' }, render: (_args: any, value: any) => [{ type: 'text', text: String(value) }] },
    async execute(args: any) {
      loadFromDisk()
      if (state.current) {
        return `已有活跃任务线 ${state.current.taskId}，先 taskline_advance close 再开新线`
      }
      const taskId = String(args?.taskId ?? '').trim()
      const title = String(args?.title ?? '').trim()
      const goal = String(args?.goal ?? '').trim()
      const effort = String(args?.effort ?? '') as Effort
      const rawAcc = Array.isArray(args?.acceptance) ? args.acceptance : []
      const texts = rawAcc.map((x: unknown) => String(x ?? '').trim()).filter(Boolean)
      if (!taskId || !title || !goal) return 'taskId / title / goal 不能为空。'
      if (!EFFORTS.has(effort)) return 'effort 必须是 low / medium / xhigh / max。'
      if (texts.length < 1) return 'acceptance 至少 1 条可核验断言。'
      const at = nowIso()
      state.current = {
        taskId,
        title,
        goal,
        effort,
        model: typeof args?.model === 'string' ? args.model.trim() : '',
        status: 'active',
        createdAt: at,
        acceptance: texts.map((text: string) => ({ text, status: 'pending' as const, note: '', verifiedAt: '' })),
        phases: [{ phase: 'recognized', at, note: 'opened' }],
      }
      saveNow()
      return `已开任务线 ${taskId}「${title}」effort=${effort}，验收 ${texts.length} 条，阶段=recognized`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'taskline_advance',
    description: '推进任务主线阶段（configure/route/execute/verify/close）。close 硬门：验收必须全部 pass。',
    parameters: {
      phase: { type: 'string', required: true, enum: ['configure', 'route', 'execute', 'verify', 'close'], description: '目标阶段' },
      note: { type: 'string', description: '关键事实（委派了谁、改了什么）' },
      anchor: { type: 'string', description: '锚点（路径/提交/证据指针）' },
    },
    output: { schema: { type: 'string' }, render: (_args: any, value: any) => [{ type: 'text', text: String(value) }] },
    async execute(args: any) {
      loadFromDisk()
      const cur = state.current
      if (!cur) return '当前无活跃任务线，先 taskline_begin。'
      const phase = String(args?.phase ?? '') as AdvancePhase
      if (!ADVANCES.has(phase)) return 'phase 必须是 configure / route / execute / verify / close。'
      const note = typeof args?.note === 'string' ? args.note : ''
      const anchor = typeof args?.anchor === 'string' ? args.anchor : undefined

      if (phase === 'close') {
        const pending = remainingUnpassed(cur.acceptance)
        if (pending.length > 0) {
          const list = cur.acceptance
            .map((a, i) => (a.status === 'pass' ? '' : `${i}. [${a.status}] ${a.text}`))
            .filter(Boolean)
          return `拒绝关闭：验收未全部 pass。待验清单：\n${list.join('\n')}`
        }
        const at = nowIso()
        cur.phases.push({ phase, at, note, ...(anchor ? { anchor } : {}) })
        cur.status = 'closed'
        state.history.push({
          taskId: cur.taskId,
          title: cur.title,
          closedAt: at,
          resultNote: note || '',
        })
        if (state.history.length > HISTORY_CAP) {
          state.history = state.history.slice(-HISTORY_CAP)
        }
        const closedId = cur.taskId
        state.current = null
        saveNow()
        return `任务线 ${closedId} 已关闭。`
      }

      const at = nowIso()
      cur.phases.push({ phase, at, note, ...(anchor ? { anchor } : {}) })
      saveNow()
      return `任务线 ${cur.taskId} 已推进到 ${phase}${note ? ` · ${note}` : ''}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'taskline_verify',
    description: '逐条标记验收项。pass 必须在 note 附证据（文件:行号或命令输出摘要）。返回剩余未 pass 条数。',
    parameters: {
      index: { type: 'integer', required: true, description: '验收项下标，从 0 起' },
      pass: { type: 'boolean', required: true, description: 'true=pass，false=fail' },
      note: { type: 'string', description: 'pass 时放证据；fail 时放失败原因' },
    },
    output: { schema: { type: 'string' }, render: (_args: any, value: any) => [{ type: 'text', text: String(value) }] },
    async execute(args: any) {
      loadFromDisk()
      const cur = state.current
      if (!cur) return '当前无活跃任务线，先 taskline_begin。'
      const index = Number(args?.index)
      if (!Number.isInteger(index) || index < 0 || index >= cur.acceptance.length) {
        return `index 越界：${args?.index}（有效范围 0..${Math.max(0, cur.acceptance.length - 1)}）`
      }
      const item = cur.acceptance[index]
      item.status = args?.pass === true ? 'pass' : 'fail'
      item.verifiedAt = nowIso()
      item.note = typeof args?.note === 'string' ? args.note : ''
      const left = remainingUnpassed(cur.acceptance).length
      saveNow()
      return `验收[${index}] → ${item.status}。剩余未 pass ${left} 条。`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'taskline_get',
    description: '读取当前任务主线（验收逐条 + 阶段尾部 5 条）。无活跃线时返回提示 + 最近 3 条 history。',
    parameters: {
      includeHistory: { type: 'boolean', description: '为 true 时附最近 3 条已关闭摘要' },
    },
    output: { schema: { type: 'string' }, render: (_args: any, value: any) => [{ type: 'text', text: String(value) }] },
    async execute(args: any) {
      loadFromDisk()
      const recent = state.history.slice(-3)
      if (!state.current) {
        return `当前无活跃任务线\n\n${formatHistory(recent)}`
      }
      const body = formatCurrent(state.current)
      if (args?.includeHistory === true) return `${body}\n\n${formatHistory(recent)}`
      return body
    },
  }))

  ctx.on('dispose', () => {
    saveNow()
    console.log('[dsh-task-paradigm] 已卸载（任务线已落盘）')
  })

  console.log(`[dsh-task-paradigm] 已挂载 taskline_*（状态：${statePath}）`)
}
