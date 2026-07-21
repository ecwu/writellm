import { describe, expect, it } from 'vitest'
import { AgentEventBroker } from './event-broker'

const log = { info() {}, warn() {}, error() {} }
const projectSessionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc422'
const agentSessionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc423'
const agentRunId = '019c6a5c-8d34-7a8e-a602-3d37a52dc424'
const subscriptionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc425'

describe('AgentEventBroker', () => {
  it('queues live events behind replay and flushes them after replay completion', () => {
    const sent: unknown[] = []
    const broker = new AgentEventBroker(log)
    broker.subscribe({
      sender: { id: 7, isDestroyed: () => false, send: (_channel, value) => sent.push(value) },
      projectSessionId,
      agentSessionId,
      subscriptionId
    })
    broker.publishDelta(projectSessionId, { agentSessionId, agentRunId, delta: 'live' })
    expect(sent).toEqual([])
    broker.completeReplay(7, subscriptionId)
    expect(sent).toEqual([expect.objectContaining({ kind: 'delta', delta: 'live' })])
  })

  it('renderer closure drops only the lease and never throws into run truth', () => {
    const broker = new AgentEventBroker(log)
    broker.subscribe({
      sender: {
        id: 8,
        isDestroyed: () => true,
        send: () => {
          throw new Error('closed')
        }
      },
      projectSessionId,
      agentSessionId,
      subscriptionId
    })
    broker.completeReplay(8, subscriptionId)
    expect(() =>
      broker.publishDelta(projectSessionId, { agentSessionId, agentRunId, delta: 'ignored' })
    ).not.toThrow()
  })
})
