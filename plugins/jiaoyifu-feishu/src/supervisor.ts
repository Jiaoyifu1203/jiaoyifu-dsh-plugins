/**
 * 监管器：全任务可见性 + 随时介入 + 进度/完成推送。
 * - /tasks：列出 dsh 内全部活 agent（短号、状态、标题、工作目录、已运行时长）；
 * - /steer：把用户指令注入任意会话（运行中 agent.steer，空闲 agent.followup）；
 * - 轮询每个 agent：任务开始（可配）、运行中定期进度（含最近工具）、结束/出错推送；
 *   非飞书会话推给管理员；飞书自己的会话把进度推给该用户。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'

export interface SupervisorOptions {
  agents: any
  feishuSessionIds: Set<string>
  notifyTurnEnd: boolean
  notifyTurnStart: boolean
  pollIntervalMs: number
  progressFirstAfterMs: number
  progressIntervalMs: number
  adminId: () => string
  feishuOwnerOf: (sessionId: string) => string | undefined
  send: (chatId: string, text: string) => void
}

export interface Supervisor {
  start: () => void
  pingLine: () => string
  tasksLine: () => string
  steer: (target: string, cmd: string) => string
}

function shortId(id: string): string {
  const tail = id.split('-').pop() ?? id
  return tail.slice(0, 6)
}

/** 从会话事件里取第一条用户消息文本（任务名的主要来源）。 */
function firstUserText(events: any[]): string {
  for (const event of events) {
    if (event.type !== 'user/message') continue
    const blocks = event.data?.content ?? []
    for (const block of blocks) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        return block.text.trim()
      }
    }
  }
  return ''
}

/** 任务名：会话标题 > 首条用户消息（截断 24 字）> 会话短编号。 */
function titleOf(agent: any): string {
  const title = agent.session?.title
  if (typeof title === 'string' && title.trim()) return title.trim()
  const first = firstUserText(agent.session?.events ?? [])
  if (first) {
    const one = first.replace(/\s+/g, ' ').trim()
    return one.length > 24 ? `${one.slice(0, 24)}…` : one
  }
  return `会话 ${shortId(agent.session?.id ?? agent.id ?? '?')}`
}

