/**
 * jiaoyifu-vision · DeepSeek 多模态补充桥
 *
 * 升级自开源 dsh-vision-router / modlens 的思路（纯文本模型 + 视觉工具）：
 * - DeepSeek 负责思考，视觉模型只当眼睛 —— 看图是普通工具调用，文本轮零开销；
 * - 端点可配置：任意 OpenAI 兼容 /chat/completions 端点（GLM / Gemini / MiniMax / Kimi 等），
 *   key 只走环境变量（默认 VISION_API_KEY），不写进仓库；
 * - image_info 零依赖纯 JS 解析 PNG/JPEG/GIF/WebP/SVG 尺寸，不联网不花 token；
 * - 未配置端点时返回明确的中文配置指引，不静默失败。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'

export const name = 'jiaoyifu-vision'
export const inject = ['tools']

export interface Config {
  /** OpenAI 兼容 chat/completions 端点；留空则视觉工具返回配置指引 */
  endpoint?: string
  /** 视觉模型名，如 gemini-2.5-flash / glm-5.3 / minimax-vl 等 */
  model?: string
  /** 读取 API key 的环境变量名，默认 VISION_API_KEY */
  apiKeyEnv?: string
  /** 请求超时（毫秒），默认 60s */
  timeoutMs?: number
  /** 单张图片最大字节数，默认 15MB */
  maxBytes?: number
}

export const Config: Schema<Config> = Schema.object({
  endpoint: Schema.string().default(''),
  model: Schema.string().default(''),
  apiKeyEnv: Schema.string().default('VISION_API_KEY'),
  timeoutMs: Schema.number().default(60000),
  maxBytes: Schema.number().default(15 * 1024 * 1024),
})

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

/** 零依赖解析常见图片格式的宽高（PNG/JPEG/GIF/WebP/SVG）。 */
export function probeImage(buf: Buffer): { width: number; height: number; format: string } | null {
  const u8 = buf
  const ascii = (start: number, len: number): string => u8.subarray(start, start + len).toString('latin1')
  if (buf.length > 8 && ascii(0, 8) === '\x89PNG\r\n\x1a\n') {
    return { width: u8.readUInt32BE(16), height: u8.readUInt32BE(20), format: 'PNG' }
  }
  if (buf.length > 3 && u8[0] === 0xff && u8[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (u8[i] !== 0xff) {
        i += 1
        continue
      }
      const marker = u8[i + 1]
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { width: u8.readUInt16BE(i + 7), height: u8.readUInt16BE(i + 5), format: 'JPEG' }
      }
      const segLen = u8.readUInt16BE(i + 2)
      i += 2 + segLen
    }
    return null
  }
  if (buf.length > 10 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) {
    return { width: u8.readUInt16LE(6), height: u8.readUInt16LE(8), format: 'GIF' }
  }
  if (buf.length > 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    if (ascii(12, 4) === 'VP8X') {
      return { width: 1 + u8.readUIntLE(24, 3), height: 1 + u8.readUIntLE(27, 3), format: 'WebP' }
    }
    if (ascii(12, 4) === 'VP8 ') {
      return { width: u8.readUInt16LE(26) & 0x3fff, height: u8.readUInt16LE(28) & 0x3fff, format: 'WebP' }
    }
    if (ascii(12, 4) === 'VP8L') {
      const b = u8.readUInt32LE(21)
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1, format: 'WebP' }
    }
  }
  return null
}

