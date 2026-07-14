const SENSITIVE_KEYS = /authorization|cookie|credential|password|secret|token|api[-_]?key/i
const PRIVATE_PATH = /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)[^\s"']+/g

export function redactLogValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[TRUNCATED]'
  if (typeof value === 'string')
    return value.slice(0, 32_768).replace(PRIVATE_PATH, '[PRIVATE_PATH]')
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value))
    return value.slice(0, 100).map((item) => redactLogValue(item, depth + 1))

  const redacted: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value).slice(0, 100)) {
    redacted[key] = SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redactLogValue(child, depth + 1)
  }
  return redacted
}
