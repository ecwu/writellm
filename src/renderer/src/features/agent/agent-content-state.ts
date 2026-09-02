import type { AgentEventRecord, AgentRendererEvent } from '../../../../shared/contracts/agent-ipc'
import { mergeAgentEvents } from './agent-view-model'

export interface AgentContentState {
  events: AgentEventRecord[]
  streamingBySession: Record<string, Record<string, string>>
  settledSequences: ReadonlyMap<string, number>
  terminalRuns: ReadonlySet<string>
}

export function emptyAgentContent(): AgentContentState {
  return {
    events: [],
    streamingBySession: {},
    settledSequences: new Map(),
    terminalRuns: new Set()
  }
}

/** Settle the live tail and publish its durable replacement in one Renderer state update. */
export function applyAgentLiveContent(
  state: AgentContentState,
  event: AgentRendererEvent,
  activeSessionId: string | null
): AgentContentState {
  if (event.kind === 'delta') {
    if (state.terminalRuns.has(event.agentRunId)) return state
    const partials = state.streamingBySession[event.agentSessionId] ?? {}
    return {
      ...state,
      streamingBySession: {
        ...state.streamingBySession,
        [event.agentSessionId]: {
          ...partials,
          [event.agentRunId]: `${partials[event.agentRunId] ?? ''}${event.delta}`.slice(
            0,
            2_097_152
          )
        }
      }
    }
  }
  if (event.kind !== 'durable') return state
  const record = event.event
  const events =
    record.agentSessionId === activeSessionId
      ? mergeAgentEvents(state.events, record)
      : state.events
  const runId = record.agentRunId
  if (
    runId === null ||
    !['assistant_message', 'run_completed', 'run_interrupted'].includes(record.type) ||
    record.sequence <= (state.settledSequences.get(runId) ?? -1)
  )
    return { ...state, events }
  const partials = { ...state.streamingBySession[record.agentSessionId] }
  delete partials[runId]
  return {
    ...state,
    events,
    streamingBySession: { ...state.streamingBySession, [record.agentSessionId]: partials },
    settledSequences: new Map(state.settledSequences).set(runId, record.sequence),
    terminalRuns:
      record.type === 'assistant_message'
        ? state.terminalRuns
        : new Set(state.terminalRuns).add(runId)
  }
}
