/**
 * 飞书回复工具：按字符上限分条，支持 reply（带 message_id）或按 chatId 发送。
 */
import type * as lark from '@larksuiteoapi/node-sdk'

export function splitChunks(text: string, size: number): string[] {
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

/** 发文本给飞书：有 messageId 用回复，否则按 open_id 单发。 */
export async function replyText(
  client: any,
  chatId: string,
  text: string,
  maxChars: number,
  messageId?: string,
): Promise<void> {
  if (!text) return
  for (const chunk of splitChunks(text, maxChars)) {
    const data = { msg_type: 'text', content: JSON.stringify({ text: chunk }) }
    if (messageId) {
      await client.im.v1.message.reply({ path: { message_id: messageId }, data })
    } else {
      await client.im.v1.message.create({
        params: { receive_id_type: 'open_id' },
        data: { receive_id: chatId, ...data },
      })
    }
  }
}