export function apply(ctx: Context, config: Config): void {
  const endpoint = (config.endpoint ?? '').trim()
  const model = (config.model ?? '').trim()
  const apiKeyEnv = config.apiKeyEnv ?? 'VISION_API_KEY'
  const timeoutMs = config.timeoutMs ?? 60000
  const maxBytes = config.maxBytes ?? 15 * 1024 * 1024

  function notConfigured(): string {
    return [
      '视觉端点未配置。配置方法（plugins/cordis.yml 里 jiaoyifu-vision 的 config）：',
      '1. endpoint: 任意 OpenAI 兼容端点，如 https://open.bigmodel.cn/api/paas/v4/chat/completions（GLM）、',
      '   https://generativelanguage.googleapis.com/v1beta/openai/chat/completions（Gemini）等；',
      '2. model: 视觉模型名，如 glm-5.3 / gemini-2.5-flash；',
      `3. 把 API key 放进环境变量 ${apiKeyEnv}（不进仓库），重启 dsh web。`,
    ].join('\n')
  }

  /** 读取图片为 data URI。支持本地路径 / http(s) URL / 已有 data URI。 */
  async function toDataUri(image: string, mimeHint?: string): Promise<{ uri: string; bytes: number }> {
    if (image.startsWith('data:')) {
      const comma = image.indexOf(',')
      return { uri: image, bytes: Math.floor((image.length - comma - 1) * 0.75) }
    }
    let buf: Buffer
    let mime: string | undefined = mimeHint
    if (/^https?:\/\//.test(image)) {
      const res = await fetch(image, { signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok) throw new Error(`下载图片失败：HTTP ${res.status}`)
      buf = Buffer.from(await res.arrayBuffer())
      mime = mime ?? res.headers.get('content-type') ?? MIME_BY_EXT[extname(image).toLowerCase()]
    } else {
      buf = await readFile(image)
      mime = mime ?? MIME_BY_EXT[extname(image).toLowerCase()]
    }
    if (buf.length > maxBytes) throw new Error(`图片过大：${(buf.length / 1024 / 1024).toFixed(1)}MB（上限 ${maxBytes / 1024 / 1024}MB）`)
    if (!mime) throw new Error('无法判断图片 MIME 类型，请确认文件扩展名。')
    return { uri: `data:${mime};base64,${buf.toString('base64')}`, bytes: buf.length }
  }

  async function askVision(prompt: string, images: string[]): Promise<string> {
    if (!endpoint || !model) return notConfigured()
    const key = process.env[apiKeyEnv] ?? ''
    if (!key) return `未找到环境变量 ${apiKeyEnv}。请把视觉模型的 API key 放进该环境变量后重启 dsh web。`
    try {
      const uris = await Promise.all(images.map((img) => toDataUri(img)))
      const content: any[] = [{ type: 'text', text: prompt }]
      for (const u of uris) content.push({ type: 'image_url', image_url: { url: u.uri } })
      const res = await fetch(endpoint, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ model, messages: [{ role: 'user', content }], max_tokens: 1024 }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return `视觉接口报错 HTTP ${res.status}：${body.slice(0, 300)}`
      }
      const json: any = await res.json()
      const text = json?.choices?.[0]?.message?.content
      if (typeof text === 'string') return text
      if (Array.isArray(text)) {
        return text.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n') || '(视觉模型未返回文本)'
      }
      return `(解析失败) ${JSON.stringify(json).slice(0, 300)}`
    } catch (err: any) {
      return `视觉调用失败：${err?.message ?? err}`
    }
  }

  // ---------- image_info：本地解析，零 token ----------
  ctx.tools.register(defineTool({
    name: 'image_info',
    description: '读取本地图片的基本信息（格式/宽高/大小），纯本地解析，不联网、不花 token、不依赖视觉模型。',
    parameters: {
      image: { type: 'string', required: true, description: '图片本地路径' },
    },
    output: { schema: { type: 'string' }, render: (_args: any, value: any) => [{ type: 'text', text: String(value) }] },
    async execute(args: any) {
      const image = String(args?.image ?? '')
      try {
        const [buf, info] = await Promise.all([readFile(image), stat(image)])
        const probe = probeImage(buf)
        if (!probe) {
          const text = buf.subarray(0, 512).toString('utf8')
          if (text.includes('<svg')) {
            const vb = text.match(/viewBox="([^"]+)"/)
            return `SVG 矢量图：${basename(image)} · ${(info.size / 1024).toFixed(1)}KB${vb ? ` · viewBox ${vb[1]}` : ''}`
          }
          return `未识别的图片格式（前 4 字节非 PNG/JPEG/GIF/WebP/SVG）：${basename(image)} · ${(info.size / 1024).toFixed(1)}KB`
        }
        return `${probe.format} 图片：${basename(image)} · ${probe.width}×${probe.height} · ${(info.size / 1024).toFixed(1)}KB`
      } catch (err: any) {
        return `读取失败：${err?.message ?? err}`
      }
    },
  }))

  // ---------- vision_describe ----------
  ctx.tools.register(defineTool({
    name: 'vision_describe',
    description:
      '看图问答：让视觉模型描述图片内容或回答关于图片的问题（DeepSeek 负责思考，视觉模型只当眼睛）。' +
      '支持本地路径、http(s) URL。设计评审、截图分析、参考图拆解时用。',
    parameters: {
      image: { type: 'string', required: true, description: '图片路径或 URL' },
      question: { type: 'string', description: '要回答的问题；留空则整体描述图片' },
    },
    output: { schema: { type: 'string' }, render: (_args: any, value: any) => [{ type: 'text', text: String(value) }] },
    async execute(args: any) {
      const image = String(args?.image ?? '')
      const question = typeof args?.question === 'string' && args.question.trim() ? args.question.trim() : '请详细描述这张图片的内容、构图、色彩与文字。'
      if (!image) return '请提供图片路径或 URL。'
      return askVision(question, [image])
    },
  }))

  // ---------- vision_ocr ----------
  ctx.tools.register(defineTool({
    name: 'vision_ocr',
    description: '图片文字识别（OCR）：逐字提取图片中的文字，保留原有格式与层级（标题/正文/小字）。',
    parameters: {
      image: { type: 'string', required: true, description: '图片路径或 URL' },
    },
    output: { schema: { type: 'string' }, render: (_args: any, value: any) => [{ type: 'text', text: String(value) }] },
    async execute(args: any) {
      const image = String(args?.image ?? '')
      if (!image) return '请提供图片路径或 URL。'
      return askVision('请逐字提取这张图片中的所有文字，保留层级结构（标题/正文/角标/水印），原样输出，不要改写、不要翻译。', [image])
    },
  }))

  // ---------- vision_compare ----------
  ctx.tools.register(defineTool({
    name: 'vision_compare',
    description: '对比两张图片（如设计稿 vs 实现截图、修改前后），指出差异与问题。',
    parameters: {
      image_a: { type: 'string', required: true, description: '第一张图片路径或 URL' },
      image_b: { type: 'string', required: true, description: '第二张图片路径或 URL' },
      question: { type: 'string', description: '关注点；留空则全面对比差异' },
    },
    output: { schema: { type: 'string' }, render: (_args: any, value: any) => [{ type: 'text', text: String(value) }] },
    async execute(args: any) {
      const a = String(args?.image_a ?? '')
      const b = String(args?.image_b ?? '')
      if (!a || !b) return '请提供两张图片。'
      const question = typeof args?.question === 'string' && args.question.trim()
        ? `对比关注点：${args.question.trim()}`
        : '全面对比两张图片的差异（构图/文字/配色/元素位置），逐条列出，并给出修改建议。'
      return askVision(question, [a, b])
    },
  }))

  console.log(`[jiaoyifu-vision] 已加载${endpoint && model ? ` · 端点 ${model}` : ' · 视觉端点未配置（工具可用，调用时返回配置指引）'}`)
}
