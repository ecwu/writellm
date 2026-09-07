import { insertEvent } from './session-event-utils'
import { requireProposal } from './mutation-storage'
import { dirname } from 'node:path'
import { openProjectDatabase } from '../project/project-database'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  assistant,
  metadata,
  log,
  createDatabase,
  createService,
  FakeAgentRuntime
} from './session-service.test-support'
import {
  buildNextCompactionMaterial,
  loadContinuousRuntimeHistory,
  latestSuccessfulCheckpoint
} from './context-checkpoint'

const editorContext = { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
async function fixture() {
  const database = await createDatabase()
  const runtime = new FakeAgentRuntime()
  const service = createService(database, runtime)
  const source = service.createSession('Original')
  const send = async (agentSessionId: string, prompt: string, answer: string) => {
    const run = await service.startRun({ agentSessionId, prompt, editorContext })
    const active = runtime.active()
    await active.emit({
      type: 'assistant_message',
      modelRequestId: active.input.modelRequestId,
      message: assistant(answer, 'fork-response')
    })
    await active.emit({
      type: 'model_call_finished',
      modelRequestId: active.input.modelRequestId,
      outcome: 'succeeded',
      metadata: metadata('fork-response')
    })
    active.resolve()
    await run.completion
    const target = service
      .listEvents(agentSessionId)
      .filter((event) => event.type === 'assistant_message')
      .at(-1)
    if (!target) throw new Error('Missing assistant reply')
    return target
  }
  return { database, runtime, service, source, send }
}

describe('Conversation fork', () => {
  it('freezes the effective prefix without new execution and supports flattened nested forks', async () => {
    const f = await fixture()
    const target = await f.send(f.source.agentSessionId, 'First question', 'First answer')
    await f.send(f.source.agentSessionId, 'Future question', 'Future answer')
    const before = f.database.immediate((db) =>
      db.prepare('SELECT COUNT(*) FROM agent_runs').pluck().get()
    )
    const input = {
      sourceSessionId: f.source.agentSessionId,
      targetEventId: target.agentEventId,
      requestId: randomUUID()
    }
    const child = f.service.forkConversation(input)
    expect(f.service.forkConversation(input).agentSessionId).toBe(child.agentSessionId)
    expect(f.service.listRuns(child.agentSessionId)).toEqual([])
    expect(
      f.database.immediate((db) => db.prepare('SELECT COUNT(*) FROM agent_runs').pluck().get())
    ).toBe(before)
    expect(child.workflowState).toBe('idle')
    expect(child.messageEdit?.targetEventId).toBeNull()
    expect(
      JSON.stringify(loadContinuousRuntimeHistory(f.database, child.agentSessionId))
    ).toContain('First answer')
    expect(
      JSON.stringify(loadContinuousRuntimeHistory(f.database, child.agentSessionId))
    ).not.toContain('Future')
    expect(f.service.listEvents(child.agentSessionId).every((event) => event.inheritedFrom)).toBe(
      true
    )
    const inherited = f.service
      .listEvents(child.agentSessionId)
      .find((event) => event.type === 'assistant_message')
    if (!inherited) throw new Error('Missing inherited reply')
    const nested = f.service.forkConversation({
      sourceSessionId: child.agentSessionId,
      targetEventId: inherited.agentEventId,
      requestId: randomUUID()
    })
    expect(
      f.service
        .listEvents(nested.agentSessionId)
        .map((event) => event.inheritedFrom?.agentSessionId)
    ).toEqual(f.service.listEvents(child.agentSessionId).map(() => f.source.agentSessionId))
    const next = await f.service.startRun({
      agentSessionId: child.agentSessionId,
      prompt: 'Different angle',
      editorContext
    })
    expect(JSON.stringify(f.runtime.active().input.history)).toContain('First answer')
    expect(JSON.stringify(f.runtime.active().input.history)).toContain(
      'Re-read current project state'
    )
    expect(f.service.listEvents(child.agentSessionId).at(-1)?.sequence).toBeGreaterThan(
      target.sequence
    )
    f.runtime.active().resolve()
    await next.completion
    expect(JSON.stringify(f.service.listEvents(f.source.agentSessionId))).not.toContain(
      'Different angle'
    )
    await f.service.close()
    f.database.close()
  })

  it('survives parent replacement and archive while rejecting a stale fork target', async () => {
    const f = await fixture()
    const target = await f.send(f.source.agentSessionId, 'Old question', 'Old answer')
    const input = {
      sourceSessionId: f.source.agentSessionId,
      targetEventId: target.agentEventId,
      requestId: randomUUID()
    }
    const child = f.service.forkConversation(input)
    const state = f.service.getSession(f.source.agentSessionId).messageEdit
    if (!state?.targetEventId) throw new Error('Missing editable message')
    const edited = await f.service.editLastMessageAndRestart({
      agentSessionId: f.source.agentSessionId,
      targetEventId: state.targetEventId,
      expectedThroughSequence: state.throughSequence,
      content: 'Replacement',
      editorContext
    })
    f.runtime.active().resolve()
    await edited.completion
    expect(() => f.service.forkConversation({ ...input, requestId: randomUUID() })).toThrow(
      'unavailable'
    )
    expect(f.service.getSession(child.agentSessionId).fork?.sourceAvailable).toBe(false)
    expect(
      JSON.stringify(loadContinuousRuntimeHistory(f.database, child.agentSessionId))
    ).toContain('Old answer')
    f.service.archiveSession(f.source.agentSessionId)
    expect(f.service.forkConversation(input).agentSessionId).toBe(child.agentSessionId)
    expect(f.service.listEvents(child.agentSessionId)).toHaveLength(2)
    await f.service.close()
    f.database.close()
  })

  it('does not inherit summaries and paginates the exact prefix while parent continues', async () => {
    const f = await fixture()
    const target = await f.send(f.source.agentSessionId, 'Before branch', 'Before answer')
    await f.send(f.source.agentSessionId, 'Secret future', 'Secret answer')
    await f.service.compactSession(f.source.agentSessionId)
    await vi.waitFor(() => expect(f.service.projectActivitySnapshot().compactions).toEqual([]))
    const active = await f.service.startRun({
      agentSessionId: f.source.agentSessionId,
      prompt: 'Ongoing',
      editorContext
    })
    const child = f.service.forkConversation({
      sourceSessionId: f.source.agentSessionId,
      targetEventId: target.agentEventId,
      requestId: randomUUID()
    })
    expect(latestSuccessfulCheckpoint(f.database, child.agentSessionId)).toBeNull()
    expect(
      JSON.stringify(
        buildNextCompactionMaterial({ database: f.database, agentSessionId: child.agentSessionId })
      )
    ).not.toContain('Secret')
    const first = f.service.listEventPage(child.agentSessionId, 0, 1)
    const second = f.service.listEventPage(child.agentSessionId, first.nextAfterSequence, 1)
    expect(first.hasMore).toBe(true)
    expect(second.events[0].payload.content).toBe('Before answer')
    expect(second.hasMore).toBe(false)
    f.runtime.active().resolve()
    await active.completion
    await f.service.close()
    f.database.close()
  })

  it('rolls back partial fork creation and reopens the frozen history without copying runs', async () => {
    const f = await fixture()
    const target = await f.send(f.source.agentSessionId, 'Persistent question', 'Persistent answer')
    const input = {
      sourceSessionId: f.source.agentSessionId,
      targetEventId: target.agentEventId,
      requestId: randomUUID()
    }
    f.database.immediate((db) =>
      db.exec(`CREATE TRIGGER fail_fork BEFORE INSERT ON agent_history_references
      BEGIN SELECT RAISE(ABORT, 'injected reference failure'); END`)
    )
    expect(() => f.service.forkConversation(input)).toThrow('injected reference failure')
    expect(f.service.listSessions()).toHaveLength(1)
    expect(
      f.database.immediate((db) =>
        db.prepare('SELECT COUNT(*) FROM agent_conversation_forks').pluck().get()
      )
    ).toBe(0)
    f.database.immediate((db) => db.exec('DROP TRIGGER fail_fork'))
    const child = f.service.forkConversation(input)
    const history = f.service.listEvents(child.agentSessionId)
    const root = f.database.immediate((db) => dirname(dirname(db.name)))
    await f.service.close()
    f.database.close()
    const reopened = await openProjectDatabase({
      projectRoot: root,
      applicationVersion: 'test',
      log,
      manifest: {
        format: 'writellm-project',
        formatVersion: 1,
        projectId: '019c6a5c-8d34-7a8e-a602-3d37a52dc421',
        createdAt: '2026-07-21T00:00:00.000Z'
      }
    })
    const service = createService(reopened, new FakeAgentRuntime())
    expect(service.listEvents(child.agentSessionId)).toEqual(history)
    expect(service.listRuns(child.agentSessionId)).toEqual([])
    expect(service.forkConversation(input).agentSessionId).toBe(child.agentSessionId)
    expect(reopened.immediate((db) => db.pragma('integrity_check', { simple: true }))).toBe('ok')
    expect(reopened.immediate((db) => db.pragma('foreign_key_check'))).toEqual([])
    await service.close()
    reopened.close()
  })

  it('inherits settings but cannot execute a parent proposal or inherit edit authority', async () => {
    const f = await fixture()
    const first = await f.send(f.source.agentSessionId, 'Earlier request', 'Earlier reply')
    const proposalId = randomUUID()
    f.database.immediate((db) => {
      const call = insertEvent(db, {
        eventId: randomUUID(),
        sessionId: f.source.agentSessionId,
        runId: first.agentRunId,
        type: 'tool_call',
        payload: {
          toolCallId: 'old-call',
          toolName: 'submit_brief_change',
          args: {},
          timestamp: 1
        },
        modelRequestId: null,
        createdAt: new Date().toISOString()
      })
      db.prepare(`INSERT INTO mutation_proposals (mutation_proposal_id, agent_session_id, agent_run_id,
        tool_call_event_id, agent_tool_call_id, kind, payload_json, base_brief_version, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'old-call', 'brief_update', '{}', 1, 'pending', ?, ?)`).run(
        proposalId,
        f.source.agentSessionId,
        first.agentRunId,
        call.agentEventId,
        new Date().toISOString(),
        new Date().toISOString()
      )
    })
    // A historical read-only assistant reply can coexist with pending review authority in its source.
    const target = f.database.immediate((db) =>
      insertEvent(db, {
        eventId: randomUUID(),
        sessionId: f.source.agentSessionId,
        runId: first.agentRunId,
        type: 'assistant_message',
        payload: assistant('Review this proposal', 'pending'),
        modelRequestId: null,
        createdAt: new Date().toISOString()
      })
    )
    f.database.immediate((db) =>
      db
        .prepare(`UPDATE agent_sessions SET approval_mode = 'section_auto', interaction_mode = 'ask',
      thinking_level = 'high' WHERE agent_session_id = ?`)
        .run(f.source.agentSessionId)
    )
    const child = f.service.forkConversation({
      sourceSessionId: f.source.agentSessionId,
      targetEventId: target.agentEventId,
      requestId: randomUUID()
    })
    expect(child).toMatchObject({
      approvalMode: 'section_auto',
      interactionMode: 'ask',
      thinkingLevel: 'high',
      workflowState: 'idle'
    })
    expect(child.modelSelection).toEqual(
      f.service.getSession(f.source.agentSessionId).modelSelection
    )
    expect(child.messageEdit?.targetEventId).toBeNull()
    expect(
      f.service.listEvents(child.agentSessionId).some((event) => event.type === 'tool_call')
    ).toBe(true)
    f.database.immediate((db) => {
      expect(requireProposal(db, f.source.agentSessionId, proposalId).status).toBe('pending')
      expect(() => requireProposal(db, child.agentSessionId, proposalId)).toThrow('does not exist')
      expect(
        db
          .prepare('SELECT COUNT(*) FROM agent_effective_events WHERE agent_session_id = ?')
          .pluck()
          .get(child.agentSessionId)
      ).toBe(0)
      expect(
        db
          .prepare('SELECT COUNT(*) FROM agent_runs WHERE agent_session_id = ?')
          .pluck()
          .get(child.agentSessionId)
      ).toBe(0)
    })
    await f.service.close()
    f.database.close()
  })

  it('forks an archived source without restoring it and rejects truncated assistant output', async () => {
    const f = await fixture()
    const target = await f.send(f.source.agentSessionId, 'Settled', 'Complete reply')
    f.service.archiveSession(f.source.agentSessionId)
    expect(
      f.service.forkConversation({
        sourceSessionId: f.source.agentSessionId,
        targetEventId: target.agentEventId,
        requestId: randomUUID()
      }).status
    ).toBe('active')
    expect(f.service.getSession(f.source.agentSessionId).status).toBe('archived')
    for (const stopReason of ['length', 'error', 'aborted', 'toolUse'] as const) {
      const incomplete = f.database.immediate((db) =>
        insertEvent(db, {
          eventId: randomUUID(),
          sessionId: f.source.agentSessionId,
          runId: target.agentRunId,
          type: 'assistant_message',
          payload: { ...assistant('Partial', 'partial'), stopReason },
          modelRequestId: null,
          createdAt: new Date().toISOString()
        })
      )
      expect(() =>
        f.service.forkConversation({
          sourceSessionId: f.source.agentSessionId,
          targetEventId: incomplete.agentEventId,
          requestId: randomUUID()
        })
      ).toThrow('unavailable')
    }
    await f.service.close()
    f.database.close()
  })

  it('rejects incomplete replies, foreign targets and reused request identities', async () => {
    const f = await fixture()
    const run = await f.service.startRun({
      agentSessionId: f.source.agentSessionId,
      prompt: 'Pending',
      editorContext
    })
    const active = f.runtime.active()
    await active.emit({
      type: 'assistant_message',
      modelRequestId: f.runtime.active().input.modelRequestId,
      message: assistant('Not settled', 'response')
    })
    const target = f.service.listEvents(f.source.agentSessionId).at(-1)
    if (!target) throw new Error('Missing target')
    const input = {
      sourceSessionId: f.source.agentSessionId,
      targetEventId: target.agentEventId,
      requestId: randomUUID()
    }
    expect(() => f.service.forkConversation(input)).toThrow('unavailable')
    await active.emit({
      type: 'model_call_finished',
      modelRequestId: f.runtime.active().input.modelRequestId,
      outcome: 'succeeded',
      metadata: metadata('response')
    })
    f.runtime.active().resolve()
    await run.completion
    f.service.forkConversation(input)
    expect(() => f.service.forkConversation({ ...input, targetEventId: randomUUID() })).toThrow(
      'already used'
    )
    expect(() =>
      f.service.forkConversation({
        ...input,
        sourceSessionId: f.service.createSession().agentSessionId,
        requestId: randomUUID()
      })
    ).toThrow('unavailable')
    expect(f.database.immediate((db) => db.pragma('foreign_key_check'))).toEqual([])
    await f.service.close()
    f.database.close()
  })
})
