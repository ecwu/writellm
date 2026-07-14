import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createLoggerSystem } from './logger'
import { withLogContext } from './log-context'

describe('logger system', () => {
  it('preserves errors and context while redacting sensitive fields', async () => {
    const destination = new PassThrough()
    const output: string[] = []
    destination.on('data', (chunk) => output.push(chunk.toString()))
    const system = await createLoggerSystem({
      appVersion: 'test',
      logDirectory: '/tmp/writellm-logger-test',
      development: true,
      sessionId: 'session-test',
      destination
    })
    const log = system.createModuleLogger('llm', 'test')
    const cause = new Error('root cause')
    const err = new Error('provider failed', { cause })

    withLogContext({ operationId: 'op-1', requestId: 'req-1' }, () => {
      log.error({ event: 'llm.request.failed', err, apiKey: 'secret-value' }, 'LLM request failed')
    })
    await system.flush()

    const parsed = JSON.parse(output.join('').trim()) as Record<string, unknown>
    expect(parsed.operationId).toBe('op-1')
    expect(parsed.requestId).toBe('req-1')
    expect(parsed.apiKey).toBe('[REDACTED]')
    expect(parsed.err).toMatchObject({ type: 'Error' })
    expect((parsed.err as { message: string }).message).toContain('provider failed')
    expect(JSON.stringify(parsed.err)).toContain('root cause')
    expect(system.ringBuffer.snapshot()).toHaveLength(1)
  })
})
