export const INVALID_UTILITY_REQUEST_ID = '00000000-0000-4000-8000-000000000000'

export function extractUtilityRequestId(value: unknown): string {
  if (
    value !== null &&
    typeof value === 'object' &&
    'requestId' in value &&
    typeof value.requestId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(value.requestId)
  ) {
    return value.requestId
  }
  return INVALID_UTILITY_REQUEST_ID
}

export function extractUtilityProjectSessionId(value: unknown): string | null {
  if (
    value !== null &&
    typeof value === 'object' &&
    'projectSessionId' in value &&
    (typeof value.projectSessionId === 'string' || value.projectSessionId === null)
  ) {
    return value.projectSessionId
  }
  return null
}

export function safeUtilityStack(stack: string | undefined, message: string): string | undefined {
  if (stack === undefined) return undefined
  const frames = stack.split('\n').slice(1).join('\n')
  return `${message}${frames.length === 0 ? '' : `\n${frames}`}`.slice(0, 32_768)
}

export function findUtilityHttpStatus(error: unknown, depth = 0): number | undefined {
  if (depth > 5 || error === null || typeof error !== 'object') return undefined
  const candidate = error as { status?: unknown; statusCode?: unknown; cause?: unknown }
  const status = candidate.statusCode ?? candidate.status
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : findUtilityHttpStatus(candidate.cause, depth + 1)
}
