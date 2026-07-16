import {
  providerProbeRequestSchema,
  type ProviderProbeResponse
} from '../shared/contracts/provider-probe'
import { runProviderProbeRequest } from './provider-probe-request'

const parentPort = process.parentPort
if (parentPort === undefined) throw new Error('Provider probe requires an Electron parent port')

let handled = false
parentPort.on('message', (event) => {
  if (handled) return
  handled = true
  void (async () => {
    let response: ProviderProbeResponse
    try {
      const request = providerProbeRequestSchema.parse(event.data)
      response = await runProviderProbeRequest(request)
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error('Provider probe input failed', { cause: err })
      const requestId = extractRequestId(event.data)
      response = {
        type: 'error',
        requestId,
        error: {
          name: error.name.slice(0, 200),
          message: error.message.slice(0, 4_096),
          ...(error.stack === undefined ? {} : { stack: error.stack.slice(0, 32_768) })
        }
      }
    }
    parentPort.postMessage(response)
    setImmediate(() => process.exit(0))
  })()
})

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
