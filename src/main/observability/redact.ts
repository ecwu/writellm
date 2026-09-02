import { redactAgentDiagnosticText } from '../../shared/agent-diagnostic-error'

const SENSITIVE_KEYS =
  /authorization|cookie|credential|password|secret|token|api[-_]?key|ciphertext/i

export function redactLogValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[TRUNCATED]'
  if (typeof value === 'string') return redactAgentDiagnosticText(value)
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value))
    return value.slice(0, 100).map((item) => redactLogValue(item, depth + 1))

  const redacted: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value).slice(0, 100)) {
    redacted[key] = SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redactLogValue(child, depth + 1)
  }
  return redacted
}
