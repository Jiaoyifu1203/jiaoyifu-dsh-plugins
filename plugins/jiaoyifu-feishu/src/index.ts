/**
 * jiaoyifu-feishu v2 · 飞书总控台：全任务监管 / 随时介入 / 审批
 *
 * 三层能力：
 * 1. 对话桥（v1）：飞书私聊 ↔ 每用户独立 agent 会话；
 * 2. 监管：/tasks 列出 dsh 内全部会话，任务结束/出错自动推送飞书；
 * 3. 介入 + 审批：/steer 把指令注入任意会话（运行中 steer、空闲 followup）；
 *    旁听 Web mux 的 approval/requested，飞书与浏览器同时显示，
 *    任一端先答生效（先到先得）。
 *
 * 安全：App Secret 只走环境变量 FEISHU_APP_SECRET（plugins/feishu.env）。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as lark from '@larksuiteoapi/node-sdk'
import { readFileSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { replyText } from './feishu.ts'
import { createSupervisor } from './supervisor.ts'
import type { Supervisor } from './supervisor.ts'
import { createApprover } from './approver.ts'
import type { Approver } from './approver.ts'

export const name = 'jiaoyifu-feishu'
export const inject = ['agentDefaultModel', 'agents', 'sessions']

export interface Config {
  appId: string
  appSecretEnv: string
  appSecret?: string
  allowedChatTypes: string[]
  workspaceDir: string
  maxReplyChars: number
  interimMessage: string
  resetCommands: string[]
  idleTimeoutMs: number
  /** 监管/审批推送给哪些飞书 open_id；空 = 第一个私聊用户自动绑定 */
  adminOpenIds: string[]
  /** 任务结束（含出错）时推送飞书 */
  notifyTurnEnd: boolean
  /** 任务开始时推送（容易刷屏，默认关） */
  notifyTurnStart: boolean
  /** 运行超过该毫秒数后开始报进度 */
  progressFirstAfterMs: number
  /** 进度推送最小间隔（毫秒） */
  progressIntervalMs: number
  /** 审批最长等待（毫秒），超时只清飞书 pending，不自动拒绝 */
  approvalTimeoutMs: number
  /** 监管轮询间隔（毫秒） */
  pollIntervalMs: number
  /** Web 控制台基址（仅 127.0.0.1）；拿不到 ctx.webServer.port 时用 */
  webBaseUrl: string
}

export const Config: Schema<Config> = Schema.object({
  appId: Schema.string().default(''),
  appSecretEnv: Schema.string().default('FEISHU_APP_SECRET'),
  appSecret: Schema.string().default(''),
  allowedChatTypes: Schema.array(Schema.string()).default(['p2p']),
  workspaceDir: Schema.string().default(''),
  maxReplyChars: Schema.number().default(4000),
  interimMessage: Schema.string().default('🤖 已收到，正在处理…'),
  resetCommands: Schema.array(Schema.string()).default(['/reset', '/new', '重置会话']),
  idleTimeoutMs: Schema.number().default(600000),
  adminOpenIds: Schema.array(Schema.string()).default([]),
  notifyTurnEnd: Schema.boolean().default(true),
  notifyTurnStart: Schema.boolean().default(false),
  progressFirstAfterMs: Schema.number().default(60000),
  progressIntervalMs: Schema.number().default(180000),
  approvalTimeoutMs: Schema.number().default(1800000),
  pollIntervalMs: Schema.number().default(5000),
  webBaseUrl: Schema.string().default('http://127.0.0.1:3080'),
})

interface AgentRecord {
  agent: any
  lastSeq: number
}

const NON_TEXT = '__NON_TEXT__'

