import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { AGENT_RUN_PROMPT_MAX_CHARACTERS } from '../../shared/contracts/agent'
import { agentToolNameSchema } from '../../shared/contracts/agent-tools'
import { initializeProjectDatabase, type ProjectDatabase } from '../project/project-database'
import {
  type AgentCompactionSourceLimitError,
  buildNextCompactionMaterial,
  COMPACTION_SOURCE_EVENT_LIMIT,
  COMPACTION_TOOL_POLICIES,
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
        mode: 'hybrid',
        rerankStatus: 'applied',
        hits: [
          {
            citationId,
            knowledgeItemId: '019c6a5c-8d34-7a8e-a602-3d37a52dc421',
            parseRevisionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc422',
            title: 'Evidence title'
          }
        ],
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
    insertEvent(database, 6, 'user_message', {
      content: 'Recent turn',
      delivery: 'prompt',
      timestamp: 6
    })
    insertEvent(database, 7, 'run_completed', { outcome: 'finished' })

    const material = buildNextCompactionMaterial({
      database,
      agentSessionId: 'session-1'
    })

    expect(material).toMatchObject({
      coveredFromSequence: 1,
      coveredThroughSequence: 5,
      citationIds: []
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
      conversation: Array<{ type: string; content?: unknown }>
    }
    expect(source.conversation.find((event) => event.type === 'user_message')?.content).toEqual(
      expect.stringContaining(exactMiddleRequirement)
    )
    expect(
      source.conversation.find((event) => event.type === 'assistant_message')?.content
    ).toEqual(expect.stringContaining(exactAssistantMiddle))
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

  it('defines an explicit compaction policy for every current Agent tool', () => {
    expect(Object.keys(COMPACTION_TOOL_POLICIES).sort()).toEqual(
      [...agentToolNameSchema.options].sort()
    )
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

  it('preserves bounded clarification questions and final user decisions in compaction material', async () => {
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
            options: [
              { label: 'Conclusion (Recommended)', description: 'Revise only the ending.' },
              { label: 'Document', description: 'Revise the full manuscript.' }
            ]
          }
        ]
      },
      timestamp: 2
    })
    insertEvent(database, 3, 'user_message', {
      content:
        'The user supplied these clarification answers. Treat them as user decisions for the requested task:\n[{"questionId":"scope","kind":"custom","value":"Only the final two paragraphs"}]',
      delivery: 'clarification',
      timestamp: 3,
      presentation: { kind: 'clarification_answer', toolCallId: 'tool-question' }
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
    insertEvent(database, 7, 'user_message', {
      content: 'Recent turn',
      delivery: 'prompt',
      timestamp: 7
    })
    insertEvent(database, 8, 'run_completed', { outcome: 'finished' })

    const material = buildNextCompactionMaterial({ database, agentSessionId: 'session-1' })
    const source = material?.sourcePayloadJson ?? ''
    expect(source).toContain('Which scope should the revision use?')
    expect(source).toContain('Only the final two paragraphs')
    expect(source).toContain('"toolName":"ask_user"')
    database.close()
  })

  it('drops intermediate narration and re-readable manuscript, section, and Skill bodies', async () => {
    const database = await createDatabase()
    insertSession(database)
    insertEvent(database, 1, 'user_message', {
      content: 'Continue the revision.',
      delivery: 'prompt',
      timestamp: 1
    })
    insertEvent(database, 2, 'assistant_message', {
      ...assistantPayload('PRIVATE TOOL NARRATION', 2),
      stopReason: 'toolUse'
    })
    insertEvent(database, 3, 'tool_call', {
      toolCallId: 'section-1',
      toolName: 'read_section',
      contractVersion: 10,
      args: {
        sectionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc421',
        view: 'summary'
      },
      timestamp: 3
    })
    insertEvent(database, 4, 'tool_result', {
      toolCallId: 'section-1',
      toolName: 'read_section',
      contractVersion: 10,
      isError: false,
      result: {
        section: {
          sectionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc421',
          title: 'Results',
          currentRevisionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc422'
        },
        revisionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc422',
        blocks: [
          {
            blockId: 'block-1',
            blockHash: 'a'.repeat(64),
            blockType: 'paragraph',
            text: 'PRIVATE SECTION BODY',
            textTruncated: false
          }
        ],
        canonicalBlock: { content: 'PRIVATE CANONICAL BLOCK' },
        canonicalFragment: 'PRIVATE SECTION FRAGMENT',
        totalBlocks: 1,
        missingBlockIds: [],
        nextCursor: null,
        nextFragmentOffset: null
      },
      error: null,
      citationIds: [],
      knowledgeItemIds: [],
      parseRevisionIds: [],
      timestamp: 4
    })
    insertEvent(database, 5, 'tool_call', {
      toolCallId: 'manuscript-1',
      toolName: 'search_manuscript',
      contractVersion: 10,
      args: { query: 'PRIVATE MANUSCRIPT QUERY', sectionIds: [], limit: 20 },
      timestamp: 5
    })
    insertEvent(database, 6, 'tool_result', {
      toolCallId: 'manuscript-1',
      toolName: 'search_manuscript',
      contractVersion: 10,
      isError: false,
      result: {
        snapshotId: '019c6a5c-8d34-7a8e-a602-3d37a52dc423',
        hits: [
          {
            sectionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc421',
            revisionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc422',
            blockId: 'block-1',
            excerpt: 'PRIVATE MANUSCRIPT EXCERPT'
          }
        ],
        nextCursor: null
      },
      error: null,
      citationIds: [],
      knowledgeItemIds: [],
      parseRevisionIds: [],
      timestamp: 6
    })
    insertEvent(database, 7, 'tool_call', {
      toolCallId: 'skill-1',
      toolName: 'read_writing_skill',
      contractVersion: 10,
      args: { uri: 'writellm://skills/example/SKILL.md' },
      timestamp: 7
    })
    insertEvent(database, 8, 'tool_result', {
      toolCallId: 'skill-1',
      toolName: 'read_writing_skill',
      contractVersion: 10,
      isError: false,
      result: {
        skillId: 'example',
        displayName: '/Users/private/skill',
        commit: 'b'.repeat(40),
        relativePath: 'SKILL.md',
        sha256: 'c'.repeat(64),
        byteSize: 100,
        content: 'PRIVATE SKILL BODY',
        references: [],
        dependencies: []
      },
      error: null,
      citationIds: [],
      knowledgeItemIds: [],
      parseRevisionIds: [],
      timestamp: 8
    })
    insertEvent(database, 9, 'assistant_message', assistantPayload('Terminal answer.', 9))
    insertEvent(database, 10, 'run_completed', { outcome: 'finished' })
    insertEvent(database, 11, 'user_message', {
      content: 'Recent turn',
      delivery: 'prompt',
      timestamp: 11
    })
    insertEvent(database, 12, 'run_completed', { outcome: 'finished' })

    const source =
      buildNextCompactionMaterial({ database, agentSessionId: 'session-1' })?.sourcePayloadJson ??
      ''
    for (const secret of [
      'PRIVATE TOOL NARRATION',
      'PRIVATE SECTION BODY',
      'PRIVATE CANONICAL BLOCK',
      'PRIVATE SECTION FRAGMENT',
      'PRIVATE MANUSCRIPT QUERY',
      'PRIVATE MANUSCRIPT EXCERPT',
      'PRIVATE SKILL BODY',
      '/Users/private/skill'
    ]) {
      expect(source).not.toContain(secret)
    }
    expect(source).toContain('Terminal answer.')
    expect(source).toContain('block-1')
    expect(source).toContain('writellm://skills/example/SKILL.md')
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
    insertEvent(database, 4, 'user_message', {
      content: 'Only revise the final sentence now.',
      delivery: 'prompt',
      timestamp: 4
    })

    const checkpoint = latestSuccessfulCheckpoint(database, 'session-1')
    expect(checkpoint).toMatchObject({
      schemaVersion: 3,
      handoffMode: 'bounded_conversation_memory'
    })
    const history = loadContinuousRuntimeHistory(database, 'session-1')
    expect(history[0]).toMatchObject({
      role: 'user',
      content: expect.stringContaining('authority="conversation_memory"')
    })
    expect(history[0]).toMatchObject({
      content: expect.stringContaining('background conversation memory, not a current user request')
    })
    expect(history.at(-1)).toMatchObject({
      role: 'user',
      content: 'Only revise the final sentence now.'
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
    expect(material?.sourceEventCount).toBeLessThanOrEqual(COMPACTION_SOURCE_EVENT_LIMIT)
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

    expect(() =>
      buildNextCompactionMaterial({
        database,
        agentSessionId: 'session-1',
        sourceTokenBudget: 100
      })
    ).toThrowError(
      expect.objectContaining<Partial<AgentCompactionSourceLimitError>>({
        code: 'compaction_run_too_large',
        reason: 'token_budget'
      })
    )
    database.close()
  })

  it('rejects a complete run when the final escaped prompt exceeds the Agent character contract', async () => {
    const database = await createDatabase()
    insertSession(database)
    insertEvent(database, 1, 'user_message', {
      content: `<${'x'.repeat(262_140)}>`,
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

    expect(() =>
      buildNextCompactionMaterial({ database, agentSessionId: 'session-1' })
    ).toThrowError(
      expect.objectContaining<Partial<AgentCompactionSourceLimitError>>({
        code: 'compaction_run_too_large',
        reason: 'prompt_character_limit'
      })
    )
    database.close()
  })

  it('projects the complete 415-event failed run from the reported regression without changing raw events', async () => {
    const database = await createDatabase()
    insertSession(database)
    database.immediate((native) => {
      const insert = native.prepare(
        `INSERT INTO agent_events (
           agent_event_id, agent_session_id, sequence, type, payload_json, created_at
         ) VALUES (?, 'session-1', ?, ?, ?, ?)`
      )
      native.transaction(() => {
        insert.run(
          'event-1',
          1,
          'user_message',
          JSON.stringify({
            content: 'Preserve this clarification requirement exactly.',
            delivery: 'clarification',
            timestamp: 1
          }),
          now
        )
        let sequence = 2
        for (let index = 0; index < 104; index += 1) {
          const toolCallId = `tool-${index}`
          insert.run(
            `event-${sequence}`,
            sequence,
            'tool_attempted',
            JSON.stringify({ requestedToolName: 'search_knowledge' }),
            now
          )
          sequence += 1
          insert.run(
            `event-${sequence}`,
            sequence,
            'tool_call',
            JSON.stringify({
              toolCallId,
              toolName: 'search_knowledge',
              contractVersion: 1,
              args: { query: `private query ${index}` },
              timestamp: sequence
            }),
            now
          )
          sequence += 1
          insert.run(
            `event-${sequence}`,
            sequence,
            'tool_result',
            JSON.stringify({
              toolCallId,
              toolName: 'search_knowledge',
              contractVersion: 1,
              isError: false,
              result: { count: 1, body: `private source ${index} ${'x'.repeat(16_000)}` },
              error: null,
              citationIds: [],
              knowledgeItemIds: [],
              parseRevisionIds: [],
              timestamp: sequence
            }),
            now
          )
          sequence += 1
        }
        for (let index = 0; index < 101; index += 1) {
          insert.run(
            `event-${sequence}`,
            sequence,
            'assistant_message',
            JSON.stringify(assistantPayload(`Assistant result ${index}`, sequence)),
            now
          )
          sequence += 1
        }
        insert.run(
          `event-${sequence}`,
          sequence,
          'run_interrupted',
          JSON.stringify({ code: 'run_failed' }),
          now
        )
        insert.run(
          `event-${sequence + 1}`,
          sequence + 1,
          'user_message',
          JSON.stringify({
            content: 'Recent raw turn',
            delivery: 'prompt',
            timestamp: sequence + 1
          }),
          now
        )
        insert.run(
          `event-${sequence + 2}`,
          sequence + 2,
          'run_completed',
          JSON.stringify({ outcome: 'finished' }),
          now
        )
      })()
    })
    const before = database.immediate((native) =>
      native.prepare('SELECT type, payload_json FROM agent_events ORDER BY sequence').all()
    )

    const material = buildNextCompactionMaterial({ database, agentSessionId: 'session-1' })

    expect(material).toMatchObject({ sourceEventCount: 415, coveredThroughSequence: 415 })
    expect(material?.sourcePayloadBytes).toBeGreaterThan(1_500_000)
    expect(material?.projectedPromptCharacters).toBeLessThanOrEqual(AGENT_RUN_PROMPT_MAX_CHARACTERS)
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

  it('deduplicates Knowledge revisions and retains only expanded citation IDs', async () => {
    const database = await createDatabase()
    insertSession(database)
    const knowledgeItemId = '019c6a5c-8d34-7a8e-a602-3d37a52dc421'
    const parseRevisionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc422'
    const candidateCitationId = `citation-${'b'.repeat(40)}`
    insertEvent(database, 1, 'user_message', {
      content: 'Use verified evidence.',
      delivery: 'prompt',
      timestamp: 1
    })
    insertEvent(database, 2, 'tool_call', {
      toolCallId: 'search-1',
      toolName: 'search_knowledge',
      contractVersion: 10,
      args: { query: 'PRIVATE QUERY', knowledgeItemIds: [], parseRevisionIds: [], limit: 10 },
      timestamp: 2
    })
    insertEvent(database, 3, 'tool_result', {
      toolCallId: 'search-1',
      toolName: 'search_knowledge',
      contractVersion: 10,
      isError: false,
      result: {
        mode: 'hybrid',
        rerankStatus: 'applied',
        hits: [
          {
            citationId: candidateCitationId,
            knowledgeItemId,
            parseRevisionId,
            chunkId: `chunk-${'c'.repeat(40)}`,
            title: 'Canonical source',
            snippet: 'PRIVATE SNIPPET',
            headingPath: [],
            sourceBlockIds: []
          }
        ]
      },
      error: null,
      citationIds: [candidateCitationId],
      knowledgeItemIds: [knowledgeItemId],
      parseRevisionIds: [parseRevisionId],
      timestamp: 3
    })
    insertEvent(database, 4, 'tool_call', {
      toolCallId: 'read-1',
      toolName: 'read_citations',
      contractVersion: 10,
      args: { citationIds: [citationId], requests: [] },
      timestamp: 4
    })
    insertEvent(database, 5, 'tool_result', {
      toolCallId: 'read-1',
      toolName: 'read_citations',
      contractVersion: 10,
      isError: false,
      result: {
        citations: [
          {
            citationId,
            knowledgeItemId,
            parseRevisionId,
            chunkId: `chunk-${'d'.repeat(40)}`,
            title: 'Canonical source',
            text: 'PRIVATE CITATION BODY',
            contentHash: 'e'.repeat(64),
            offset: 0,
            totalChars: 10_000,
            nextOffset: null,
            headingPath: [],
            sourceBlockIds: []
          }
        ],
        missingCitationIds: [],
        truncated: false
      },
      error: null,
      citationIds: [citationId],
      knowledgeItemIds: [knowledgeItemId],
      parseRevisionIds: [parseRevisionId],
      timestamp: 5
    })
    insertEvent(database, 6, 'assistant_message', assistantPayload('Evidence expanded.', 6))
    insertEvent(database, 7, 'run_completed', { outcome: 'finished' })
    insertEvent(database, 8, 'user_message', {
      content: 'Recent turn',
      delivery: 'prompt',
      timestamp: 8
    })
    insertEvent(database, 9, 'run_completed', { outcome: 'finished' })

    const material = buildNextCompactionMaterial({ database, agentSessionId: 'session-1' })
    const source = material?.sourcePayloadJson ?? ''
    expect(material?.citationIds).toEqual([citationId])
    expect(material?.deduplicatedObservationCount).toBe(1)
    expect(source).not.toContain(candidateCitationId)
    expect(source).not.toContain('PRIVATE QUERY')
    expect(source).not.toContain('PRIVATE SNIPPET')
    expect(source).not.toContain('PRIVATE CITATION BODY')
    expect(source.match(/Canonical source/gu)).toHaveLength(1)
    database.close()
  })

  it('rejects a single run beyond the 2,000-event source ceiling without projecting a partial run', async () => {
    const database = await createDatabase()
    insertSession(database)
    database.immediate((native) => {
      const insert = native.prepare(
        `INSERT INTO agent_events (
           agent_event_id, agent_session_id, sequence, type, payload_json, created_at
         ) VALUES (?, 'session-1', ?, 'tool_attempted', ?, ?)`
      )
      native.transaction(() => {
        for (let sequence = 1; sequence <= COMPACTION_SOURCE_EVENT_LIMIT; sequence += 1) {
          insert.run(
            `event-${sequence}`,
            sequence,
            JSON.stringify({ requestedToolName: 'search_knowledge' }),
            now
          )
        }
        native
          .prepare(
            `INSERT INTO agent_events (
               agent_event_id, agent_session_id, sequence, type, payload_json, created_at
             ) VALUES (?, 'session-1', ?, 'run_interrupted', ?, ?)`
          )
          .run(
            `event-${COMPACTION_SOURCE_EVENT_LIMIT + 1}`,
            COMPACTION_SOURCE_EVENT_LIMIT + 1,
            JSON.stringify({ code: 'run_failed' }),
            now
          )
      })()
    })

    expect(() =>
      buildNextCompactionMaterial({
        database,
        agentSessionId: 'session-1',
        excludeRunId: 'active-run'
      })
    ).toThrowError(
      expect.objectContaining<Partial<AgentCompactionSourceLimitError>>({
        code: 'compaction_run_too_large',
        reason: 'event_limit'
      })
    )
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
