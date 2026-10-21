import type { AssistantMessage } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import { finalizeAgentSessionResult } from './agent-session-finalization'

const assistant = (
  stopReason: AssistantMessage['stopReason'],
  errorMessage?: string
): AssistantMessage => ({
  role: 'assistant',
  content: [],
  api: 'openai-completions',
  provider: 'test-provider',
  model: 'test-model',
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  },
  stopReason,
  ...(errorMessage === undefined ? {} : { errorMessage }),
  timestamp: 1
})

const input = (overrides: Partial<Parameters<typeof finalizeAgentSessionResult>[0]> = {}) => ({
  maxOutputTokens: 1_024,
  lastAssistantRetriesExhausted: false,
  awaitingReview: false,
  ...overrides
})

describe('finalizeAgentSessionResult', () => {
  it('projects the normal and review-paused outcomes', () => {
    expect(finalizeAgentSessionResult(input({ lastAssistant: assistant('stop') }))).toEqual({
      outcome: 'finished'
    })
    expect(
      finalizeAgentSessionResult(input({ lastAssistant: assistant('stop'), awaitingReview: true }))
    ).toEqual({ outcome: 'awaiting_review' })
  })

  it('preserves context overflow classification for provider failures', () => {
    let failure: unknown
    try {
      finalizeAgentSessionResult(
        input({
          lastAssistant: assistant('error', 'maximum context window exceeded')
        })
      )
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({ code: 'context_overflow' })
  })

  it('rethrows an existing run error before inspecting provider state', () => {
    const runError = new Error('run failed')
    expect(() =>
      finalizeAgentSessionResult(input({ runError, lastAssistant: assistant('stop') }))
    ).toThrow(runError)
  })
})
