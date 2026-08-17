/**
 * 审批双端同步：旁听 Web 控制台 mux，不抢占 approval/request 瀑布。
 *
 * 旧实现用 ctx.on('approval/request', …, {prepend:true}) 独占瀑布，
 * dsh-host-apiproxy 永远认领不到请求，Web UI 弹窗不会出现。
 *
 * 现实现：延迟后 GET /api/events.mux（node:http 读 SSE），
 * 收到 approval/requested → 推飞书；浏览器由 apiproxy 自己推弹窗。
 * 飞书回「批准/拒绝」→ POST /api/respond；任一端先答生效。
 *
 * mux 打开会重放仍 pending 的 approval/requested（同 rpcId），
 * 见 dsh-host-apiproxy「Refresh recovery」——按 approvalId 去重，避免重连重复推飞书。
 */
import type { Context } from '@deepseek-ai/cordis'

const LOG = '[jiaoyifu-feishu]'
const DEFAULT_ORIGIN = 'http://127.0.0.1:3080'
const START_DELAY_MS = 1500
const RECONNECT_MS = 5000

export interface ApproverOptions {
  ctx: Context
  approvalTimeoutMs: number
  adminId: () => string
  send: (chatId: string, text: string) => void
  webBaseUrl: string
}

export interface Approver {
  answer: (ok: boolean, short?: string) => Promise<string>
}

interface Pending {
  approvalId: string
  short: string
  rpcId: string
  sessionId: string
  toolName: string
  reason?: string
  answeredByFeishu: boolean
  timer: ReturnType<typeof setTimeout>
}

function shortOf(id: string): string {
  return (id.split('-').pop() ?? id).slice(0, 6)
}

/** 从会话事件里取第一条用户消息文本（任务名来源，与 supervisor.titleOf 同款）。 */
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

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

/** 只打 127.0.0.1。优先 ctx.webServer.port（Cordis 服务名是 webServer），否则 webBaseUrl。 */
function resolveOrigin(ctx: Context, webBaseUrl: string): string {
  try {
    const ws = (ctx.get as (name: string) => { port?: number } | undefined)('webServer')
      ?? (ctx.get as (name: string) => { port?: number } | undefined)('webserver')
    const port = ws?.port
    if (typeof port === 'number' && Number.isFinite(port) && port > 0) {
      return `http://127.0.0.1:${port}`
    }
  } catch { /* 服务未就绪 */ }
  const raw = (webBaseUrl || DEFAULT_ORIGIN).trim() || DEFAULT_ORIGIN
  try {
    const url = new URL(raw)
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      console.warn(`${LOG} webBaseUrl 非本机回环（${url.hostname}），已回退 ${DEFAULT_ORIGIN}`)
      return DEFAULT_ORIGIN
    }
    return `http://127.0.0.1:${url.port || '3080'}`
  } catch {
    console.warn(`${LOG} webBaseUrl 无法解析，已回退 ${DEFAULT_ORIGIN}`)
    return DEFAULT_ORIGIN
  }
}

/** 按 DSH readSse：以 \\n\\n 分帧，拼接 data: 行后 JSON.parse（保留给可能的 SSE 回退）。 */
function takeSseFrames(buffer: string): { frames: any[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const frames: any[] = []
  let rest = normalized
  let boundary = rest.indexOf('\n\n')
  while (boundary !== -1) {
    const chunk = rest.slice(0, boundary)
    rest = rest.slice(boundary + 2)
    const data = chunk
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => (line.startsWith('data: ') ? line.slice(6) : line.slice(5)))
      .join('')
    if (data !== '') {
      try {
        frames.push(JSON.parse(data))
      } catch { /* 单帧损坏不杀流 */ }
    }
    boundary = rest.indexOf('\n\n')
  }
  return { frames, rest }
}

function envelopePayload(full: any): { rpcId: string; payload: any } | undefined {
  if (!full || typeof full !== 'object') return undefined
  const rpcId = typeof full.rpcId === 'string' ? full.rpcId : ''
  const payload = full.payload && typeof full.payload === 'object' ? full.payload : full
  if (!rpcId && !payload?.type) return undefined
  return { rpcId, payload }
}

