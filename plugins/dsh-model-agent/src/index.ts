/**
 * dsh-model-agent · 模型可切换的全权委派工具
 *
 * 把「全权委托」做成一个可切换执行模型的插件：
 * - model_agent        委派任务给子代理执行；模型从落盘配置解析。
 *   args.model 显式指定时使用该模型并成为新默认；未配置且未指定时，
 *   返回引导文本让父代理先向用户确认（ask_user_question），用户选定后落盘沿用。
 * - model_agent_config 查询/设置默认模型（对话式切换，无需重启）。
 *
 * 模型表（代码内 DEFAULT_MODELS，可经 config.models 扩展覆盖）：
 *   grok             → ACP provider（grok CLI 登录账户，原生工具集，继承工作目录）
 *   deepseek-v4-flash→ spawn（harness 全部工具，快·省档）
 *   deepseek-v4-pro  → spawn（harness 全部工具，主模型档）
 *
 * 分工铁律：spawn 子代理拥有 harness 全部工具；ACP(grok) 子代理只有 grok 原生工具，
 * DSH 插件工具（content_* 、track_* 、vision_* 、skill_* 、scout）环节由父代理代办。
 * 完整协议见技能 dsh-model-agent-delegation。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-model-agent'
export const inject = ['tools', 'subagents', 'systemPrompt', 'approval']

interface ModelSpec {
  /** spawn = harness 内子代理（可带 agentOptions，全量工具）；acp = 外部 CLI 子进程 */
  kind?: string
  /** subagents 提供方名：spawn（内建）或 cordis.yml 里注册的 ACP provider 名 */
  provider: string
  /** spawn 用的模型 provider（如 deepseek-official） */
  llmProvider?: string
  /** spawn 用的模型 id（如 deepseek-v4-flash） */
  model?: string
  /** spawn 子代理单次输出上限 */
  maxTokens?: number
  /** 展示名 */
  label: string
}

const DEFAULT_MODELS: Record<string, ModelSpec> = {
  'deepseek-v4-flash': {
    kind: 'spawn', provider: 'spawn', llmProvider: 'deepseek-official',
    model: 'deepseek-v4-flash', maxTokens: 16384, label: 'DeepSeek V4 Flash（快·省）',
  },
  'deepseek-v4-pro': {
    kind: 'spawn', provider: 'spawn', llmProvider: 'deepseek-official',
    model: 'deepseek-v4-pro', maxTokens: 65536, label: 'DeepSeek V4 Pro（主模型档）',
  },
  grok: {
    kind: 'acp', provider: 'grok', label: 'Grok（登录账户，原生工具集）',
  },
}

const PERSONA =
  '你是全权委派执行代理：完整执行交给你的任务（读取、理解、调研、实现、验证、交付），' +
  '用尽可用工具、在指定工作目录中干活，不把任务退回父代理。' +
  '交付时给出结果、产物路径与验收说明，不要客套。'

export interface Config {
  toolName?: string
  configPath?: string
  defaultModel?: string
  /** 委派前是否走审批门（Web 弹窗 + 飞书镜像双端可见），默认 true */
  requireApproval?: boolean
  models?: Record<string, ModelSpec>
}

export const Config: Schema<Config> = Schema.object({
  toolName: Schema.string().default('model_agent'),
  /** 落盘路径；留空 = ~/.dsh/model-agent.json（服务器进程写，不受会话沙箱限制） */
  configPath: Schema.string().default(''),
  /** 首次默认模型 key；留空 = 首次调用时由父代理向用户确认 */
  defaultModel: Schema.string().default(''),
  /** 委派前是否走审批门（Web 弹窗 + 飞书镜像双端可见），默认 true */
  requireApproval: Schema.boolean().default(true),
  models: Schema.dict(Schema.object({
    kind: Schema.string().default('spawn'),
    provider: Schema.string().required(),
    llmProvider: Schema.string(),
    model: Schema.string(),
    maxTokens: Schema.number(),
    label: Schema.string().required(),
  })).default({}),
})

