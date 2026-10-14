import type { Api, AssistantMessage } from '@earendil-works/pi-ai'
import { safeAgentDiagnosticMessage } from '../shared/agent-diagnostic-error'

export function providerErrorMessage(
  model: { api: Api; provider: string; id: string },
  error: unknown,
  aborted: boolean
): AssistantMessage {
  const message =
    error instanceof Error
      ? error.message
      : safeAgentDiagnosticMessage(error) || 'Unknown provider error'
  const assistantMessage: AssistantMessage = {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: aborted ? 'aborted' : 'error',
    errorMessage: message,
    timestamp: Date.now()
  }
  const details = providerErrorDetails(assistantMessage, error)
  Object.defineProperty(assistantMessage, 'cause', {
    configurable: true,
    value: error,
    writable: true
  })
  if (details.status !== undefined) {
    Object.defineProperty(assistantMessage, 'status', {
      configurable: true,
      value: details.status,
      writable: true
    })
  }
  if (details.code !== undefined) {
    Object.defineProperty(assistantMessage, 'code', {
      configurable: true,
      value: details.code,
      writable: true
    })
  }
  return assistantMessage
}

interface ProviderErrorDetails {
  cause?: unknown
  status?: number
  code?: string
}

export function providerErrorDetails(
  message: AssistantMessage,
  originalError?: unknown
): ProviderErrorDetails {
  const source = originalError === undefined ? message : originalError
  const status = readProviderStatus(source)
  const code = readProviderCode(source)
  return {
    ...(originalError === undefined
      ? { cause: readProperty(message, 'cause') }
      : { cause: originalError }),
    ...(status === undefined ? {} : { status }),
    ...(code === undefined ? {} : { code })
  }
}

function readProviderStatus(value: unknown): number | undefined {
  for (const key of ['httpStatus', 'statusCode', 'status'] as const) {
    const status = readProviderProperty(value, key)
    if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
      return status
    }
  }
  return undefined
}

function readProviderCode(value: unknown): string | undefined {
  for (const key of ['code', 'providerCode', 'errorCode'] as const) {
    const code = readProviderProperty(value, key)
    if (typeof code === 'string' && code.length > 0) return code
    if (typeof code === 'number' && Number.isFinite(code)) return String(code)
  }
  return undefined
}

function readProviderProperty(
  value: unknown,
  property: 'code' | 'providerCode' | 'errorCode' | 'httpStatus' | 'statusCode' | 'status'
): unknown {
  const seen = new Set<object>()
  let current = value
  while (current !== null && typeof current === 'object') {
    if (seen.has(current)) break
    seen.add(current)
    const candidate = (current as Record<string, unknown>)[property]
    if (candidate !== undefined) return candidate
    current = (current as Record<string, unknown>).cause
  }
  return undefined
}

function readProperty(value: unknown, property: string): unknown {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)[property]
    : undefined
}