export function createApprover(options: ApproverOptions): Approver {
  const { ctx, approvalTimeoutMs, adminId, send, webBaseUrl } = options
  const pending = new Map<string, Pending>()
  const closed = new AbortController()
  let muxReadyLogged = false

  function drop(p: Pending, notice?: string): void {
    const cur = pending.get(p.approvalId)
    if (cur !== p) return
    pending.delete(p.approvalId)
    clearTimeout(p.timer)
    if (!notice) return
    const admin = adminId()
    if (admin) send(admin, notice)
  }

  function sessionTitle(sessionId: string): string {
    try {
      const agents = ctx.get('agents') as { list?: () => any[] } | undefined
      const list = agents?.list?.() ?? []
      const agent = list.find((item) => item?.session?.id === sessionId)
      const title = agent?.session?.title
      if (typeof title === 'string' && title.trim()) return title.trim()
      const first = firstUserText(agent?.session?.events ?? [])
      if (first) {
        const one = first.replace(/\s+/g, ' ').trim()
        return one.length > 24 ? `${one.slice(0, 24)}…` : one
      }
    } catch { /* 读标题失败用短号 */ }
    return `会话 ${shortOf(sessionId)}`
  }

  function onRequested(rpcId: string, payload: any): void {
    const approvalId = typeof payload.approvalId === 'string' ? payload.approvalId : ''
    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
    const toolName = typeof payload.toolName === 'string' ? payload.toolName : 'tool'
    if (!approvalId || !rpcId) return
    const existing = pending.get(approvalId)
    if (existing) {
      existing.rpcId = rpcId
      return
    }
    const admin = adminId()
    if (!admin) return
    const short = shortOf(approvalId)
    const sid = shortOf(sessionId || '?')
    const minutes = Math.max(1, Math.round(approvalTimeoutMs / 60000))
    const text = [
      `🔐 审批请求 · ${toolName}`,
      `会话：《${sessionTitle(sessionId)}》（${sid}）`,
      payload.reason ? `原因：${payload.reason}` : '',
      `回复「批准 ${short}」或「拒绝 ${short}」（不带 id 默认最新一条）`,
      `超时 ${minutes} 分钟只取消飞书等待，不会自动拒绝（Web 端仍可点）`,
    ]
      .filter(Boolean)
      .join('\n')
    const rec: Pending = {
      approvalId,
      short,
      rpcId,
      sessionId,
      toolName,
      reason: typeof payload.reason === 'string' ? payload.reason : undefined,
      answeredByFeishu: false,
      timer: setTimeout(() => {
        drop(rec, `⏰ 等待超时 · ${short}（${toolName}）。未自动拒绝，请在 Web UI 继续处理。`)
      }, approvalTimeoutMs),
    }
    pending.set(approvalId, rec)
    send(admin, text)
  }

  function onSettled(approvalId: string): void {
    const rec = pending.get(approvalId)
    if (!rec || rec.answeredByFeishu) {
      if (rec) drop(rec)
      return
    }
    drop(rec, `已在 Web 端处理 · ${rec.short}（${rec.toolName}）`)
  }

  function handleEnvelope(full: any): void {
    const env = envelopePayload(full)
    if (!env) return
    const type = env.payload?.type
    if (type === 'approval/requested') {
      onRequested(env.rpcId, env.payload)
      return
    }
    if (type === 'approval/resolved' && typeof env.payload.approvalId === 'string') {
      onSettled(env.payload.approvalId)
      return
    }
    if (type === 'session/event' && env.payload.event?.type === 'approval/decided') {
      const id = env.payload.event?.data?.id
      if (typeof id === 'string') onSettled(id)
    }
  }

  function sweepDecided(): void {
    if (pending.size === 0) return
    let list: any[] = []
    try {
      list = (ctx.get('agents') as { list?: () => any[] } | undefined)?.list?.() ?? []
    } catch {
      return
    }
    for (const rec of [...pending.values()]) {
      const agent = list.find((item) => item?.session?.id === rec.sessionId)
      const events = agent?.session?.events
      if (!Array.isArray(events)) continue
      for (let i = events.length - 1; i >= 0; i -= 1) {
        if (events[i]?.type === 'approval/decided' && events[i]?.data?.id === rec.approvalId) {
          onSettled(rec.approvalId)
          break
        }
      }
    }
  }

  /** 把 http(s) origin 换成 ws(s) 的 mux 地址（/api/events.mux 现为 WebSocket-only）。 */
  function muxWsUrl(origin: string): string {
    const url = new URL('/api/events.mux', origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url.toString()
  }

  /**
   * 用 WebSocket 连 mux：每帧 JSON = { rpcId, payload }，与旧 SSE fullFrame 同构，
   * 直接交给 handleEnvelope。连接关闭/出错 → resolve 让 loopMux 走重连。
   */
  async function consumeMux(signal: AbortSignal): Promise<void> {
    const origin = resolveOrigin(ctx, webBaseUrl)
    const url = muxWsUrl(origin)
    const WS = (globalThis as any).WebSocket
    if (typeof WS !== 'function') {
      throw new Error('运行时缺少 WebSocket（需要 Node 22+）')
    }
    await new Promise<void>((resolve) => {
      const socket = new WS(url)
      let done = false
      const finish = () => {
        if (done) return
        done = true
        signal.removeEventListener('abort', onAbort)
        try { socket.close() } catch { /* 已关 */ }
        resolve()
      }
      const onAbort = () => finish()
      const onOpen = () => {
        if (!muxReadyLogged) {
          muxReadyLogged = true
          console.log(`${LOG} 已连接 Web mux（WebSocket），审批将双端同步（${url}）`)
        }
      }
      const onMessage = (event: any) => {
        try {
          if (typeof event.data !== 'string') return
          handleEnvelope(JSON.parse(event.data))
        } catch { /* 单帧损坏不杀流 */ }
      }
      const onClose = () => finish()
      const onError = () => { /* close 会跟着来 */ }
      socket.addEventListener('open', onOpen)
      socket.addEventListener('message', onMessage)
      socket.addEventListener('close', onClose)
      socket.addEventListener('error', onError)
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) { onAbort(); return }
    })
  }

  async function loopMux(): Promise<void> {
    const signal = closed.signal
    await sleep(START_DELAY_MS, signal)
    while (!signal.aborted) {
      try {
        await consumeMux(signal)
        if (signal.aborted) return
        console.warn(`${LOG} mux 流断开，5s 后重连`)
      } catch (err: any) {
        if (signal.aborted || err?.name === 'AbortError') return
        console.warn(`${LOG} mux 流断开，5s 后重连`)
      }
      await sleep(RECONNECT_MS, signal)
    }
  }

  async function postRespond(rec: Pending, outcome: 'allowed-once' | 'rejected'): Promise<{ accepted: boolean; reason?: string }> {
    const origin = resolveOrigin(ctx, webBaseUrl)
    const res = await fetch(`${origin}/api/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-response',
        rpcId: rec.rpcId,
        result: {
          ok: true,
          value: {
            approvalId: rec.approvalId,
            sessionId: rec.sessionId,
            outcome,
          },
        },
      }),
    })
    const json = (await res.json()) as { accepted?: boolean; reason?: string }
    return {
      accepted: json.accepted === true,
      reason: typeof json.reason === 'string' ? json.reason : undefined,
    }
  }

  void loopMux().catch((err: any) => {
    console.warn(`${LOG} mux 循环异常（已停止）：${err?.message ?? err}`)
  })

  const sweepTimer = setInterval(() => {
    try {
      sweepDecided()
    } catch { /* 轮询自愈 */ }
  }, 5000)

  ctx.on('dispose', () => {
    closed.abort()
    clearInterval(sweepTimer)
    for (const rec of pending.values()) clearTimeout(rec.timer)
    pending.clear()
  })

  return {
    async answer(ok: boolean, short?: string): Promise<string> {
      if (pending.size === 0) return '当前没有待审批的请求。'
      let target: Pending | undefined
      if (short) {
        for (const rec of pending.values()) {
          if (rec.short === short || rec.approvalId.startsWith(short) || rec.short.startsWith(short)) {
            target = rec
            break
          }
        }
        if (!target) {
          const list = [...pending.values()].map((rec) => `${rec.short}(${rec.toolName})`).join('、')
          return `⚠️ 找不到审批 ${short}。待审批：${list}`
        }
      } else {
        target = [...pending.values()][pending.size - 1]
      }
      if (!target) return '当前没有待审批的请求。'
      target.answeredByFeishu = true
      try {
        const receipt = await postRespond(target, ok ? 'allowed-once' : 'rejected')
        if (receipt.accepted) {
          drop(target)
          return `${ok ? '✅ 已批准' : '⛔ 已拒绝'} ${target.short}（${target.toolName}）`
        }
        drop(target)
        if (receipt.reason === 'not-pending') return `已在 Web 端处理 · ${target.short}（${target.toolName}）`
        return `⚠️ 审批提交未被接受（${receipt.reason ?? 'unknown'}）· ${target.short}`
      } catch (err: any) {
        target.answeredByFeishu = false
        console.warn(`${LOG} POST /api/respond 失败：${err?.message ?? err}`)
        return `⚠️ 审批提交失败：${err?.message ?? err}`
      }
    },
  }
}
