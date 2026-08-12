const FALLBACK_TITLE_LENGTH = 48
const GENERATED_TITLE_LENGTH = 80
export const SESSION_TITLE_CONTEXT_MAX_BYTES = 16 * 1024

export interface SessionTitleMessage {
  sequence: number
  role: 'user' | 'assistant' | 'summary'
  content: string
}

export function isGenericSessionTitle(value: string): boolean {
  const normalized = value.trim()
  return normalized === 'New conversation' || /^Conversation \d+$/u.test(normalized)
}

export function fallbackSessionTitle(prompt: string): string {
  const normalized = normalizeTitleText(prompt)
  return takeCodePoints(normalized, FALLBACK_TITLE_LENGTH) || 'New conversation'
}

export function sanitizeGeneratedSessionTitle(value: string): string {
  let normalized = value
    .replace(/^\s{0,3}(?:#{1,6}|[-*])\s+/u, '')
    .replace(/^\s*(?:title|conversation title|标题|会话标题)\s*[:：-]\s*/iu, '')
    .replace(/[`*_~]/gu, '')
    .trim()

  const firstLine = normalized.split(/\r?\n/u).find((line) => line.trim().length > 0) ?? ''
  normalized = firstLine
    .trim()
    .replace(/^["'“”‘’「」『』]+|["'“”‘’「」『』]+$/gu, '')
    .replace(/[.!?。！？；;，,：:、]+$/gu, '')
  normalized = normalizeTitleText(normalized)
  return takeCodePoints(normalized, GENERATED_TITLE_LENGTH)
}

export function buildSessionTitleContext(messages: readonly SessionTitleMessage[]): string {
  const ordered = [...messages]
    .filter((message) => message.content.trim().length > 0)
    .sort((left, right) => left.sequence - right.sequence)
  const firstUser = ordered.find((message) => message.role === 'user')
  const latestSummary = ordered.filter((message) => message.role === 'summary').at(-1)
  const recent = ordered
    .filter((message) => message.role !== 'summary' && message.sequence !== firstUser?.sequence)
    .slice(-24)
  const selected = [firstUser, latestSummary, ...recent].filter(
    (message): message is SessionTitleMessage => message !== undefined
  )

  const lines: string[] = []
  let bytes = 0
  for (const message of selected) {
    const label =
      message.role === 'user' ? 'USER' : message.role === 'assistant' ? 'ASSISTANT' : 'SUMMARY'
    const content = message.content.trim()
    const prefix = `${label}: `
    const remaining = SESSION_TITLE_CONTEXT_MAX_BYTES - bytes - Buffer.byteLength(prefix) - 1
    if (remaining <= 0) break
    const bounded = takeUtf8Bytes(content, remaining)
    if (bounded.length === 0) continue
    const line = `${prefix}${bounded}`
    lines.push(line)
    bytes += Buffer.byteLength(line) + 1
  }
  return lines.join('\n')
}

function normalizeTitleText(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim()
}

function takeCodePoints(value: string, limit: number): string {
  const points = Array.from(value)
  return points.length <= limit ? value : points.slice(0, limit).join('').trimEnd()
}

function takeUtf8Bytes(value: string, limit: number): string {
  if (Buffer.byteLength(value) <= limit) return value
  let result = ''
  let bytes = 0
  for (const point of value) {
    const pointBytes = Buffer.byteLength(point)
    if (bytes + pointBytes > limit) break
    result += point
    bytes += pointBytes
  }
  return result.trimEnd()
}
