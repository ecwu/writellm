import { describe, expect, it } from 'vitest'
import { type AgentWorkflowSignals, deriveAgentWorkflowState } from './agent-workflow-state'

const none: AgentWorkflowSignals = {
  awaitingInput: false,
  compacting: false,
  running: false,
  generating: false,
  awaitingReview: false
}

describe('deriveAgentWorkflowState', () => {
  it('is idle without signals', () => {
    expect(deriveAgentWorkflowState(none)).toBe('idle')
  })

  it.each([
    [{ awaitingReview: true }, 'awaiting_review'],
    [{ generating: true, awaitingReview: true }, 'generating'],
    [{ running: true, generating: true, awaitingReview: true }, 'running'],
    // A run compacting its history must report compacting, because queued messages are refused.
    [{ compacting: true, running: true }, 'compacting'],
    [{ awaitingInput: true, compacting: true, running: true }, 'awaiting_input']
  ] as const)('gives %o precedence as %s', (signals, expected) => {
    expect(deriveAgentWorkflowState({ ...none, ...signals })).toBe(expected)
  })
})
