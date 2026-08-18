/**
 * jiaoyifu-studio · 被动质检（advisor / proofreading 简化）
 *
 * content_write 写 script.md / article.md 成功后异步跑一次廉价模型。
 * 任何失败静默（debug）；不得阻塞工具返回，不得产生 unhandledRejection。
 */
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { withLlmFallback } from './llm-fallback.ts'
import { updateQc, type QcInfo } from './store.ts'

export interface QcRuntime {
  enabled: boolean
  root: string
  slug: string
  file: string
  content: string
  provider: string
  model: string
  fallbackModel: string
  timeoutMs: number
  llm?: { stream?: (req: unknown) => AsyncIterable<unknown> }
}

export function parseQcJson(text: string): Omit<QcInfo, 'file' | 'at'> | null {
  const raw = String(text ?? '')
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)
  const body = (fenced?.[1] ?? raw).trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const obj = JSON.parse(body.slice(start, end + 1)) as { notes?: unknown; verdict?: unknown }
    const verdict = obj.verdict === '通过' || obj.verdict === '建议修改' ? obj.verdict : null
    if (!verdict) return null
    const notes = Array.isArray(obj.notes)
      ? obj.notes
        .filter((n): n is string => typeof n === 'string')
        .map((n) => n.trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, 3)
      : []
    return { notes, verdict }
  } catch {
    return null
  }
}

async function collectText(llm: NonNullable<QcRuntime['llm']>, provider: string, model: string, prompt: string): Promise<string> {
  if (typeof llm.stream !== 'function') return ''
  const assembler = new BlockAssembler()
  const stream = llm.stream({
    provider,
    model,
    messages: [createUserMessage({
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'plugin', plugin: 'jiaoyifu-studio', form: 'notice', summary: '内容质检' },
    })],
    maxTokens: 200,
    temperature: 0,
  })
  for await (const chunk of stream) assembler.push(chunk)
  return assembler.blocks()
    .filter((b: { type?: string }) => b.type === 'text')
    .map((b: { text?: string }) => String(b.text ?? ''))
    .join('\n')
}

async function runQc(opts: QcRuntime): Promise<void> {
  const fileName = opts.file === 'article' ? 'article.md' : opts.file === 'script' ? 'script.md' : ''
  if (!fileName) return
  const prompt = [
    '你是内容质检员（proofreading 简化版）。只检查三类问题：',
    '1. AI 腔（空洞比喻、排比堆砌）',
    '2. 数字无来源',
    '3. 结构断裂',
    '只输出 JSON，不要解释：{"notes":["≤40字/条"],"verdict":"通过|建议修改"}',
    'notes 最多 3 条。无明显问题则 notes 为空数组且 verdict 为「通过」。',
    '',
    `文件：${fileName}`,
    '正文：',
    String(opts.content ?? '').slice(0, 4000),
  ].join('\n')
  const parsed = await withLlmFallback(
    [opts.model, opts.fallbackModel],
    async (model) => parseQcJson(await collectText(opts.llm!, opts.provider, model, prompt)),
    opts.timeoutMs,
  )
  if (!parsed) return
  const qc: QcInfo = {
    file: fileName,
    at: new Date().toISOString(),
    notes: parsed.notes,
    verdict: parsed.verdict,
  }
  await updateQc(opts.root, opts.slug, qc)
}

/** 不阻塞调用方：setTimeout(0) + 内部 promise.catch，避免 unhandledRejection。 */
export function scheduleQc(opts: QcRuntime): void {
  if (!opts.enabled) return
  if (opts.file !== 'script' && opts.file !== 'article') return
  if (!opts.llm || typeof opts.llm.stream !== 'function') return
  setTimeout(() => {
    void runQc(opts).catch((err) => {
      console.debug('[jiaoyifu-studio] qc skipped:', err)
    })
  }, 0)
}
