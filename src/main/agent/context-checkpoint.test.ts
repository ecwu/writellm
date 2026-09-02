import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { AGENT_RUN_PROMPT_MAX_CHARACTERS } from '../../shared/contracts/agent'
import { agentCompactionCheckpointV4PayloadSchema } from '../../shared/contracts/agent-compaction'
import { estimateAgentTokens } from '../../shared/agent-context-budget'
import { initializeProjectDatabase, type ProjectDatabase } from '../project/project-database'
import {
  buildNextCompactionMaterial,
  latestSuccessfulCheckpoint,
  loadContinuousRuntimeHistory
} from './context-checkpoint'
import { formatHistoryCompactionInput } from './prompts/task-prompts'

const temporaryDirectories: string[] = []
const now = '2026-08-12T00:00:00.000Z'

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('Agent context checkpoints', () => {
  it('projects generic safe facts without source bodies, credentials, or private paths', async () => {
    const database = await createDatabase()
    insertSession(database)
    insertEvent(database, 1, 'user_message', {
      content: 'Draft the evidence comparison.',
      delivery: 'prompt',
      timestamp: 1
    })
    insertEvent(database, 2, 'tool_call', {
      toolCallId: 'tool-1',
      toolName: 'search_knowledge',
      contractVersion: 1,
      args: {
        query: 'private query must not be retained',
        knowledgeItemIds: ['019c6a5c-8d34-7a8e-a602-3d37a52dc421'],
        credential: 'agent-secret',
        title: '/workspace/private/research.txt'
      },
      timestamp: 2
    })
    insertEvent(database, 3, 'tool_result', {
      toolCallId: 'tool-1',
      toolName: 'search_knowledge',
      contractVersion: 1,
      isError: false,
      result: {
        mode: 'hybrid',
        hits: [
          {
            citationId: 'citation-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            knowledgeItemId: '019c6a5c-8d34-7a8e-a602-3d37a52dc421',
            title: 'Evidence title'
          }
        ],
        body: `source body must not enter checkpoint ${'private source'.repeat(10_000)}`,
        credential: 'agent-secret'
      },
      error: null,
      citationIds: ['citation-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
      knowledgeItemIds: [],
      parseRevisionIds: [],
      timestamp: 3
    })
    insertEvent(database, 4, 'assistant_message', assistantPayload('Completed the comparison.', 4))
    insertEvent(database, 5, 'run_completed', { outcome: 'finished' })
    insertEvent(database, 6, 'user_message', {
      content: 'Keep the latest conclusion.',
      delivery: 'prompt',
      timestamp: 6
    })
    insertEvent(database, 7, 'run_completed', { outcome: 'finished' })

    const material = buildNextCompactionMaterial({ database, agentSessionId: 'session-1' })
    expect(material).toMatchObject({
      coveredFromSequence: 1,
      coveredThroughSequence: 7,
      omittedEventCount: 0
    })
    const source = material?.sourcePayloadJson ?? ''
    expect(source).toContain('Evidence title')
    expect(source).toContain('Keep the latest conclusion.')
    expect(source).not.toContain('"retainedTail"')
    expect(source).not.toContain('private query must not be retained')
    expect(source).not.toContain('agent-secret')
    expect(source).not.toContain('/workspace/private')
    expect(source).not.toContain('source body must not enter checkpoint')
    expect(material?.projectedPromptCharacters).toBeLessThanOrEqual(AGENT_RUN_PROMPT_MAX_CHARACTERS)
    const prompt = formatHistoryCompactionInput(`${source}<untrusted>`)
    expect(prompt).toContain('&lt;')
    database.close()
  })

  it('reads legacy checkpoints and the v4 checkpoint as background memory', async () => {
    const database = await createDatabase()
    insertSession(database)
    insertEvent(database, 1, 'user_message', {
      content: 'old request',
      delivery: 'prompt',
      timestamp: 1
    })
    insertEvent(database, 2, 'run_completed', { outcome: 'finished' })
    insertEvent(database, 3, 'compaction_summary', {
      schemaVersion: 4,
      compactionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc423',
      trigger: 'manual',
      previousCheckpointEventId: null,
      coveredFromSequence: 1,
      coveredThroughSequence: 2,
      summary: 'Keep the verified thesis.',
      omittedEventCount: 12,
      estimatedTokensBefore: 20,
      estimatedTokensAfter: 10,
      timestamp: 3
    })
    insertEvent(database, 4, 'user_message', {
      content: 'Only revise the final sentence now.',
      delivery: 'prompt',
      timestamp: 4
    })

    expect(latestSuccessfulCheckpoint(database, 'session-1')).toMatchObject({
      schemaVersion: 4,
      coveredThroughSequence: 2,
      omittedEventCount: 12
    })
    const history = loadContinuousRuntimeHistory(database, 'session-1')
    expect(history[0]).toMatchObject({
      role: 'user',
      content: expect.stringContaining('authority="conversation_memory"')
    })
    expect(history[0]).toMatchObject({
      content: expect.stringContaining('omits 12 older event(s)')
    })
    expect(history.at(-1)).toMatchObject({
      role: 'user',
      content: 'Only revise the final sentence now.'
    })
    expect(
      agentCompactionCheckpointV4PayloadSchema.safeParse({
        schemaVersion: 4,
        compactionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc423',
        trigger: 'manual',
        previousCheckpointEventId: null,
        coveredFromSequence: 1,
        coveredThroughSequence: 2,
        summary: 'Keep the verified thesis.',
        omittedEventCount: 12,
        estimatedTokensBefore: 20,
        estimatedTokensAfter: 10,
        timestamp: 3
      }).success
    ).toBe(true)
    database.close()
  })

  it('continues reading v1, v2, and v3 checkpoint payloads', async () => {
    const legacyPayloads: Array<{ version: number; payload: Record<string, unknown> }> = [
      {
        version: 1,
        payload: {
          summary: 'Legacy v1 summary',
          coveredThroughSequence: 1,
          estimatedInputTokens: 12,
          timestamp: 1
        }
      },
      {
        version: 2,
        payload: {
          schemaVersion: 2,
          compactionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc422',
          trigger: 'manual',
          stepIndex: 1,
          finalStep: true,
          previousCheckpointEventId: null,
          coveredFromSequence: 1,
          coveredThroughSequence: 1,
          summary: 'Legacy v2 summary',
          proposalOutcomes: [],
          approvalDecisions: [],
          citationIds: [],
          toolOutcomes: [],
          estimatedTokensBefore: 20,
          estimatedTokensAfter: 10,
          checkpointTokens: 10,
          tailTokens: 0,
          timestamp: 1
        }
      },
      {
        version: 3,
        payload: {
          schemaVersion: 3,
          handoffMode: 'bounded_conversation_memory',
          compactionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc423',
          trigger: 'manual',
          stepIndex: 1,
          finalStep: true,
          previousCheckpointEventId: null,
          coveredFromSequence: 1,
          coveredThroughSequence: 1,
          summary: 'Legacy v3 summary',
          proposalOutcomes: [],
          approvalDecisions: [],
          citationIds: [],
          toolOutcomes: [],
          estimatedTokensBefore: 20,
          estimatedTokensAfter: 10,
          checkpointTokens: 10,
          tailTokens: 0,
          postCompactionBudgetTokens: 20,
          checkpointBudgetTokens: 10,
          recentTailBudgetTokens: 10,
          timestamp: 1
        }
      }
    ]
    for (const { version, payload } of legacyPayloads) {
      const database = await createDatabase()
      insertSession(database)
      insertEvent(database, 1, 'compaction_summary', payload)
      expect(latestSuccessfulCheckpoint(database, 'session-1')).toMatchObject({
        schemaVersion: version,
        summary: `Legacy v${version} summary`,
        coveredThroughSequence: 1
      })
      database.close()
    }
  })

  it('preserves clarification questions and user decisions as ordinary recent facts', async () => {
    const database = await createDatabase()
    insertSession(database)
    insertEvent(database, 1, 'user_message', {
      content: 'Revise the ending.',
      delivery: 'prompt',
      timestamp: 1
    })
    insertEvent(database, 2, 'tool_call', {
      toolCallId: 'tool-question',
      toolName: 'ask_user',
      contractVersion: 10,
      args: {
        questions: [
          {
            id: 'scope',
            header: 'Scope',
            question: 'Which scope should the revision use?',
            options: [{ label: 'Conclusion (Recommended)', description: 'Revise only the ending.' }]
          }
        ]
      },
      timestamp: 2
    })
    insertEvent(database, 3, 'user_message', {
      content: 'Only the final two paragraphs.',
      delivery: 'clarification',
      timestamp: 3
    })
    insertEvent(database, 4, 'tool_result', {
      toolCallId: 'tool-question',
      toolName: 'ask_user',
      contractVersion: 10,
      isError: false,
      result: {
        answers: [{ questionId: 'scope', kind: 'custom', value: 'Only the final two paragraphs' }]
      },
      error: null,
      citationIds: [],
      knowledgeItemIds: [],
      parseRevisionIds: [],
      timestamp: 4
    })
    insertEvent(database, 5, 'assistant_message', assistantPayload('Revised the ending.', 5))
    insertEvent(database, 6, 'run_completed', { outcome: 'finished' })

    const source =
      buildNextCompactionMaterial({ database, agentSessionId: 'session-1' })?.sourcePayloadJson ??
      ''
    expect(source).toContain('Which scope should the revision use?')
    expect(source).toContain('Only the final two paragraphs')
    expect(source).toContain('"toolName":"ask_user"')
    database.close()
  })

  it('reads beyond the historical 2,000-event ceiling in one compaction source', async () => {
    const database = await createDatabase()
    insertSession(database)
    database.immediate((native) => {
      const insert = native.prepare(
        `INSERT INTO agent_events (
           agent_event_id, agent_session_id, sequence, type, payload_json, created_at
         ) VALUES (?, 'session-1', ?, ?, ?, ?)`
      )
      native.transaction(() => {
        for (let sequence = 1; sequence <= 2_501; sequence += 1) {
          const userTurn = sequence % 2 === 1
          insert.run(
            `event-${sequence}`,
            sequence,
            userTurn ? 'user_message' : 'run_completed',
            JSON.stringify(
              userTurn
                ? { content: `turn-${sequence}`, delivery: 'prompt', timestamp: sequence }
                : { outcome: 'finished' }
            ),
            now
          )
        }
      })()
    })

    const material = buildNextCompactionMaterial({ database, agentSessionId: 'session-1' })
    expect(material?.sourceEventCount).toBe(2_501)
    expect(material?.coveredThroughSequence).toBe(2_501)
    database.close()
  })

  it('uses an explicit omission count instead of rejecting a huge old prefix', async () => {
    const database = await createDatabase()
    insertSession(database)
    let sequence = 1
    for (let index = 0; index < 30; index += 1) {
      insertEvent(database, sequence, 'user_message', {
        content: `Old requirement ${index} ${'写'.repeat(10_000)}`,
        delivery: 'prompt',
        timestamp: sequence
      })
      sequence += 1
      insertEvent(database, sequence, 'run_completed', { outcome: 'finished' })
      sequence += 1
    }
    insertEvent(database, sequence, 'user_message', {
      content: 'Retain this newest request.',
      delivery: 'prompt',
      timestamp: sequence
    })

    const material = buildNextCompactionMaterial({ database, agentSessionId: 'session-1' })
    expect(material).not.toBeNull()
    expect(material?.omittedEventCount).toBeGreaterThan(0)
    expect(material?.sourcePayloadJson).toContain('"omittedEventCount":')
    expect(material?.sourcePayloadJson).toContain('Retain this newest request.')
    expect(material?.projectedPromptCharacters).toBeLessThanOrEqual(AGENT_RUN_PROMPT_MAX_CHARACTERS)
    database.close()
  })

  it('does not throw merely because the requested summary budget is small', async () => {
    const database = await createDatabase()
    insertSession(database)
    insertEvent(database, 1, 'user_message', {
      content: 'A prior request.',
      delivery: 'prompt',
      timestamp: 1
    })
    insertEvent(database, 2, 'run_completed', { outcome: 'finished' })

    expect(() =>
      buildNextCompactionMaterial({
        database,
        agentSessionId: 'session-1',
        sourceTokenBudget: 100
      })
    ).not.toThrow()
    database.close()
  })

  it('keeps a contiguous recent tail and never summarizes an active trailing request', async () => {
    const database = await createDatabase()
    insertSession(database)
    insertEvent(database, 1, 'user_message', {
      content: 'An older completed request.',
      delivery: 'prompt',
      timestamp: 1
    })
    insertEvent(database, 2, 'assistant_message', assistantPayload('Older answer.', 2))
    insertEvent(database, 3, 'run_completed', { outcome: 'finished' })
    insertEvent(database, 4, 'user_message', {
      content: `A large completed request ${'历史'.repeat(20_000)}`,
      delivery: 'prompt',
      timestamp: 4
    })
    insertEvent(database, 5, 'assistant_message', assistantPayload('Large answer.', 5))
    insertEvent(database, 6, 'run_completed', { outcome: 'finished' })
    insertEvent(database, 7, 'user_message', {
      content: 'The active request must remain raw.',
      delivery: 'prompt',
      timestamp: 7
    })

    const tailBudget = estimateAgentTokens([
      { role: 'user' as const, content: 'The active request must remain raw.', timestamp: 7 }
    ])
    const material = buildNextCompactionMaterial({
      database,
      agentSessionId: 'session-1',
      recentTailTokenBudget: tailBudget
    })
    expect(material).not.toBeNull()
    expect(material?.coveredThroughSequence).toBe(6)
    expect(material?.retainedTail).toEqual([
      { role: 'user', content: 'The active request must remain raw.', timestamp: 7 }
    ])
    expect(material?.sourcePayloadJson).toContain('A large completed request')
    database.close()
  })

  it('re-summarizes an existing checkpoint when no newer event is available', async () => {
    const database = await createDatabase()
    insertSession(database)
    insertEvent(database, 1, 'compaction_summary', {
      schemaVersion: 4,
      compactionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc421',
      trigger: 'manual',
      previousCheckpointEventId: null,
      coveredFromSequence: 1,
      coveredThroughSequence: 1,
      summary: 'An earlier checkpoint that needs a fresh concise summary.',
      omittedEventCount: 0,
      estimatedTokensBefore: 32,
      estimatedTokensAfter: 12,
      timestamp: 1
    })

    const material = buildNextCompactionMaterial({ database, agentSessionId: 'session-1' })
    expect(material).toMatchObject({
      sourceEventCount: 0,
      coveredFromSequence: 1,
      coveredThroughSequence: 1
    })
    expect(material?.sourcePayloadJson).toContain('An earlier checkpoint')
    database.close()
  })

  it('does not return an oversized checkpoint-only source for a small model budget', async () => {
    const database = await createDatabase()
    insertSession(database)
    insertEvent(database, 1, 'compaction_summary', {
      schemaVersion: 4,
      compactionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc424',
      trigger: 'manual',
      previousCheckpointEventId: null,
      coveredFromSequence: 1,
      coveredThroughSequence: 1,
      summary: 'Long prior summary '.repeat(10_000),
      omittedEventCount: 0,
      estimatedTokensBefore: 40_000,
      estimatedTokensAfter: 20_000,
      timestamp: 1
    })

    const material = buildNextCompactionMaterial({
      database,
      agentSessionId: 'session-1',
      sourceTokenBudget: 1_000
    })
    expect(material === null || material.estimatedPromptTokens <= 1_000).toBe(true)
    database.close()
  })

  it('keeps raw event rows unchanged while projecting a large failed run', async () => {
    const database = await createDatabase()
    insertSession(database)
    insertEvent(database, 1, 'user_message', {
      content: 'Preserve this clarification requirement exactly.',
      delivery: 'clarification',
      timestamp: 1
    })
    insertEvent(database, 2, 'tool_call', {
      toolCallId: 'tool-1',
      toolName: 'search_knowledge',
      contractVersion: 1,
      args: { query: 'private query' },
      timestamp: 2
    })
    insertEvent(database, 3, 'tool_result', {
      toolCallId: 'tool-1',
      toolName: 'search_knowledge',
      contractVersion: 1,
      isError: false,
      result: { body: `private source ${'x'.repeat(16_000)}` },
      error: null,
      citationIds: [],
      knowledgeItemIds: [],
      parseRevisionIds: [],
      timestamp: 3
    })
    insertEvent(database, 4, 'run_interrupted', { code: 'run_failed' })
    const before = database.immediate((native) =>
      native.prepare('SELECT type, payload_json FROM agent_events ORDER BY sequence').all()
    )

    const material = buildNextCompactionMaterial({ database, agentSessionId: 'session-1' })
    expect(material?.sourcePayloadJson).toContain(
      'Preserve this clarification requirement exactly.'
    )
    expect(material?.sourcePayloadJson).not.toContain('private query')
    expect(material?.sourcePayloadJson).not.toContain('private source')
    expect(
      database.immediate((native) =>
        native.prepare('SELECT type, payload_json FROM agent_events ORDER BY sequence').all()
      )
    ).toEqual(before)
    database.close()
  })
})

async function createDatabase(): Promise<ProjectDatabase> {
  const parent = await mkdtemp(join(tmpdir(), 'writellm-context-checkpoint-'))
  temporaryDirectories.push(parent)
  const root = join(parent, 'Context.writellm')
  await mkdir(root)
  return initializeProjectDatabase({
    projectRoot: root,
    manifest: {
      format: 'writellm-project',
      formatVersion: 1,
      projectId: '019c6a5c-8d34-7a8e-a602-3d37a52dc421',
      createdAt: now
    },
    applicationVersion: '1.0.0-test',
    log: pino({ level: 'silent' })
  })
}

function insertSession(database: ProjectDatabase): void {
  database.immediate((native) => {
    native
      .prepare(
        `INSERT INTO agent_sessions (
           agent_session_id, title, pi_runtime_version, event_schema_version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run('session-1', 'Checkpoint test', '4', 3, now, now)
  })
}

function insertEvent(
  database: ProjectDatabase,
  sequence: number,
  type: string,
  payload: Record<string, unknown>
): void {
  database.immediate((native) => {
    native
      .prepare(
        `INSERT INTO agent_events (
           agent_event_id, agent_session_id, sequence, type, payload_json, created_at
         ) VALUES (?, 'session-1', ?, ?, ?, ?)`
      )
      .run(`event-${sequence}`, sequence, type, JSON.stringify(payload), now)
  })
}

function assistantPayload(content: string, timestamp: number): Record<string, unknown> {
  return {
    content,
    stopReason: 'stop',
    provider: 'openai-compatible',
    model: 'writer',
    responseId: `response-${timestamp}`,
    metadata: {
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        estimatedCostUsdMicros: null
      },
      responseIds: [`response-${timestamp}`],
      retryCount: 0,
      providerModelId: 'writer'
    },
    timestamp,
    interrupted: false
  }
}
