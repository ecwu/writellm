import { describe, expect, it } from 'vitest'
import {
  AGENT_EVENT_SCHEMA_VERSION,
  AGENT_RUNTIME_VERSION,
  agentCompactionSummaryPayloadSchema,
  agentHistorySchema,
  agentQueueCommandSchema,
  agentRunStartSchema,
  agentRuntimeEventSchema,
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
    expect(AGENT_EVENT_SCHEMA_VERSION).toBe(3)
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
        pendingMessageId: '019c6a5c-8d34-7a8e-a602-3d37a52dc419',
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

  it('reads legacy preflight failures and bounds new safe diagnostics', () => {
    const legacy = {
      type: 'tool_preflight_failed' as const,
      modelRequestId: ids.modelRequestId,
      toolCallId: 'tool-legacy',
      requestedToolName: 'submit_section_change',
      phase: 'pre_dispatch' as const,
      timestamp: 1
    }
    expect(agentRuntimeEventSchema.parse(legacy)).toEqual(legacy)
    expect(
      agentRuntimeEventSchema.parse({
        ...legacy,
        diagnostic: {
          code: 'invalid_arguments',
          message: 'Expected operations; received a missing field. Fix it and retry once.',
          paths: ['/operations']
        },
        durationMs: 4
      })
    ).toMatchObject({
      diagnostic: { code: 'invalid_arguments', paths: ['/operations'] },
      durationMs: 4
    })
  })

  it('reads legacy/v2 checkpoints and validates bounded-handoff v3 budgets', () => {
    expect(
      agentCompactionSummaryPayloadSchema.parse({
        summary: 'Legacy summary',
        coveredThroughSequence: 10,
        estimatedInputTokens: 1_000,
        timestamp: 1
      })
    ).toMatchObject({ summary: 'Legacy summary', coveredThroughSequence: 10 })
    const checkpoint = {
      schemaVersion: 2 as const,
      compactionId: ids.requestId,
      trigger: 'auto_threshold' as const,
      stepIndex: 1,
      finalStep: true,
      previousCheckpointEventId: null,
      coveredFromSequence: 11,
      coveredThroughSequence: 20,
      summary: 'Objective\nContinue safely.',
      proposalOutcomes: [],
      approvalDecisions: [],
      citationIds: [],
      toolOutcomes: [],
      estimatedTokensBefore: 2_000,
      estimatedTokensAfter: 500,
      checkpointTokens: 300,
      tailTokens: 200,
      timestamp: 2
    }
    expect(agentCompactionSummaryPayloadSchema.parse(checkpoint)).toEqual(checkpoint)
    expect(() =>
      agentCompactionSummaryPayloadSchema.parse({
        ...checkpoint,
        coveredFromSequence: 21,
        coveredThroughSequence: 20
      })
    ).toThrow('coverage is invalid')
    const v3 = {
      ...checkpoint,
      schemaVersion: 3 as const,
      handoffMode: 'bounded_conversation_memory' as const,
      postCompactionBudgetTokens: 32_000,
      checkpointBudgetTokens: 12_000,
      recentTailBudgetTokens: 20_000
    }
    expect(agentCompactionSummaryPayloadSchema.parse(v3)).toEqual(v3)
    expect(() =>
      agentCompactionSummaryPayloadSchema.parse({ ...v3, recentTailBudgetTokens: 19_999 })
    ).toThrow('budgets are inconsistent')
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
    expect(
      agentRuntimeMessageSchema.safeParse({
        type: 'error',
        requestId: ids.requestId,
        projectSessionId: ids.projectSessionId,
        agentSessionId: ids.agentSessionId,
        agentRunId: ids.agentRunId,
        error: {
          name: 'AgentToolBatchContextExhaustedError',
          message: 'The latest Agent read batch still exceeds context',
          code: 'tool_batch_context_exhausted'
        }
      }).success
    ).toBe(true)
  })
})
