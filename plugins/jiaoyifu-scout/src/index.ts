/**
 * jiaoyifu-scout · v4-flash 轻量扫描代理
 *
 * 升级自 dsh-subagent-tools 的「按调用覆盖 model/provider」思路：
 * 大任务执行中，把「扫描/检索/批量核对/资料搜集」类杂活自动分派给
 * deepseek-v4-flash 代理执行——主模型（v4-pro）的 token 留给核心决策，
 * 杂活由廉价模型消化，省钱且不占主上下文。
 *
 * 能力：
 * 1. scout 工具 —— 前台一次性派发：自包含任务描述 → spawn 一个 flash 子代理
 *    （只读工具：read/glob/grep/bash/web_search），返回紧凑结果文本；
 * 2. 自动分配指引 —— systemPrompt 注入静态段：告诉主模型什么算「扫描类杂活」、
 *    何时优先用 scout（一次性成本，不逐轮注入）；
 * 3. 提供方感知挂载 —— subagent provider 未就绪时等待 provider-added 事件再挂工具。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'jiaoyifu-scout'
export const inject = ['tools', 'subagents', 'systemPrompt']

export interface Config {
  /** 子代理提供方名（默认 spawn，进程内隔离） */
  provider?: string
  /** 子代理模型 provider（默认 deepseek-official） */
  llmProvider?: string
  /** 子代理模型（默认 deepseek-v4-flash，便宜档） */
  model?: string
  /** 子代理单次输出上限（默认 4096） */
  maxTokens?: number
  /** 暴露给模型的工具名（默认 scout） */
  toolName?: string
  /** 是否注入「自动分派」指引段（默认开） */
  autoGuidance?: boolean
}

export const Config: Schema<Config> = Schema.object({
  provider: Schema.string().default('spawn'),
  llmProvider: Schema.string().default('deepseek-official'),
  model: Schema.string().default('deepseek-v4-flash'),
  maxTokens: Schema.number().default(4096),
  toolName: Schema.string().default('scout'),
  autoGuidance: Schema.boolean().default(true),
})

/** scout 代理人格：只干杂活，不规划不重构，输出紧凑 */
const SCOUT_PERSONA =
  '你是轻量扫描代理（跑在 deepseek-v4-flash 上）。只执行派给你的扫描/检索/批量核对类小事：' +
  '不规划、不重构、不写新功能、不做大决策。忠实执行，输出紧凑结果（要点 + 文件路径 + 行号），不要客套。'

export function apply(ctx: Context, config: Config): void {
  const providerName = config.provider ?? 'spawn'
  const llmProvider = config.llmProvider ?? 'deepseek-official'
  const model = config.model ?? 'deepseek-v4-flash'
  const maxTokens = config.maxTokens ?? 4096
  const toolName = config.toolName ?? 'scout'
  let disposeTool: (() => void) | null = null

  // 自动分派指引：注册一次（静态段，不逐轮注入）
  if (config.autoGuidance !== false) {
    ctx.systemPrompt.section({
      name: 'jiaoyifu-scout-guidance',
      order: 116.5,
      text:
        '大任务执行中，遇到「扫描代码/检索引用/批量核对清单/搜集资料」类可拆分子任务时，优先调用 scout 工具' +
        `分派给 ${model} 轻量代理执行，把主模型 token 留给核心决策。分派要点：任务描述必须自包含（代理看不到当前对话）；` +
        '一次只派一件扫描类小事；需要结果才能继续时不要后台化。',
    })
  }

  function mount(): void {
    if (disposeTool) return
    disposeTool = ctx.tools.register(defineTool({
      name: toolName,
      description:
        `把扫描/检索/批量核对类杂活分派给 ${model} 轻量代理执行（省主模型 token）。` +
        '大任务中遇到「扫一遍代码/查所有引用/核对清单/汇总搜索结果」这类活优先用它。' +
        '任务描述要自包含：写明目标、范围、期望输出格式（代理看不到当前对话上下文）。',
      parameters: {
        task: { type: 'string', required: true, description: '要执行的具体任务（自包含：目标+范围+期望输出格式）' },
        kind: { type: 'string', description: '任务类型：scan 代码扫描 / search 检索搜集 / verify 批量核对 / summary 汇总，默认 scan' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args: any, value: any) => [{ type: 'text', text: String(value) }],
      },
      async execute(args: any, exec: any) {
        const parent = exec?.agent
        if (!parent) throw new Error('scout 需要调用方 agent（exec.agent 缺失）')
        const task = String(args?.task ?? '').trim()
        if (!task) return '任务描述为空。请写明目标、范围、期望输出格式。'
        const run = await ctx.subagents.start(providerName, {
          label: `scout:${String(args?.kind ?? 'scan')}`,
          prompt: [{ type: 'text', text: task }],
          parent,
          agentOptions: { provider: llmProvider, model, maxTokens },
          persona: SCOUT_PERSONA,
          toolFilter: { allow: ['read', 'glob', 'grep', 'bash', 'web_search'] },
          signal: exec.signal,
        })
        try {
          const result = await run.result
          const text = (result?.output ?? [])
            .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
            .map((b: any) => b.text)
            .join('\n')
          if (!text.trim()) return `(scout 代理没有返回文本：${result?.stopReason ?? 'unknown'})`
          return text
        } finally {
          void Promise.resolve().then(() => run.dispose()).catch(() => {})
        }
      },
    }))
    console.log(`[jiaoyifu-scout] scout 工具已挂载 → ${llmProvider}/${model}（提供方 ${providerName}）`)
  }

  const present = ctx.subagents.getProvider(providerName)
  if (present !== undefined) mount()
  else console.log(`[jiaoyifu-scout] 子代理提供方 "${providerName}" 未就绪，等待 provider-added 后挂载`)

  ctx.on('subagent/provider-added', (provider: any) => {
    if (provider?.name === providerName) mount()
  })
  ctx.on('subagent/provider-removed', (removed: string) => {
    if (removed === providerName && disposeTool) {
      disposeTool()
      disposeTool = null
    }
  })
  ctx.on('dispose', () => {
    console.log('[jiaoyifu-scout] 已卸载')
  })
}