export function apply(ctx: Context, config: Config): void {
  const toolName = config.toolName ?? 'model_agent'
  const requireApproval = config.requireApproval ?? true
  const models: Record<string, ModelSpec> = { ...DEFAULT_MODELS, ...(config.models ?? {}) }
  const configPath =
    config.configPath && String(config.configPath).trim() !== ''
      ? String(config.configPath)
      : join(homedir(), '.dsh', 'model-agent.json')

  let persisted: { currentModel?: string } = {}
  try {
    if (existsSync(configPath)) persisted = JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch (e) {
    console.warn(`[dsh-model-agent] 读取配置失败（${configPath}）：`, e)
  }

  function save(modelKey: string): void {
    try {
      mkdirSync(dirname(configPath), { recursive: true })
      writeFileSync(
        configPath,
        JSON.stringify({ currentModel: modelKey, updatedAt: new Date().toISOString() }, null, 2),
        'utf-8',
      )
      persisted.currentModel = modelKey
    } catch (e) {
      console.warn('[dsh-model-agent] 配置落盘失败：', e)
    }
  }

  const optionList = () =>
    Object.entries(models)
      .map(([k, m]) => `  ${k} — ${m.label}`)
      .join('\n')

  function collectText(output: any[]): string {
    return (output ?? [])
      .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('\n')
      .trim()
  }

  // 静态指引：一次注册，不逐轮注入
  ctx.systemPrompt.section({
    name: 'dsh-model-agent-guidance',
    order: 116.6,
    text:
      `全权委派（用户说「用 grok agent / 交给子代理 / 全权委托」）走 ${toolName} 工具：` +
      '委派前用一句话告知用户当前使用的执行模型；' +
      `尚未配置默认模型时，先 ask_user_question 让用户选（${Object.keys(models).join(' / ')}），选定后自动落盘沿用；` +
      '用户要换模型时调 model_agent_config 或给 model_agent 传 model 参数（会成为新默认）。' +
      'grok 子代理没有 DSH 插件工具，插件环节由你（父代理）代办；flash/pro 子代理拥有全部工具。',
  })

  ctx.tools.register(defineTool({
    name: toolName,
    description:
      '模型可切换的全权委派工具：把自包含任务整包交给子代理执行，返回其最终结果。' +
      '执行模型从落盘默认配置解析；传 model 参数可指定（grok / deepseek-v4-flash / deepseek-v4-pro）并成为新默认。' +
      '未配置默认模型时，先 ask_user_question 让用户选定模型再调用。' +
      '委派会先触发审批门（Web 弹窗 + 飞书镜像双端可见，需人工批准才执行），审批被拒/取消则本次不执行。' +
      'grok 子代理拥有 grok 原生工具（bash/文件/web，继承工作目录）；flash/pro 子代理拥有 harness 全部工具。',
    parameters: {
      prompt: { type: 'string', required: true, description: '完整的自包含任务（目标+上下文路径+验收标准；子代理看不到父对话）' },
      description: { type: 'string', required: true, description: '任务简述（3-8 词，用于展示）' },
      model: { type: 'string', description: `执行模型 key：${Object.keys(models).join(' / ')}；省略 = 用落盘默认` },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: any, value: any) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: any, exec: any) {
      const parent = exec?.agent
      if (!parent) throw new Error(`${toolName} 需要调用方 agent（exec.agent 缺失）`)
      const promptText = String(args?.prompt ?? '').trim()
      if (!promptText) return '任务描述为空。请写明目标、上下文路径与验收标准。'

      const want = args?.model ? String(args.model).trim() : ''
      const current = persisted.currentModel || config.defaultModel || ''
      const key = want || current
      if (!key) {
        return (
          '尚未配置默认执行模型。请先用 ask_user_question 问用户选哪个模型（并说明各模型差异），' +
          `选定后带 model 参数重试，或先调 model_agent_config 设置默认。可选模型：\n${optionList()}`
        )
      }
      const spec = models[key]
      if (!spec) return `未知模型 "${key}"。可选：${Object.keys(models).join(' / ')}`
      if (want && want !== persisted.currentModel) save(want)
      else if (!persisted.currentModel) save(key)

      const provider = ctx.subagents.getProvider(spec.provider)
      if (provider === undefined) {
        return (
          `子代理提供方 "${spec.provider}" 未就绪，无法用 ${key} 执行。` +
          (spec.kind === 'acp'
            ? '请确认 plugins/cordis.yml 中 grok-acp-provider 已加载且 grok CLI 可用（启动日志无 "not registered yet"）。'
            : '请确认 dsh-base 的 spawn 提供方已加载（重启服务）。')
        )
      }

      // 委派审批门：整包委派会 spawn 子代理干真实活，先过审批（Web 弹窗 + 飞书镜像双端可见）
      if (requireApproval) {
        const approvalSvc = (ctx as any).approval
        if (approvalSvc && typeof approvalSvc.request === 'function') {
          const outcome = await approvalSvc.request({
            agent: parent,
            toolName: `${toolName}:${key}`,
            reason: `全权委派：${spec.label} 执行「${String(args?.description ?? '').trim().slice(0, 80)}」`,
            signal: exec.signal,
          })
          if (outcome !== 'allowed-once') {
            const why =
              outcome === 'cancelled' ? '审批已取消'
                : outcome === 'rejected' ? '审批被拒绝'
                  : '没有可用的审批通道（fail-closed）'
            return `【委派未执行 · ${spec.label}】${why}。`
          }
        }
      }

      const base: any = {
        label: `model_agent:${key}`,
        prompt: [{ type: 'text', text: promptText }],
        parent,
        signal: exec.signal,
      }
      if (spec.kind === 'spawn') {
        // 不设 toolFilter → 子代理拥有 harness 全部工具
        base.agentOptions = {
          provider: spec.llmProvider ?? 'deepseek-official',
          model: spec.model,
          maxTokens: spec.maxTokens,
        }
        base.persona = PERSONA
      }

      const run = await ctx.subagents.start(spec.provider, base)
      try {
        const result: any = await run.result
        const text = collectText(result?.output)
        const stop = result?.stopReason ?? 'unknown'
        if (stop !== 'completed' && !text) {
          throw new Error(`子代理执行未正常结束（${stop}）`)
        }
        const head = `【执行模型：${spec.label}】`
        return text
          ? `${head}${stop !== 'completed' ? `（未正常结束：${stop}）` : ''}\n${text}`
          : `${head}（无文本输出）`
      } finally {
        void Promise.resolve().then(() => run.dispose()).catch(() => {})
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'model_agent_config',
    description:
      '查询或设置 model_agent 的默认执行模型。带 model 参数 = 设为新默认（立即落盘，后续委派沿用）；不带参数 = 查询当前配置。' +
      '用户在对话中说「换模型/用 XX 模型」时调用本工具完成切换。',
    parameters: {
      model: { type: 'string', description: `要设为默认的模型 key：${Object.keys(models).join(' / ')}；省略 = 查询` },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: any, value: any) => [{ type: 'text', text: String(value) }],
    },
    execute(args: any) {
      if (!args?.model) {
        const cur = persisted.currentModel || config.defaultModel || ''
        return (
          `当前默认执行模型：${cur ? `${cur} — ${models[cur]?.label ?? '未知'}` : '（未配置，首次委派时会请用户选定）'}\n` +
          `可选模型：\n${optionList()}\n` +
          '切换：model_agent_config {model} 或 model_agent 调用时带 model 参数。'
        )
      }
      const key = String(args.model).trim()
      const spec = models[key]
      if (!spec) return `未知模型 "${key}"。可选：${Object.keys(models).join(' / ')}`
      save(key)
      return `默认执行模型已设为 ${key} — ${spec.label}。后续 model_agent 委派默认使用它；单次可再用 model 参数覆盖。`
    },
  }))

  console.log(`[dsh-model-agent] 已挂载 ${toolName} + model_agent_config（配置落盘：${configPath}）`)
}
