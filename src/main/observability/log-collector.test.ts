import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createLoggerSystem } from './logger'
import { LogCollector } from './log-collector'

describe('LogCollector', () => {
  it('validates, correlates, and redacts utility events', async () => {
    const destination = new PassThrough()
    const output: string[] = []
    destination.on('data', (chunk) => output.push(chunk.toString()))
    const system = await createLoggerSystem({
      appVersion: 'test',
      logDirectory: '/tmp/writellm-collector-test',
      development: true,
      destination
    })
    const collector = new LogCollector((envelope) =>
      system.createModuleLogger(envelope.subsystem, envelope.component, envelope.processRole)
    )
    collector.ingest({
      level: 'error',
      sourceTime: new Date().toISOString(),
      processRole: 'api-worker',
      subsystem: 'worker',
      component: 'fixture',
      event: 'worker.fixture.failed',
      message: 'Fixture failed',
      context: { operationId: 'op-worker' },
      fields: { token: 'sensitive' },
      error: { type: 'Error', message: 'original', stack: 'stack' },
      processSequence: 1
    })
    await system.flush()

    const parsed = JSON.parse(output.join('').trim()) as Record<string, unknown>
    expect(parsed.operationId).toBe('op-worker')
    expect(parsed.token).toBe('[REDACTED]')
    expect(parsed.err).toMatchObject({ type: 'Error', message: 'original', stack: 'stack' })
  })

  it('rejects oversized or invalid envelopes', async () => {
    const system = await createLoggerSystem({
      appVersion: 'test',
      logDirectory: '/tmp/writellm-collector-invalid-test',
      development: true,
      destination: new PassThrough()
    })
    const collector = new LogCollector(() => system.root)
    expect(() => collector.ingest({ event: 'invalid' })).toThrow()
  })
})
