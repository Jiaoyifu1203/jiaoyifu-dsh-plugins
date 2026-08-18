/**
 * 升级自 dsh-llm-fallbacks
 *
 * 按 [primary, fallback] 顺序尝试；单个调用带超时；
 * 异常 / 空结果 / 超时则下一个；全败返回 null。
 */
export async function withLlmFallback<T>(
  models: readonly (string | undefined | null)[],
  invoke: (model: string) => Promise<T | null | undefined>,
  timeoutMs: number,
): Promise<T | null> {
  const ms = Math.max(1, Math.floor(Number(timeoutMs) || 0) || 1)
  for (const raw of models) {
    const model = String(raw ?? '').trim()
    if (!model) continue
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('llm-timeout')), ms)
      })
      const result = await Promise.race([Promise.resolve().then(() => invoke(model)), timeout])
      if (result == null) continue
      if (typeof result === 'string' && result.trim() === '') continue
      return result as T
    } catch {
      continue
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  return null
}
