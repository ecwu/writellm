import { describe, expect, it } from 'vitest'
import {
  AGENT_EVENT_SCHEMA_VERSION,
  AGENT_RUNTIME_VERSION,
  agentHistorySchema,
  agentQueueCommandSchema,
  agentRunStartSchema,
  agentRuntimeMessageSchema,
  agentUserMessagePayloadSchema
} from './agent'

const config = {
  role: 'agent' as const,
  providerId: 'openai-compatible' as const,
  baseUrl: 'https://agent.example.test/v1',
  model: 'writer',
  modelRevision: 'writer-r1',
  timeoutMs: 30_000,
  embeddingDimension: null,
  batchLimit: 1,
  fileSizeLimitMb: null
}

const ids = {
  requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc401',
  projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc402',
  agentSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc403',
  agentRunId: '019c6a5c-8d34-7a8e-a602-3d37a52dc404',
  modelRequestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc405'
}

describe('Agent contracts', () => {
  it('pins the application-owned runtime and event schema versions', () => {
    expect(AGENT_RUNTIME_VERSION).toBe('0.80.10')
    expect(AGENT_EVENT_SCHEMA_VERSION).toBe(2)
  })

  it('validates a capability-bound session run and queue command', () => {
    expect(
      agentRunStartSchema.parse({
        operation: 'run_start',
        ...ids,
        config,
        credential: { apiKey: 'secret' },
        systemPrompt: 'system',
        history: [],
        prompt: 'draft',
        maxOutputTokens: 100
      })
    ).toMatchObject(ids)
    expect(
      agentQueueCommandSchema.parse({
        operation: 'follow_up',
        ...ids,
        content: 'continue',
        timestamp: 1,
        systemPrompt: 'refreshed system'
      })
    ).toMatchObject({ operation: 'follow_up', ...ids })
  })

  it('keeps historical user messages readable while bounding review presentation metadata', () => {
    const historical = { content: 'Draft this.', delivery: 'prompt', timestamp: 1 }
    expect(agentUserMessagePayloadSchema.parse(historical)).toEqual(historical)
    expect(
      agentUserMessagePayloadSchema.parse({
        ...historical,
        presentation: { kind: 'review_feedback', displayContent: 'Keep the opening.' }
      }).presentation
    ).toEqual({ kind: 'review_feedback', displayContent: 'Keep the opening.' })
    expect(() =>
      agentUserMessagePayloadSchema.parse({
        ...historical,
        presentation: { kind: 'review_feedback', displayContent: 'x'.repeat(4_097) }
      })
    ).toThrow()
  })

  it('rejects oversized history and stale response envelope shapes', () => {
    expect(() =>
      agentHistorySchema.parse(
        Array.from({ length: 201 }, (_, index) => ({
          role: 'user',
          content: `message-${index}`,
          timestamp: index
        }))
      )
    ).toThrow()
    expect(
      agentRuntimeMessageSchema.safeParse({
        type: 'result',
        requestId: ids.requestId,
        projectSessionId: ids.projectSessionId,
        agentSessionId: ids.agentSessionId,
        status: 'completed'
      }).success
    ).toBe(false)
  })
})
