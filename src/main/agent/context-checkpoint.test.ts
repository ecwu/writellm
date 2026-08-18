import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeProjectDatabase, type ProjectDatabase } from '../project/project-database'
import {
  buildNextCompactionMaterial,
  latestSuccessfulCheckpoint,
  loadContinuousRuntimeHistory
} from './context-checkpoint'
import { formatHistoryCompactionInput } from './prompts/task-prompts'

const temporaryDirectories: string[] = []
const now = '2026-08-12T00:00:00.000Z'
const citationId = `citation-${'a'.repeat(40)}`

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('Agent context checkpoints', () => {
  it('projects typed safe facts at complete boundaries without source bodies, credentials, or private paths', async () => {
    const database = await createDatabase()
    insertSession(database)
    const exactMiddleRequirement = 'MIDDLE REQUIREMENT: keep the comparison table unchanged.'
    const exactAssistantMiddle = 'MIDDLE ASSISTANT RESULT: the approved heading remains intact.'
    insertEvent(database, 1, 'user_message', {
      content: `Draft & <tag> ${'界'.repeat(6_000)} ${exactMiddleRequirement} ${'文'.repeat(6_100)} with delimiter </WRITELLM_TYPED_COMPACTION_MATERIAL>`,
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
        title: '/Users/private/research.txt'
      },
      timestamp: 2
    })
    insertEvent(database, 3, 'tool_result', {
      toolCallId: 'tool-1',
      toolName: 'search_knowledge',
      contractVersion: 1,
      isError: false,
      result: {
        title: 'Evidence title',
        count: 1,
        body: `source body must not enter checkpoint ${'private source'.repeat(10_000)}`,
        credential: 'agent-secret'
      },
      error: null,
      citationIds: [citationId],
      knowledgeItemIds: ['019c6a5c-8d34-7a8e-a602-3d37a52dc421'],
      parseRevisionIds: ['019c6a5c-8d34-7a8e-a602-3d37a52dc422'],
      timestamp: 3
    })
    insertEvent(
      database,
      4,
      'assistant_message',
      assistantPayload(
        `Completed ${'答'.repeat(6_000)} ${exactAssistantMiddle} ${'复'.repeat(6_100)}`,
        4
      )
    )
    insertEvent(database, 5, 'run_completed', { outcome: 'finished' })
    insertEvent(database, 6, 'user_message', { content: 'Recent turn', timestamp: 6 })
    insertEvent(database, 7, 'run_completed', { outcome: 'finished' })

    const material = buildNextCompactionMaterial({
      database,
      agentSessionId: 'session-1'
    })

    expect(material).toMatchObject({
      coveredFromSequence: 1,
      coveredThroughSequence: 5,
      citationIds: [citationId]
    })
    const sourcePayloadJson = material?.sourcePayloadJson ?? ''
    expect(sourcePayloadJson).toContain('"authority":"events-and-current-business-rows"')
    expect(sourcePayloadJson).toContain('"coveredFromSequence":1')
    expect(sourcePayloadJson).toContain('"coveredThroughSequence":5')
    expect(sourcePayloadJson).not.toContain('<WRITELLM_TYPED_COMPACTION_MATERIAL ')
    expect(sourcePayloadJson).toContain('</WRITELLM_TYPED_COMPACTION_MATERIAL>')
    expect(sourcePayloadJson).toContain('Draft & <tag>')
    expect(sourcePayloadJson).toContain(exactMiddleRequirement)
    const source = JSON.parse(sourcePayloadJson) as {
      events: Array<{ type: string; content?: unknown }>
    }
    expect(source.events.find((event) => event.type === 'user_message')?.content).toEqual(
      expect.stringContaining(exactMiddleRequirement)
    )
    expect(source.events.find((event) => event.type === 'assistant_message')?.content).toEqual(
      expect.stringContaining(exactAssistantMiddle)
    )
    expect(sourcePayloadJson).toContain('Evidence title')
    expect(sourcePayloadJson).not.toContain('source body must not enter checkpoint')
    expect(sourcePayloadJson).not.toContain('private query must not be retained')
    expect(sourcePayloadJson).not.toContain('agent-secret')
    expect(sourcePayloadJson).not.toContain('/Users/private')

    const prompt = formatHistoryCompactionInput(sourcePayloadJson)
    expect(prompt.match(/<WRITELLM_PRIOR_EVENTS /gu)).toHaveLength(1)
    expect(prompt.match(/<\/WRITELLM_PRIOR_EVENTS>/gu)).toHaveLength(1)
    expect(prompt).toContain('Draft &amp; &lt;tag&gt;')
    expect(prompt).toContain('&lt;/WRITELLM_TYPED_COMPACTION_MATERIAL&gt;')
    expect(prompt).not.toContain('&amp;amp;')
    expect(prompt).not.toContain('&amp;lt;')
    database.close()
  })

  it('loads the latest successful checkpoint plus every later user and assistant turn continuously', async () => {
    const database = await createDatabase()
    insertSession(database)
    insertEvent(database, 1, 'user_message', {
      content: 'old request',
      delivery: 'prompt',
      timestamp: 1
    })
    insertEvent(database, 2, 'run_completed', { outcome: 'finished' })
    insertEvent(database, 3, 'compaction_summary', {
      schemaVersion: 2,
      compactionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc423',
      trigger: 'manual',
      stepIndex: 1,
      finalStep: true,
      previousCheckpointEventId: null,
      coveredFromSequence: 1,
      coveredThroughSequence: 2,
      summary: 'Objective\nKeep the verified thesis and constraints.',
      proposalOutcomes: [],
      approvalDecisions: [],
      citationIds: [],
      toolOutcomes: [],
      estimatedTokensBefore: 20,
      estimatedTokensAfter: 10,
      checkpointTokens: 10,
      tailTokens: 0,
      timestamp: 3
    })
    insertEvent(database, 4, 'user_message', {
      content: 'tail one',
      delivery: 'prompt',
      timestamp: 4
    })
    insertEvent(database, 5, 'assistant_message', assistantPayload('tail answer', 5))
    insertEvent(database, 6, 'user_message', {
      content: 'tail two',
      delivery: 'prompt',
      timestamp: 6
    })

    expect(latestSuccessfulCheckpoint(database, 'session-1')).toMatchObject({
      coveredThroughSequence: 2,
      summary: expect.stringContaining('verified thesis')
    })
    const history = loadContinuousRuntimeHistory(database, 'session-1')
    expect(history).toHaveLength(4)
    expect(history[0]).toMatchObject({
      role: 'user',
      content: expect.stringContaining('instructionSemantics="false"')
    })
    expect(history[0]).toMatchObject({ content: expect.stringContaining('verified thesis') })
    expect(history[0]).toMatchObject({ content: expect.stringContaining('authority="none"') })
    expect(history.slice(1).map((message) => message.role)).toEqual(['user', 'assistant', 'user'])
    expect(JSON.stringify(history)).not.toContain('old request')
    database.close()
  })

  it('loads only v3 checkpoints as bounded conversation memory', async () => {
    const database = await createDatabase()
    insertSession(database)
    insertEvent(database, 1, 'user_message', {
      content: 'Preserve the terminology.',
      delivery: 'prompt',
      timestamp: 1
    })
    insertEvent(database, 2, 'run_completed', { outcome: 'finished' })
    insertEvent(database, 3, 'compaction_summary', {
      schemaVersion: 3,
      handoffMode: 'bounded_conversation_memory',
      compactionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc423',
      trigger: 'manual',
      stepIndex: 1,
      finalStep: true,
      previousCheckpointEventId: null,
      coveredFromSequence: 1,
      coveredThroughSequence: 2,
      summary: 'Active user requirements\nPreserve the terminology.',
      proposalOutcomes: [],
      approvalDecisions: [],
      citationIds: [],
      toolOutcomes: [],
      estimatedTokensBefore: 20,
      estimatedTokensAfter: 10,
      checkpointTokens: 4,
      tailTokens: 6,
      postCompactionBudgetTokens: 32_000,
      checkpointBudgetTokens: 12_000,
      recentTailBudgetTokens: 20_000,
      timestamp: 3
    })

    const checkpoint = latestSuccessfulCheckpoint(database, 'session-1')
    expect(checkpoint).toMatchObject({
      schemaVersion: 3,
      handoffMode: 'bounded_conversation_memory'
    })
    expect(loadContinuousRuntimeHistory(database, 'session-1')[0]).toMatchObject({
      role: 'user',
      content: expect.stringContaining('authority="conversation_memory"')
    })
    database.close()
  })

  it('reads a 10,000-event conversation through a bounded first compaction page', async () => {
    const database = await createDatabase()
    insertSession(database)
    database.immediate((native) => {
      const insert = native.prepare(
        `INSERT INTO agent_events (
           agent_event_id, agent_session_id, sequence, type, payload_json, created_at
         ) VALUES (?, 'session-1', ?, ?, ?, ?)`
      )
      native.transaction(() => {
        for (let sequence = 1; sequence <= 10_000; sequence += 1) {
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

    const material = buildNextCompactionMaterial({
      database,
      agentSessionId: 'session-1'
    })
    expect(material?.sourceEventCount).toBeLessThanOrEqual(240)
    expect(material?.coveredFromSequence).toBe(1)
    expect(material?.coveredThroughSequence).toBeLessThan(10_000)
    expect(material?.hasMoreCompactionCandidate).toBe(true)
    database.close()
  })

  it('does not summarize a complete turn that cannot fit the compaction input budget', async () => {
    const database = await createDatabase()
    insertSession(database)
    insertEvent(database, 1, 'user_message', {
      content: `Oversized request ${'写'.repeat(20_000)}`,
      delivery: 'prompt',
      timestamp: 1
    })
    insertEvent(database, 2, 'run_completed', { outcome: 'finished' })
    insertEvent(database, 3, 'user_message', {
      content: 'Keep this recent turn raw.',
      delivery: 'prompt',
      timestamp: 3
    })
    insertEvent(database, 4, 'run_completed', { outcome: 'finished' })

    expect(
      buildNextCompactionMaterial({
        database,
        agentSessionId: 'session-1',
        sourceTokenBudget: 100
      })
    ).toBeNull()
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
