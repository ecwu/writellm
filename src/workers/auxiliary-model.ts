import {
  auxiliaryUtilityRequestSchema,
  type AuxiliaryUtilityResponse
} from '../shared/contracts/model-runtime'
import { runAuxiliaryModelRequest } from './auxiliary-model-request'

const parentPort = process.parentPort
if (parentPort === undefined)
  throw new Error('Auxiliary model utility requires an Electron parent port')

let handled = false
parentPort.on('message', (event) => {
  if (handled) return
  handled = true
  void (async () => {
    let response: AuxiliaryUtilityResponse
    try {
      const request = auxiliaryUtilityRequestSchema.parse(event.data)
      response = await runAuxiliaryModelRequest(request)
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error('Auxiliary model utility failed', { cause: err })
      response = {
        type: 'error',
        requestId: extractRequestId(event.data),
        error: serializeError(error)
      }
    }
    parentPort.postMessage(response)
    setImmediate(() => process.exit(0))
  })()
})

function serializeError(error: Error): {
  name: string
  message: string
  stack?: string
  httpStatus?: number
} {
  const httpStatus = findHttpStatus(error)
  const message = safeDiagnosticMessage(error, httpStatus)
  const stack = safeStack(error.stack, message)
  return {
    name: error.name.slice(0, 200),
    message,
    ...(stack === undefined ? {} : { stack }),
    ...(httpStatus === undefined ? {} : { httpStatus })
  }
}

function safeDiagnosticMessage(error: Error, httpStatus?: number): string {
  if (error.name === 'AbortError') return 'Auxiliary model request aborted'
  return httpStatus === undefined
    ? 'Auxiliary model request failed'
    : `Auxiliary model request failed with HTTP ${httpStatus}`
}

function safeStack(stack: string | undefined, message: string): string | undefined {
  if (stack === undefined) return undefined
  const frames = stack.split('\n').slice(1).join('\n')
  return `${message}${frames.length === 0 ? '' : `\n${frames}`}`.slice(0, 32_768)
}

function findHttpStatus(error: unknown, depth = 0): number | undefined {
  if (depth > 5 || error === null || typeof error !== 'object') return undefined
  const candidate = error as { status?: unknown; statusCode?: unknown; cause?: unknown }
  const status = candidate.statusCode ?? candidate.status
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : findHttpStatus(candidate.cause, depth + 1)
}

function extractRequestId(value: unknown): string {
  if (
    value !== null &&
    typeof value === 'object' &&
    'requestId' in value &&
    typeof value.requestId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(value.requestId)
  ) {
    return value.requestId
  }
  return '00000000-0000-4000-8000-000000000000'
}
