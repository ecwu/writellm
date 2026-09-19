import { describe, expect, it, vi } from 'vitest'
import { KnowledgeChatEventBroker } from './knowledge-chat-event-broker'
const projectSessionId = '019d0000-0000-7000-8000-000000000420'
const first = '019d0000-0000-7000-8000-000000000421'
const second = '019d0000-0000-7000-8000-000000000422'
describe('Notebook event routing', () => {
  it('isolates subscriptions by instance and revokes the entire project', () => {
    const broker = new KnowledgeChatEventBroker({ info: vi.fn(), warn: vi.fn() })
    const a = { id: 1, isDestroyed: () => false, send: vi.fn() }
    const b = { id: 2, isDestroyed: () => false, send: vi.fn() }
    broker.subscribe(a, projectSessionId, first)
    broker.subscribe(a, projectSessionId, second)
    broker.subscribe(b, projectSessionId, second)
    const event = {
      kind: 'delta' as const,
      projectSessionId,
      notebookId: first,
      revision: 1,
      turnId: first,
      messageId: second,
      delta: 'fragment'
    }
    broker.publish(event)
    expect(a.send).toHaveBeenCalledTimes(1)
    expect(b.send).not.toHaveBeenCalled()
    broker.unsubscribe(a.id, projectSessionId, first)
    broker.publish(event)
    expect(a.send).toHaveBeenCalledTimes(1)
    broker.publish({ ...event, notebookId: second })
    expect(a.send).toHaveBeenCalledTimes(2)
    expect(b.send).toHaveBeenCalledTimes(1)
    broker.revokeSession(projectSessionId)
    broker.publish({ ...event, notebookId: second })
    expect(b.send).toHaveBeenCalledTimes(1)
  })
})