function cwdOf(agent: any): string {
  const cwd = agent.session?.header?.cwd ?? ''
  if (!cwd) return ''
  const parts = cwd.split('/')
  return parts.slice(-2).join('/') || cwd
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${s % 60}s`
  return `${Math.floor(m / 60)}h${m % 60}m`
}

/** 最近一次 turn/start 的时间戳（事件带 time 时用真实时间）。 */
function turnStartMs(events: any[]): number | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event.type === 'turn/start') return typeof event.time === 'number' ? event.time : undefined
  }
  return undefined
}

/** 最近一次工具调用名。 */
function lastTool(events: any[]): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].type === 'tool/call') return events[i].data?.name ?? ''
  }
  return ''
}

export function createSupervisor(options: SupervisorOptions): Supervisor {
  const {
    agents, feishuSessionIds, notifyTurnEnd, notifyTurnStart,
    pollIntervalMs, progressFirstAfterMs, progressIntervalMs,
    adminId, feishuOwnerOf, send,
  } = options
  const lastSeen = new Map<string, number>()
  const runs = new Map<string, { start: number; lastProgress: number }>()
  let timer: ReturnType<typeof setInterval> | undefined

  function poll(): void {
    if (!notifyTurnEnd && progressFirstAfterMs <= 0) return
    let list: any[] = []
    try {
      list = agents.list()
    } catch {
      return
    }
    for (const agent of list) {
      const sid = agent.session?.id
      const isFeishu = feishuSessionIds.has(sid)
      const target = isFeishu ? feishuOwnerOf(sid) : adminId()
      if (!target) continue
      const events = agent.session?.events ?? []
      if (!Array.isArray(events)) continue
      const seq = events.length > 0 ? (events[events.length - 1]?.seq ?? 0) : 0
      const from = lastSeen.get(agent.id) ?? seq
      lastSeen.set(agent.id, seq)

      // 新事件：开始/结束/出错
      if (from < seq) {
        for (const event of events) {
          if (event.seq <= from) continue
          if (event.type === 'turn/start') {
            if (notifyTurnStart && !isFeishu) {
              send(target, `🚀 任务开始 · 《${titleOf(agent)}》${cwdOf(agent) ? ` · ${cwdOf(agent)}` : ''}`)
            }
          } else if (event.type === 'turn/end') {
            if (!notifyTurnEnd) continue
            if (isFeishu) continue // 飞书会话的结束由对话回复流负责
            const reason = event.data?.reason
            const kind = reason?.kind ?? 'completed'
            if (kind === 'error') {
              const err = reason?.error?.message ?? reason?.error?.code ?? '未知错误'
              send(target, `🔴 任务出错 · 《${titleOf(agent)}》\n${cwdOf(agent) ? `目录：${cwdOf(agent)}\n` : ''}错误：${String(err).slice(0, 200)}`)
            } else {
              send(target, `✅ 任务完成 · 《${titleOf(agent)}》${cwdOf(agent) ? ` · ${cwdOf(agent)}` : ''}\n会话 ${shortId(sid)} · 回复 /steer ${shortId(sid)} <指令> 可继续介入`)
            }
          }
        }
      }

      // 运行中定期进度（飞书会话发给本人，其余发给管理员）
      if (agent.status === 'running') {
        let rec = runs.get(agent.id)
        if (!rec) {
          const ts = turnStartMs(events)
          rec = { start: typeof ts === 'number' ? ts : Date.now(), lastProgress: 0 }
          runs.set(agent.id, rec)
        }
        const elapsed = Date.now() - rec.start
        if (elapsed >= progressFirstAfterMs && Date.now() - rec.lastProgress >= progressIntervalMs) {
          rec.lastProgress = Date.now()
          const tool = lastTool(events)
          send(target, `⏳ 仍在运行 · 已 ${fmtDuration(elapsed)}${tool ? ` · 最近工具：${tool}` : ''} · 《${titleOf(agent)}》`)
        }
      } else {
        runs.delete(agent.id)
      }
    }
  }

  function start(): void {
    if (timer) clearInterval(timer)
    timer = setInterval(() => {
      try {
        poll()
      } catch { /* 轮询异常自愈 */ }
    }, pollIntervalMs)
  }

  function pingLine(): string {
    const admin = adminId()
    let list: any[] = []
    try {
      list = agents.list()
    } catch { /* ignore */ }
    const running = list.filter((a) => a.status === 'running').length
    return `✅ 飞书桥在线\n· 活会话 ${list.length} 个（运行中 ${running}）\n· 管理员绑定：${admin ? '已绑定' : '未绑定（首个私聊自动绑定）'}\n· 命令：/tasks /steer /ws /reset /ping`
  }

  function tasksLine(): string {
    let list: any[] = []
    try {
      list = agents.list()
    } catch {
      return '⚠️ 无法读取会话列表（agents 服务不可用）'
    }
    if (list.length === 0) return '当前没有活会话（历史会话请到 Web UI 侧栏查看）。'
    const rows = list
      .map((agent, index) => {
        const id = shortId(agent.session?.id ?? agent.id)
        const state = agent.status === 'running' ? '🔵 运行中' : '⚪ 空闲'
        const title = titleOf(agent)
        const cwd = cwdOf(agent)
        let secs = ''
        if (agent.status === 'running') {
          const events = agent.session?.events ?? []
          const ts = turnStartMs(events)
          if (typeof ts === 'number') secs = `（已 ${fmtDuration(Date.now() - ts)}）`
        }
        const isFeishu = feishuSessionIds.has(agent.session?.id)
        return `${index + 1}. ${state} ${title}${secs}${cwd ? ` · ${cwd}` : ''} · 会话 ${id}${isFeishu ? ' · 飞书' : ''}`
      })
      .join('\n')
    return `📋 活会话 ${list.length} 个\n${rows}\n\n介入：/steer <序号|会话id> <指令>`
  }

  function steer(target: string, cmd: string): string {
    let list: any[] = []
    try {
      list = agents.list()
    } catch {
      return '⚠️ 无法读取会话列表'
    }
    const index = Number.parseInt(target, 10)
    let agent: any
    if (Number.isFinite(index) && index >= 1 && index <= list.length) {
      agent = list[index - 1]
    } else {
      agent = list.find((a) => {
        const id = a.session?.id ?? a.id ?? ''
        return id.includes(target) || id.toLowerCase().includes(target.toLowerCase())
      })
    }
    if (!agent) return `⚠️ 找不到会话「${target}」。用 /tasks 看序号或会话 id。`
    const id = shortId(agent.session?.id ?? agent.id)
    const msg = createUserMessage({
      content: [{ type: 'text', text: `【飞书介入】${cmd}` }],
      source: { kind: 'user' },
    })
    if (agent.status === 'running') {
      agent.steer(msg)
      return `🎯 已介入会话 ${id}（运行中，指令进入当前步骤）：${cmd.slice(0, 80)}`
    }
    agent.followup(msg)
    return `🎯 已向会话 ${id} 派发新任务：${cmd.slice(0, 80)}`
  }

  return { start, pingLine, tasksLine, steer }
}
