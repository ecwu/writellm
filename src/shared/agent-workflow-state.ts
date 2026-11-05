import type { AgentSessionWorkflowState } from './contracts/agent-ipc'

export interface AgentWorkflowSignals {
  /** A live run is blocked on an ask-user question. */
  awaitingInput: boolean
  /** A standalone compaction, or a live run in its compacting phase, is summarizing history. */
  compacting: boolean
  /** An Agent run is still running. */
  running: boolean
  /** An image proposal is generating. */
  generating: boolean
  /** A proposal is waiting for review. */
  awaitingReview: boolean
}

/**
 * Derive a session's workflow state from its run, compaction, and proposal signals.
 *
 * The state is never stored; Main and the Renderer both derive it here so they agree. Earlier
 * entries win: input and compaction block queued messages even while a run is still running.
 */
export function deriveAgentWorkflowState(signals: AgentWorkflowSignals): AgentSessionWorkflowState {
  if (signals.awaitingInput) return 'awaiting_input'
  if (signals.compacting) return 'compacting'
  if (signals.running) return 'running'
  if (signals.generating) return 'generating'
  if (signals.awaitingReview) return 'awaiting_review'
  return 'idle'
}
