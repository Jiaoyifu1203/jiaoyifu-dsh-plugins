/**
 * 审批接管：以 prepend:true 注册 approval/request 瀑布监听，
 * 抢在浏览器答案器（dsh-host-apiproxy）之前认领审批请求：
 * - 有绑定管理员 → 推飞书问题，等待「批准/拒绝」回复（超时 fail-closed）；
 * - 无绑定管理员 → next() 交还给浏览器正常弹窗。
 */
import type { Context } from '@deepseek-ai/cordis'

export interface ApproverOptions {
  ctx: Context
  approvalTimeoutMs: number
  adminId: () => string
  send: (chatId: string, text: string) => void
}

export interface Approver {
  answer: (ok: boolean, short?: string) => string
}

interface Pending {
  id: string
  short: string
  toolName: string
  reason?: string
  settle: (outcome: string) => void
  timer: ReturnType<typeof setTimeout>
}

export function createApprover(options: ApproverOptions): Approver {
  const { ctx, approvalTimeoutMs, adminId, send } = options
  const pending = new Map<string, Pending>()

  ctx.on(
    'approval/request',
    (req: any, next: () => Promise<any>) => {
      const admin = adminId()
      if (!admin) return next() // 无飞书管理员 → 交还浏览器
      if (req?.signal?.aborted === true) return Promise.resolve('cancelled')
      const events = req?.agent?.session?.events ?? []
      // 镜像 dsh-host-apiproxy 的认领逻辑：最近一条未决定、未被认领的 approval/asked
      const claimed = new Set(pending.keys())
      const decided = new Set<string>()
      let approvalId: string | undefined
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i]
        if (event.type === 'approval/decided') decided.add(event.data.id)
        else if (event.type === 'approval/asked') {
          if (decided.has(event.data.id) || claimed.has(event.data.id)) continue
          if ((req.callId ?? null) !== (event.data.callId ?? null)) continue
          approvalId = event.data.id
          break
        }
      }
      if (!approvalId) return next()
      const id = approvalId
      const short = id.split('-').pop()?.slice(0, 6) ?? id.slice(0, 6)
      const sid = String(req.agent.session?.id ?? '').split('-').pop()?.slice(0, 6) ?? '?'
      const title = req.agent.session?.title ?? `会话 ${sid}`
      const text = [
        `🔐 审批请求 · ${req.toolName}`,
        `会话：《${title}》（${sid}）`,
        req.reason ? `原因：${req.reason}` : '',
        `回复「批准 ${short}」或「拒绝 ${short}」（不带 id 默认最新一条）`,
        `超时 ${Math.round(approvalTimeoutMs / 60000)} 分钟自动拒绝（fail-closed）`,
      ]
        .filter(Boolean)
        .join('\n')
      send(admin, text)
      return new Promise<string>((resolve) => {
        const settle = (outcome: string) => {
          const p = pending.get(id)
          if (!p) return
          pending.delete(id)
          clearTimeout(p.timer)
          req.signal?.removeEventListener('abort', onAbort)
          resolve(outcome)
        }
        const onAbort = () => settle('cancelled')
        req.signal?.addEventListener('abort', onAbort, { once: true })
        const timer = setTimeout(() => {
          send(admin, `⏰ 审批 ${short}（${req.toolName}）等待超时，已按 fail-closed 拒绝。`)
          settle('unavailable')
        }, approvalTimeoutMs)
        pending.set(id, {
          id,
          short,
          toolName: req.toolName,
          reason: req.reason,
          settle,
          timer,
        })
      })
    },
    { prepend: true } as any,
  )

  return {
    answer(ok: boolean, short?: string): string {
      if (pending.size === 0) return '当前没有待审批的请求。'
      let target: Pending | undefined
      if (short) {
        for (const p of pending.values()) {
          if (p.short === short || p.id.startsWith(short) || p.short.startsWith(short)) {
            target = p
            break
          }
        }
        if (!target) {
          const list = [...pending.values()].map((p) => `${p.short}(${p.toolName})`).join('、')
          return `⚠️ 找不到审批 ${short}。待审批：${list}`
        }
      } else {
        target = [...pending.values()][pending.size - 1]
      }
      const outcome = ok ? 'allowed-once' : 'rejected'
      target.settle(outcome)
      return `${ok ? '✅ 已批准' : '⛔ 已拒绝'} ${target.short}（${target.toolName}）`
    },
  }
}
