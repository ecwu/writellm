import { mineruUtilityRequestSchema, type MineruUtilityResponse } from '../shared/contracts/mineru'
import { MineruRequestError, runMineruRequest } from './mineru-request'

const parentPort = process.parentPort
if (parentPort === undefined) throw new Error('MinerU utility requires an Electron parent port')

let handled = false
parentPort.on('message', (event) => {
  if (handled) return
  handled = true
  void (async () => {
    let response: MineruUtilityResponse
    try {
      const request = mineruUtilityRequestSchema.parse(event.data)
      response = await runMineruRequest(request)
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error('MinerU utility request failed', { cause: err })
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
  providerCode?: string
  retryable: boolean
} {
  const known = error instanceof MineruRequestError ? error : undefined
  const message = known === undefined ? 'MinerU utility request failed' : `MinerU ${known.code}`
  const stack = safeStack(error.stack, message)
  return {
    name: error.name.slice(0, 200),
    message,
    ...(stack === undefined ? {} : { stack }),
    ...(known?.httpStatus === undefined ? {} : { httpStatus: known.httpStatus }),
    ...(known?.providerCode === undefined ? {} : { providerCode: known.providerCode }),
    retryable: known?.retryable ?? false
  }
}

function safeStack(stack: string | undefined, message: string): string | undefined {
  if (stack === undefined) return undefined
  const frames = stack.split('\n').slice(1).join('\n')
  return `${message}${frames.length === 0 ? '' : `\n${frames}`}`.slice(0, 32_768)
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
