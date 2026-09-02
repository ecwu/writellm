import { describe, expect, it } from 'vitest'
import type { AgentRendererEvent } from '../../../../shared/contracts/agent-ipc'
import { applyAgentLiveContent, emptyAgentContent } from './agent-content-state'

const session = 'session-a'
const run = 'run-a'
function delta(text: string, agentSessionId = session, agentRunId = run): AgentRendererEvent {
  return { kind: 'delta', projectSessionId: 'project', agentSessionId, agentRunId, delta: text }
}
function durable(
  sequence: number,
  type: 'assistant_message' | 'run_completed' | 'run_interrupted' = 'assistant_message',
  agentSessionId = session,
  agentRunId = run
): AgentRendererEvent {
  return {
    kind: 'durable',
    projectSessionId: 'project',
    event: {
      agentEventId: `event-${sequence}`,
      agentSessionId,
      agentRunId,
      modelRequestId: null,
      sequence,
      type,
      payload: { content: 'Committed answer' },
      createdAt: '2026-09-02T00:00:00.000Z'
    }
  }
}

describe('Agent live content settlement', () => {
  it('atomically replaces partial text with the durable message and ignores repeated settlement', () => {
    const streaming = applyAgentLiveContent(emptyAgentContent(), delta('Partial answer'), session)
    expect(streaming.events).toEqual([])
    expect(streaming.streamingBySession[session][run]).toBe('Partial answer')
    const settled = applyAgentLiveContent(streaming, durable(1), session)
    expect(settled.events).toHaveLength(1)
    expect(settled.streamingBySession[session][run]).toBeUndefined()
    const next = applyAgentLiveContent(settled, delta('Next update'), session)
    const repeated = applyAgentLiveContent(next, durable(1), session)
    expect(repeated.events).toHaveLength(1)
    expect(repeated.streamingBySession[session][run]).toBe('Next update')
  })

  it.each(['run_completed', 'run_interrupted'] as const)(
    'never resurrects a live tail after %s',
    (type) => {
      const state = applyAgentLiveContent(emptyAgentContent(), durable(2, type), session)
      const late = applyAgentLiveContent(state, delta('Late output'), session)
      expect(late).toBe(state)
      expect(late.streamingBySession[session]?.[run]).toBeUndefined()
    }
  )

  it('settles a background conversation without clearing the selected conversation', () => {
    let state = applyAgentLiveContent(emptyAgentContent(), delta('Selected partial'), session)
    state = applyAgentLiveContent(state, delta('Background partial', 'session-b', 'run-b'), session)
    state = applyAgentLiveContent(
      state,
      durable(1, 'assistant_message', 'session-b', 'run-b'),
      session
    )
    expect(state.events).toEqual([])
    expect(state.streamingBySession[session][run]).toBe('Selected partial')
    expect(state.streamingBySession['session-b']['run-b']).toBeUndefined()
  })

  it('allows a different run after interruption and scopes duplicate events to the selected history', () => {
    let state = applyAgentLiveContent(emptyAgentContent(), durable(1, 'run_interrupted'), session)
    state = applyAgentLiveContent(state, delta('Fresh run', session, 'run-new'), session)
    expect(state.streamingBySession[session]['run-new']).toBe('Fresh run')
    state = { ...state, events: [] }
    state = applyAgentLiveContent(state, durable(1, 'run_interrupted'), session)
    expect(state.events).toHaveLength(1)
    expect(state.streamingBySession[session]['run-new']).toBe('Fresh run')
  })
})