export function apply(ctx: Context, config: Config): void {
  const appId = (config.appId ?? '').trim()
  let secret = (process.env[config.appSecretEnv] ?? config.appSecret ?? '').trim()
  if (!secret) {
    // 兜底：直接读仓库 plugins/feishu.env，不依赖启动 shell 是否 source 了密钥文件
    try {
      const raw = readFileSync(join(process.cwd(), 'plugins', 'feishu.env'), 'utf8')
      const m = raw.match(/^\s*FEISHU_APP_SECRET\s*=\s*(\S+)\s*$/m)
      if (m?.[1]) {
        secret = m[1].trim()
        console.log('[jiaoyifu-feishu] 从 plugins/feishu.env 直接读取了 App Secret（环境变量未提供）')
      }
    } catch { /* 无文件则保持为空 */ }
  }
  const allowedChatTypes = config.allowedChatTypes ?? ['p2p']
  const workspaceDir = (config.workspaceDir ?? '').trim() || process.cwd()
  const maxReplyChars = config.maxReplyChars ?? 4000
  const interimMessage = config.interimMessage ?? ''
  const resetCommands = config.resetCommands ?? ['/reset', '/new', '重置会话']
  const idleTimeoutMs = config.idleTimeoutMs ?? 600000
  const adminOpenIds = config.adminOpenIds ?? []
  const notifyTurnEnd = config.notifyTurnEnd ?? true
  const notifyTurnStart = config.notifyTurnStart ?? false
  const progressFirstAfterMs = config.progressFirstAfterMs ?? 60000
  const progressIntervalMs = config.progressIntervalMs ?? 180000
  const approvalTimeoutMs = config.approvalTimeoutMs ?? 1800000
  const pollIntervalMs = config.pollIntervalMs ?? 5000
  const webBaseUrl = (config.webBaseUrl ?? 'http://127.0.0.1:3080').trim() || 'http://127.0.0.1:3080'

  if (!appId || !secret) {
    console.warn(
      '[jiaoyifu-feishu] 未加载：缺少 appId 或 App Secret。' +
        'appId 配在 plugins/cordis.yml；App Secret 放进环境变量 ' +
        `${config.appSecretEnv}（用 ./scripts/start-web.sh 启动会自动加载 plugins/feishu.env）。`,
    )
    return
  }
  if (config.appSecret && config.appSecret.trim()) {
    console.warn('[jiaoyifu-feishu] 注意：appSecret 直接写在 cordis.yml，建议改用环境变量 FEISHU_APP_SECRET。')
  }

  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  if (!agents || !defaultModel) {
    console.warn('[jiaoyifu-feishu] 核心服务（agents/agentDefaultModel）不可用，本插件只在 web profile 生效。')
    return
  }

  // 防代理劫持：ws 库会读 HTTP(S)_PROXY 环境变量，本机若挂了代理会把飞书 wss 拉去代理导致连不上
  const feishuHosts = 'open.feishu.cn,.feishu.cn,open.larksuite.com,.larksuite.com'
  process.env.NO_PROXY = process.env.NO_PROXY ? `${process.env.NO_PROXY},${feishuHosts}` : feishuHosts
  process.env.no_proxy = process.env.NO_PROXY

  const client = new lark.Client({
    appId,
    appSecret: secret,
    appType: lark.AppType.SelfBuild,
    domain: lark.Domain.Feishu,
  })

  const send = (chatId: string, text: string, messageId?: string) => replyText(client, chatId, text, maxReplyChars, messageId)

  // ---------- 会话状态 ----------
  const users = new Map<string, AgentRecord>()
  const chains = new Map<string, Promise<void>>()
  const feishuSessionIds = new Set<string>()
  const sessionsFile = join(homedir(), '.dsh', 'feishu-sessions.json')
  const adminFile = join(homedir(), '.dsh', 'feishu-admin.json')
  const workspacesFile = join(homedir(), '.dsh', 'feishu-workspaces.json')
  let sessionMap: Record<string, string> = {}
  let userWorkspaces: Record<string, string> = {}
  let boundAdmin = ''
  const extraAdmins = new Set(adminOpenIds)

  async function saveSessionMap(): Promise<void> {
    try {
      await mkdir(dirname(sessionsFile), { recursive: true })
      await writeFile(sessionsFile, JSON.stringify(sessionMap, null, 2))
    } catch { /* 落盘失败不影响主流程 */ }
  }

  function adminId(): string {
    return boundAdmin || [...extraAdmins][0] || ''
  }

  function rememberAdmin(userId: string): void {
    // 只有第一个私聊用户会被自动绑定；其余用户不升级为管理员
    if (boundAdmin) return
    boundAdmin = userId
    writeFile(adminFile, JSON.stringify({ admin: userId, updatedAt: new Date().toISOString() }, null, 2)).catch(() => {})
    console.log(`[jiaoyifu-feishu] 自动绑定监管管理员：${userId.slice(0, 8)}…（改绑：删 ~/.dsh/feishu-admin.json 重启，或配 adminOpenIds）`)
  }

  function isAdmin(userId: string): boolean {
    return userId === boundAdmin || extraAdmins.has(userId)
  }

  async function createAgentFor(userId: string): Promise<AgentRecord> {
    const selection = defaultModel.currentSelection()
    const base = {
      meta: { cwd: userWorkspaces[userId] || workspaceDir },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: (agentCtx: any) => {
        installModelSelection(agentCtx, { current: selection, assembled: void 0 })
      },
    }
    const saved = sessionMap[userId]
    if (saved) {
      try {
        const handle: any = await agents.resume({ resumeSessionId: SessionId(saved), ...base })
        if (handle?.agent) {
          feishuSessionIds.add(handle.agent.session.id)
          console.log(`[jiaoyifu-feishu] 已恢复会话 ${saved}（用户 ${userId.slice(0, 8)}…）`)
          return { agent: handle.agent, lastSeq: handle.agent.session.seq }
        }
      } catch { /* resume 失败 → 新建 */ }
    }
    const id = `session-feishu-${userId.replace(/[^a-zA-Z0-9_-]/g, '')}-${Math.random().toString(36).slice(2, 10)}`
    const { agent } = await agents.create({ sessionId: SessionId(id), ...base })
    sessionMap[userId] = agent.session.id
    feishuSessionIds.add(agent.session.id)
    await saveSessionMap()
    console.log(`[jiaoyifu-feishu] 新建会话 ${agent.session.id}（用户 ${userId.slice(0, 8)}…）`)
    return { agent, lastSeq: agent.session.seq }
  }

  function summarize(events: any[], firstSeq: number): { text: string; reason: any } {
    let started = false
    let text = ''
    let reason: any
    for (const event of events) {
      if (event.seq < firstSeq) continue
      if (event.type === 'turn/start') {
        started = true
        continue
      }
      if (!started) continue
      if (event.type === 'assistant/message') {
        const joined = (event.data?.message?.content ?? [])
          .filter((block: any) => block?.type === 'text')
          .map((block: any) => block.text)
          .join('')
        if (joined !== '') text = joined
      }
      if (event.type === 'turn/end') reason = event.data?.reason
    }
    return { text, reason }
  }

  // ---------- 监管器（/tasks、/steer、进度/完成推送） ----------
  function feishuOwnerOf(sessionId: string): string | undefined {
    for (const [uid, rec] of users) {
      if (rec.agent.session.id === sessionId) return uid
    }
    return undefined
  }
  const supervisor: Supervisor = createSupervisor({
    agents,
    feishuSessionIds,
    notifyTurnEnd,
    notifyTurnStart,
    pollIntervalMs,
    progressFirstAfterMs,
    progressIntervalMs,
    adminId,
    feishuOwnerOf,
    send: (chatId: string, text: string) => send(chatId, text).catch(() => {}),
  })

  // ---------- 审批双端同步（旁听 mux，不抢瀑布） ----------
  const approver: Approver = createApprover({
    ctx,
    approvalTimeoutMs,
    adminId,
    webBaseUrl,
    send: (chatId: string, text: string) => send(chatId, text).catch(() => {}),
  })

  // ---------- 消息处理 ----------
  const APPROVE_RE = /^(批准|同意|允许|approve|y|拒绝|驳回|reject|n)(?:\s+([0-9a-zA-Z]+))?$/i
  async function handleMessage(userId: string, messageId: string, text: string): Promise<void> {
    const trimmed = text.trim()
    if (text === NON_TEXT) {
      await send(userId, '目前只支持文字消息（图片/语音暂不支持），请发一段文字。', messageId)
      return
    }
    // 首个私聊用户自动绑定为管理员（任何消息都算，含命令）
    rememberAdmin(userId)
    if (trimmed === '/ping' || trimmed === 'ping') {
      await send(userId, supervisor.pingLine(), messageId)
      return
    }
    // 工作区切换（每用户独立；影响下一个新建的会话）
    if (trimmed === '/ws' || trimmed.startsWith('/ws ')) {
      const arg = trimmed.length > 3 ? trimmed.slice(3).trim() : ''
      if (!arg) {
        const cur = userWorkspaces[userId] || workspaceDir
        await send(userId, `📂 当前工作区：${cur}\n切换：/ws <绝对路径>\n（切换后发 /reset，新会话就在该目录工作）`, messageId)
        return
      }
      const p = arg.replace(/^~/, homedir())
      let ok = false
      try {
        ok = statSync(p).isDirectory()
      } catch { /* 目录不存在 */ }
      if (!ok) {
        await send(userId, `⚠️ 目录不存在或不可访问：${p}`, messageId)
        return
      }
      userWorkspaces[userId] = p
      writeFile(workspacesFile, JSON.stringify(userWorkspaces, null, 2)).catch(() => {})
      await send(userId, `📂 工作区已切到：${p}\n发 /reset 后，新会话将在该目录下工作。`, messageId)
      return
    }
    const isAdminCmd =
      trimmed === '/tasks' || trimmed === '/任务' ||
      trimmed.startsWith('/steer ') ||
      APPROVE_RE.test(trimmed)
    if (isAdminCmd) {
      if (!isAdmin(userId)) {
        await send(userId, '⚠️ 你不是管理员：监管/介入/审批命令仅管理员可用（第一个私聊机器人的用户自动绑定，或配 cordis.yml 的 adminOpenIds）。你的普通消息仍按你自己的会话执行。', messageId)
        return
      }
      if (trimmed === '/tasks' || trimmed === '/任务') {
        await send(userId, supervisor.tasksLine(), messageId)
        return
      }
      if (trimmed.startsWith('/steer ')) {
        const body = trimmed.slice('/steer '.length).trim()
        const sp = body.indexOf(' ')
        if (sp <= 0) {
          await send(userId, '用法：/steer <会话序号|会话id前缀> <指令>。先用 /tasks 看序号。', messageId)
          return
        }
        const target = body.slice(0, sp).trim()
        const cmd = body.slice(sp + 1).trim()
        await send(userId, supervisor.steer(target, cmd), messageId)
        return
      }
      const approveMatch = trimmed.match(APPROVE_RE)
      if (approveMatch) {
        const word = approveMatch[1].toLowerCase()
        const ok = ['批准', '同意', '允许', 'approve', 'y'].includes(word)
        await send(userId, await approver.answer(ok, approveMatch[2]), messageId)
        return
      }
    }
    if (resetCommands.includes(trimmed)) {
      users.delete(userId)
      delete sessionMap[userId]
      await saveSessionMap()
      await send(userId, '🧹 会话已重置，下一条消息开始全新上下文。', messageId)
      return
    }
    let record = users.get(userId)
    if (!record) {
      record = await createAgentFor(userId)
      users.set(userId, record)
    }
    if (interimMessage) {
      await send(userId, interimMessage, messageId).catch(() => {})
    }
    const firstSeq = record.agent.session.seq
    try {
      record.agent.followup(
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'user' },
        }),
      )
    } catch (err: any) {
      await send(userId, `⚠️ 消息入队失败：${err?.message ?? err}`, messageId)
      return
    }
    let timedOut = false
    await Promise.race([
      record.agent.whenIdle().catch(() => {}),
      new Promise<void>((resolve) => {
        setTimeout(() => {
          timedOut = true
          resolve()
        }, idleTimeoutMs)
      }),
    ])
    if (timedOut) {
      await send(userId, '⏳ 这一轮耗时较长（可能卡在工具批准/长任务），我先不继续等。任务还在后台跑，你可以在 Web UI 或 /tasks 查看进度，稍后直接发下一条。', messageId)
      return
    }
    try {
      await sessions?.flush(record.agent.session)
    } catch { /* flush 失败不影响回复 */ }
    const { text: answer, reason } = summarize(record.agent.session.events, firstSeq)
    record.lastSeq = record.agent.session.seq
    if (reason?.kind === 'error') {
      const detail = reason?.error?.message ?? reason?.error?.code ?? '未知错误'
      await send(userId, `⚠️ 任务执行出错：${detail}`, messageId)
      return
    }
    if (!answer.trim()) {
      await send(userId, '(这一轮没有文本输出)', messageId)
      return
    }
    await send(userId, answer.trim(), messageId)
  }

  function enqueue(userId: string, messageId: string, text: string): void {
    const prev = chains.get(userId) ?? Promise.resolve()
    const next = prev
      .then(() => handleMessage(userId, messageId, text))
      .catch((err: any) => {
        send(userId, `⚠️ 处理失败：${err?.message ?? err}`, messageId).catch(() => {})
      })
    chains.set(userId, next)
    next.finally(() => {
      if (chains.get(userId) === next) chains.delete(userId)
    })
  }

  // ---------- 飞书长连接 ----------
  const wsClient = new lark.WSClient({
    appId,
    appSecret: secret,
    domain: lark.Domain.Feishu,
    loggerLevel: lark.LoggerLevel.warn,
    onReady: () => console.log('[jiaoyifu-feishu] ✅ 飞书长连接已建立（onReady），消息可正常收发'),
    onError: (err: any) => console.warn(`[jiaoyifu-feishu] ❌ 长连接错误：${err?.message ?? err?.code ?? err}`),
    onReconnecting: () => console.log('[jiaoyifu-feishu] ⏳ 长连接重连中…'),
    onReconnected: () => console.log('[jiaoyifu-feishu] ✅ 长连接已重连'),
  })

  const dispatcher = new lark.EventDispatcher({})
  dispatcher.register({
    'im.message.receive_v1': async (data: any) => {
      const msg = data?.message
      if (!msg?.message_id) return
      const chatType = msg.chat_type ?? ''
      if (!allowedChatTypes.includes(chatType)) return
      const sender = data?.sender?.sender_id ?? {}
      const userId = sender?.open_id || sender?.union_id || sender?.user_id || 'unknown'
      if (msg.message_type !== 'text') {
        enqueue(userId, msg.message_id, NON_TEXT)
        return
      }
      let text = ''
      try {
        const parsed = JSON.parse(msg.content ?? '{}')
        text = typeof parsed?.text === 'string' ? parsed.text : ''
      } catch {
        text = String(msg.content ?? '')
      }
      if (!text.trim()) return
      enqueue(userId, msg.message_id, text)
    },
  })

  wsClient
    .start({ eventDispatcher: dispatcher })
    .then(() => {
      console.log('[jiaoyifu-feishu] 长连接客户端已启动（等待 onReady 确认连接）')
      supervisor.start()
    })
    .catch((err: any) => console.warn(`[jiaoyifu-feishu] ❌ 长连接启动失败：${err?.message ?? err}`))

  readFile(sessionsFile, 'utf8')
    .then((raw) => {
      sessionMap = JSON.parse(raw)
      console.log(`[jiaoyifu-feishu] 已读取 ${Object.keys(sessionMap).length} 个历史会话映射`)
    })
    .catch(() => {})
  readFile(workspacesFile, 'utf8')
    .then((raw) => {
      userWorkspaces = JSON.parse(raw)
      console.log(`[jiaoyifu-feishu] 已读取 ${Object.keys(userWorkspaces).length} 个用户工作区设置`)
    })
    .catch(() => {})
  readFile(adminFile, 'utf8')
    .then((raw) => {
      const parsed = JSON.parse(raw)
      if (typeof parsed?.admin === 'string' && parsed.admin) boundAdmin = parsed.admin
      console.log(`[jiaoyifu-feishu] 已读取管理员绑定：${boundAdmin ? boundAdmin.slice(0, 8) + '…' : '(无，首个私聊用户自动绑定)'}`)
    })
    .catch(() => {})
}
