/**
 * jiaoyifu-feishu · 飞书机器人 → DeepSeek Harness 桥
 *
 * 接替 OpenClaw 的飞书通道：同一个飞书自建应用（长连接模式，无需公网回调地址），
 * 私聊消息转发给本机 DSH agent（与 Web UI 同一模型选择、同一套技能/插件/工具），
 * 把最终回复文本回传到飞书。每个飞书用户对应一个独立 agent 会话：
 * - 会话内上下文连续（同 Web UI 一样）；
 * - 会话 id 落盘到 ~/.dsh/feishu-sessions.json，重启 dsh web 后尝试 resume 续上；
 * - 发 /reset（可配）重置该用户会话。
 *
 * 安全：App Secret 只走环境变量 FEISHU_APP_SECRET（由 scripts/start-web.sh 从
 * plugins/feishu.env 加载），不写进仓库文件。
 *
 * 群聊不回（allowedChatTypes 默认只有 p2p），与 OpenClaw 原 dm-only 策略一致。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as lark from '@larksuiteoapi/node-sdk'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'jiaoyifu-feishu'
export const inject = ['agentDefaultModel', 'agents', 'sessions']

export interface Config {
  /** 飞书自建应用 App ID（如 cli_xxx） */
  appId: string
  /** 读取 App Secret 的环境变量名，默认 FEISHU_APP_SECRET */
  appSecretEnv: string
  /** 兜底：直接写 secret（不推荐，优先环境变量） */
  appSecret?: string
  /** 允许响应的会话类型，默认只回私聊 p2p */
  allowedChatTypes: string[]
  /** agent 工作目录，默认 dsh 启动目录 */
  workspaceDir: string
  /** 单条飞书回复最大字符数，超出自动分条 */
  maxReplyChars: number
  /** 开始处理前先回一条提示（类似“正在输入”），空字符串关闭 */
  interimMessage: string
  /** 触发重置会话的命令词 */
  resetCommands: string[]
  /** 单轮 agent 最长等待时间（毫秒），超时先回提示，任务继续后台跑 */
  idleTimeoutMs: number
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
})

interface AgentRecord {
  agent: any
  lastSeq: number
}

/** 与官方 dsh-headless 同款的 turn 结果汇总：只收本轮的最终助手文本与结束原因。 */
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

function splitChunks(text: string, size: number): string[] {
  if (text.length <= size) return [text]
  const chunks: string[] = []
  let rest = text
  while (rest.length > size) {
    chunks.push(rest.slice(0, size))
    rest = rest.slice(size)
  }
  if (rest) chunks.push(rest)
  return chunks
}

