import { describe, expect, it, vi } from 'vitest'
import { AutocompleteClient } from './autocomplete-client'
import { autocompleteWorkerRequestSchema } from '../../shared/contracts/autocomplete'
import type { PersistentUtilityProcess } from '../workers/persistent-utility-process'
const input = autocompleteWorkerRequestSchema.parse({
  operation: 'autocomplete',
  style: 'word',
  requestId: '00000000-0000-4000-8000-000000000001',
  projectSessionId: '00000000-0000-4000-8000-000000000002',
  context: { operationId: 'op' },
  modelId: 'deepseek-flash',
  credential: 'test-only',
  input: {
    requestId: '00000000-0000-4000-8000-000000000001',
    projectSessionId: '00000000-0000-4000-8000-000000000002',
    sectionId: '00000000-0000-4000-8000-000000000003',
    blockId: 'block',
    generation: 1,
    prefix: 'Draft',
    suffix: '',
    atBlockEnd: true
  }
})
const response = {
  type: 'autocomplete-result',
  requestId: input.requestId,
  projectSessionId: input.projectSessionId,
  text: ' continuation'
}
describe('Autocomplete Worker client', () => {
  it.each(['session', 'request', 'oversize', 'valid'])(
    'validates %s replies and sends scoped cancellation',
    async (variant) => {
      const request = vi.fn(
        async (_options: Parameters<PersistentUtilityProcess['request']>[0]) => response
      )
      const client = new AutocompleteClient({ request } as unknown as PersistentUtilityProcess)
      const signal = new AbortController().signal
      await client.complete(input, signal)
      const options = request.mock.calls[0]?.[0]
      if (!options) throw new Error('Worker request missing')
      expect(options).toMatchObject({
        signal,
        payload: input,
        cancelPayload: {
          type: 'cancel',
          requestId: input.requestId,
          projectSessionId: input.projectSessionId
        }
      })
      const candidate = {
        ...response,
        ...(variant === 'session'
          ? { projectSessionId: '00000000-0000-4000-8000-000000000004' }
          : {}),
        ...(variant === 'request' ? { requestId: '00000000-0000-4000-8000-000000000004' } : {}),
        ...(variant === 'oversize' ? { text: 'x'.repeat(4_097) } : {})
      }
      expect(await options.onMessage(candidate)).toMatchObject(
        variant === 'valid'
          ? { kind: 'resolve', value: response }
          : { kind: 'reject', terminate: true }
      )
    }
  )
})
