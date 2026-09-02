import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPortLogger } from './port-logger'
import { serializeAgentDiagnosticError } from '../../shared/agent-diagnostic-error'

describe('createPortLogger', () => {
  afterEach(() => vi.useRealTimers())

  it('uses the safe request projection before transporting original error diagnostics', () => {
    const postMessage = vi.fn()
    const log = createPortLogger(
      { postMessage },
      {
        processRole: 'agent-worker',
        subsystem: 'agent',
        component: 'test'
      }
    )
    const body = 'PRIVATE MANUSCRIPT BODY'
    const error = new Error(`HTTP 400: ${body}`, { cause: new Error('api_key=private-key') })
    serializeAgentDiagnosticError(error, 'provider', { privateBodies: [body] })
    log('error', 'agent.worker.failed', 'Request failed', {}, error)
    const serialized = JSON.stringify(postMessage.mock.calls)
    expect(serialized).toContain('HTTP 400')
    expect(serialized).not.toContain(body)
    expect(serialized).not.toContain('private-key')
  })

  it('batches low-level events and sends errors immediately', () => {
    vi.useFakeTimers()
    const postMessage = vi.fn()
    const log = createPortLogger(
      { postMessage },
      {
        processRole: 'background-worker',
        subsystem: 'worker',
        component: 'test'
      }
    )

    log('info', 'worker.test.started', 'Started')
    expect(postMessage).not.toHaveBeenCalled()
    vi.advanceTimersByTime(75)
    expect(postMessage).toHaveBeenCalledWith([expect.objectContaining({ processSequence: 0 })])

    log('error', 'worker.test.failed', 'Failed')
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ processSequence: 1 }))
  })
})