export function apply(ctx: Context, config: Config): void {
  const appId = (config.appId ?? '').trim()
  const secret = (process.env[config.appSecretEnv] ?? config.appSecret ?? '').trim()
  const allowedChatTypes = config.allowedChatTypes ?? ['p2p']
  const workspaceDir = (config.workspaceDir ?? '').trim() || process.cwd()
  const maxReplyChars = config.maxReplyChars ?? 4000
  const interimMessage = config.interimMessage ?? ''
  const resetCommands = config.resetCommands ?? ['/reset', '/new', '重置会话']
  const idleTimeoutMs = config.idleTimeoutMs ?? 600000

  if (!appId || !secret) {
    console.warn(
      '[jiaoyifu-feishu] 未加载：缺少 appId 或 App Secret。' +
        '请在 plugins/cordis.yml 配置 appId，并把 App Secret 放进环境变量 ' +
        `${config.appSecretEnv}（plugins/feishu.env 由 start-web.sh 自动加载）。`,
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

  const client = new lark.Client({
    appId,
    appSecret: secret,
    appType: lark.AppType.SelfBuild,
    domain: lark.Domain.Feishu,
  })
  const wsClient = new lark.WSClient({
    appId,
    appSecret: secret,
    domain: lark.Domain.Feishu,
    loggerLevel: lark.LoggerLevel.error,
  })

  // ---------- 会话状态：内存 agent + 落盘 sessionId 映射 ----------
  const users = new Map<string, AgentRecord>()
  const chains = new Map<string, Promise<void>>()
  const sessionsFile = join(homedir(), '.dsh', 'feishu-sessions.json')
  let sessionMap: Record<string, string> = {}

  async function saveSessionMap(): Promise<void> {
    try {
      await mkdir(dirname(sessionsFile), { recursive: true })
      await writeFile(sessionsFile, JSON.stringify(sessionMap, null, 2))
    } catch {
      /* 落盘失败不影响主流程 */
    }
  }

  /** 为飞书用户准备 agent：优先 resume 落盘的会话，失败则新建。 */
  async function createAgentFor(userId: string): Promise<AgentRecord> {
    const selection = defaultModel.currentSelection()
    const base = {
      meta: { cwd: workspaceDir },
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
          console.log(`[jiaoyifu-feishu] 已恢复会话 ${saved}（用户 ${userId.slice(0, 8)}…）`)
          return { agent: handle.agent, lastSeq: handle.agent.session.seq }
        }
      } catch {
        /* resume 失败（会话已清/后端不支持）→ 走新建 */
      }
    }
    const id = `session-feishu-${userId.replace(/[^a-zA-Z0-9_-]/g, '')}-${Math.random().toString(36).slice(2, 10)}`
    const { agent } = await agents.create({ sessionId: SessionId(id), ...base })
    sessionMap[userId] = agent.session.id
    await saveSessionMap()
    console.log(`[jiaoyifu-feishu] 新建会话 ${agent.session.id}（用户 ${userId.slice(0, 8)}…）`)
    return { agent, lastSeq: agent.session.seq }
  }

  async function reply(messageId: string, text: string): Promise<void> {
    if (!text) return
    for (const chunk of splitChunks(text, maxReplyChars)) {
      await client.im.v1.message.reply({
        path: { message_id: messageId },
        data: { msg_type: 'text', content: JSON.stringify({ text: chunk }) },
      })
    }
  }

  async function handleMessage(userId: string, messageId: string, text: string): Promise<void> {
    if (text === '__NON_TEXT__') {
      await reply(messageId, '目前只支持文字消息（图片/语音暂不支持），请发一段文字。')
      return
    }
    if (resetCommands.includes(text.trim())) {
      users.delete(userId)
      delete sessionMap[userId]
      await saveSessionMap()
      await reply(messageId, '🧹 会话已重置，下一条消息开始全新上下文。')
      return
    }
    let record = users.get(userId)
    if (!record) {
      record = await createAgentFor(userId)
      users.set(userId, record)
    }
    if (interimMessage) {
      await reply(messageId, interimMessage).catch(() => {})
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
      await reply(messageId, `⚠️ 消息入队失败：${err?.message ?? err}`)
      return
    }
    // 单轮限时等待；超时任务仍在后台跑，先回提示不阻塞飞书侧
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
      await reply(messageId, '⏳ 这一轮耗时较长（可能卡在工具批准/长任务），我先不继续等。任务还在后台跑，你可以在 Web UI 查看进度，或稍后直接发下一条。')
      return
    }
    try {
      await sessions?.flush(record.agent.session)
    } catch {
      /* flush 失败不影响回复 */
    }
    const { text: answer, reason } = summarize(record.agent.session.events, firstSeq)
    record.lastSeq = record.agent.session.seq
    if (reason?.kind === 'error') {
      const detail = reason?.error?.message ?? reason?.error?.code ?? '未知错误'
      await reply(messageId, `⚠️ 任务执行出错：${detail}`)
      return
    }
    if (!answer.trim()) {
      await reply(messageId, '(这一轮没有文本输出)')
      return
    }
    await reply(messageId, answer.trim())
  }

  function enqueue(userId: string, messageId: string, text: string): void {
    const prev = chains.get(userId) ?? Promise.resolve()
    const next = prev
      .then(() => handleMessage(userId, messageId, text))
      .catch((err: any) => {
        reply(messageId, `⚠️ 处理失败：${err?.message ?? err}`).catch(() => {})
      })
    chains.set(userId, next)
    // 防止 Map 无限增长：任务结束后清理
    next.finally(() => {
      if (chains.get(userId) === next) chains.delete(userId)
    })
  }

  const dispatcher = new lark.EventDispatcher({})
  dispatcher.register({
    'im.message.receive_v1': async (data: any) => {
      const msg = data?.message
      if (!msg?.message_id) return
      const chatType = msg.chat_type ?? ''
      if (!allowedChatTypes.includes(chatType)) return // 群聊/其他会话不回
      const sender = data?.sender?.sender_id ?? {}
      const userId = sender?.open_id || sender?.union_id || sender?.user_id || 'unknown'
      if (msg.message_type !== 'text') {
        enqueue(userId, msg.message_id, '__NON_TEXT__')
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
    .then(() => console.log('[jiaoyifu-feishu] 飞书长连接已启动（仅回私聊，群聊忽略）'))
    .catch((err: any) => console.warn(`[jiaoyifu-feishu] 飞书长连接启动失败：${err?.message ?? err}`))

  // 启动时加载落盘的会话映射
  readFile(sessionsFile, 'utf8')
    .then((raw) => {
      sessionMap = JSON.parse(raw)
      console.log(`[jiaoyifu-feishu] 已读取 ${Object.keys(sessionMap).length} 个历史会话映射`)
    })
    .catch(() => {})
}
