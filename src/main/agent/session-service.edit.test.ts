import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openProjectDatabase } from '../project/project-database'
import {
  buildNextCompactionMaterial,
  loadContinuousRuntimeHistory,
  latestSuccessfulCheckpoint
} from './context-checkpoint'
import { requireProposal } from './mutation-storage'
import {
  assistant,
  createDatabase,
  createService,
  FakeAgentRuntime,
  log
} from './session-service.test-support'

const editorContext = { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }

async function fixture() {
  const database = await createDatabase()
  const runtime = new FakeAgentRuntime()
  const service = createService(database, runtime)
  const agentSessionId = service.createSession('Editing').agentSessionId
  const send = (prompt: string) => service.startRun({ agentSessionId, prompt, editorContext })
  const finish = async (run: Awaited<ReturnType<typeof send>>, content = 'Old answer') => {
    await runtime.active().emit({
      type: 'assistant_message',
      modelRequestId: runtime.active().input.modelRequestId,
      message: assistant(content, 'edit-response')
    })
    runtime.active().resolve()
    await run.completion
  }
  const editInput = (content = 'Revised message') => {
    const state = service
      .listSessions()
      .find((s) => s.agentSessionId === agentSessionId)?.messageEdit
    if (state?.targetEventId == null) throw new Error('No editable message')
    return {
      agentSessionId,
      targetEventId: state.targetEventId,
      expectedThroughSequence: state.throughSequence,
      content,
      editorContext
    }
  }
  const event = (type: string, payload: unknown, runId: string | null = null) =>
    database.immediate((native) => {
      const id = randomUUID()
      native
        .prepare(`INSERT INTO agent_events (agent_event_id, agent_session_id, agent_run_id, sequence, type, payload_json, created_at)
      VALUES (?, ?, ?, (SELECT COALESCE(MAX(sequence), 0) + 1 FROM agent_events WHERE agent_session_id = ?), ?, ?, ?)`)
        .run(
          id,
          agentSessionId,
          runId,
          agentSessionId,
          type,
          JSON.stringify(payload),
          new Date().toISOString()
        )
      return id
    })
  const proposal = (runId: string) => {
    const toolId = randomUUID()
    const eventId = event(
      'tool_call',
      { toolCallId: toolId, toolName: 'submit_brief_change', args: {}, timestamp: Date.now() },
      runId
    )
    const id = randomUUID()
    database.immediate((native) =>
      native
        .prepare(`INSERT INTO mutation_proposals (
      mutation_proposal_id, agent_session_id, agent_run_id, tool_call_event_id, agent_tool_call_id,
      kind, payload_json, base_brief_version, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'brief_update', '{}', 1, 'pending', ?, ?)`)
        .run(
          id,
          agentSessionId,
          runId,
          eventId,
          toolId,
          new Date().toISOString(),
          new Date().toISOString()
        )
    )
    return id
  }
  return { database, runtime, service, agentSessionId, send, finish, editInput, event, proposal }
}

describe('Agent message editing', () => {
  it('replaces only the latest suffix, retains raw evidence and survives reopen and repeated edits', async () => {
    const f = await fixture()
    await f.finish(await f.send('First message'), 'First answer')
    await f.finish(await f.send('Second message'))
    const oldCount = f.database.immediate((db) =>
      db.prepare('SELECT COUNT(*) FROM agent_events').pluck().get()
    ) as number
    const input = f.editInput()
    const next = await f.service.editLastMessageAndRestart(input)
    expect(f.runtime.active().input.prompt).toBe('Revised message')
    const history = JSON.stringify(f.runtime.active().input.history)
    expect(history).toContain('First answer')
    expect(history).not.toContain('Second message')
    expect(history).not.toContain('Old answer')
    expect(
      f.service.listEvents(f.agentSessionId).some((e) => e.agentEventId === input.targetEventId)
    ).toBe(false)
    await f.finish(next, 'New answer')
    expect(
      f.database.immediate((db) => db.prepare('SELECT COUNT(*) FROM agent_events').pluck().get())
    ).toBeGreaterThan(oldCount)
    expect(f.service.listRuns(f.agentSessionId)).toHaveLength(3)
    const repeat = await f.service.editLastMessageAndRestart(f.editInput('Final message'))
    expect(JSON.stringify(f.runtime.active().input.history)).not.toContain('New answer')
    await f.finish(repeat, 'Final answer')
    const root = f.database.immediate((db) => dirname(dirname(db.name)))
    const before = f.service.listEvents(f.agentSessionId)
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
    expect(createService(reopened, new FakeAgentRuntime()).listEvents(f.agentSessionId)).toEqual(
      before
    )
    expect(JSON.stringify(loadContinuousRuntimeHistory(reopened, f.agentSessionId))).not.toContain(
      'Old answer'
    )
    expect(reopened.immediate((db) => db.pragma('foreign_key_check'))).toEqual([])
    reopened.close()
  })

  it('edits only consumed follow-ups and preserves the earlier request', async () => {
    const f = await fixture()
    const first = await f.send('Initial request')
    const original = f.editInput().targetEventId
    await f.service.followUp(first.agentRunId, 'Delivered follow-up')
    expect(f.editInput().targetEventId).toBe(original)
    const pending = f.runtime.active().commands.find((command) => command.operation === 'follow_up')
    if (pending?.pendingMessageId === undefined) throw new Error('No queued follow-up')
    await f.runtime.active().emit({
      type: 'follow_up_consumption_requested',
      consumptionId: randomUUID(),
      pendingMessageId: pending.pendingMessageId,
      modelRequestId: pending.modelRequestId
    })
    expect(f.editInput().targetEventId).not.toBe(original)
    await f.service.abort(first.agentRunId)
    await first.completion
    const next = await f.service.editLastMessageAndRestart(f.editInput('Edited follow-up'))
    expect(JSON.stringify(f.runtime.active().input.history)).toContain('Initial request')
    expect(JSON.stringify(f.runtime.active().input.history)).not.toContain('Delivered follow-up')
    await f.finish(next)
    f.database.close()
  })

  it('does not invalidate a pending proposal from before the edited message', async () => {
    const f = await fixture()
    const first = await f.send('Initial request')
    const proposalId = f.proposal(first.agentRunId)
    await f.service.steer(first.agentRunId, 'Later request')
    await f.finish(first)
    await expect(f.service.editLastMessageAndRestart(f.editInput())).rejects.toThrow(
      'pending change'
    )
    expect(
      f.database.immediate((db) =>
        db
          .prepare('SELECT status FROM mutation_proposals WHERE mutation_proposal_id = ?')
          .pluck()
          .get(proposalId)
      )
    ).toBe('pending')
    f.database.close()
  })

  it('ignores manual changes and other-session effects and enforces archive state', async () => {
    const f = await fixture()
    await f.finish(await f.send('Original'))
    const other = f.service.createSession('Other session')
    f.database.immediate((db) => {
      db.prepare('INSERT INTO agent_edit_effects VALUES (?, ?, ?)').run(
        'other-effect',
        other.agentSessionId,
        100
      )
      db.prepare("UPDATE manuscript_briefs SET title = 'Manual title'").run()
    })
    const input = f.editInput()
    expect(
      f.service.listSessions().find((item) => item.agentSessionId === f.agentSessionId)?.messageEdit
        ?.reason
    ).toBeNull()
    f.service.archiveSession(f.agentSessionId)
    await expect(f.service.editLastMessageAndRestart(input)).rejects.toThrow('archived')
    f.database.close()
  })

  it('keeps the edited prompt after execution fails and allows another edit', async () => {
    const f = await fixture()
    await f.finish(await f.send('Original'))
    const edited = await f.service.editLastMessageAndRestart(f.editInput('Failed attempt'))
    f.runtime.active().reject(new Error('Fixture provider failure'))
    await edited.completion
    expect(f.service.requireRun(edited.agentRunId).status).toBe('failed')
    expect(
      f.service
        .listEvents(f.agentSessionId)
        .filter((event) => event.type === 'user_message')
        .map((event) => event.payload.content)
    ).toEqual(['Failed attempt'])
    const next = await f.service.editLastMessageAndRestart(f.editInput('Recovered attempt'))
    await f.finish(next)
    f.database.close()
  })

  it('rejects stale and duplicate submissions without changing history', async () => {
    const f = await fixture()
    await f.finish(await f.send('Message'))
    const input = f.editInput()
    const next = await f.service.editLastMessageAndRestart(input)
    await expect(f.service.editLastMessageAndRestart(input)).rejects.toThrow()
    await f.finish(next)
    await expect(f.service.editLastMessageAndRestart(input)).rejects.toThrow('conversation changed')
    expect(
      f.database.immediate((db) =>
        db.prepare('SELECT COUNT(*) FROM agent_message_replacements').pluck().get()
      )
    ).toBe(1)
    f.database.close()
  })

  it('requires stopping active work, and edits a delivered steer without erasing earlier messages in the run', async () => {
    const f = await fixture()
    const run = await f.send('Initial request')
    await f.runtime.active().emit({
      type: 'assistant_message',
      modelRequestId: f.runtime.active().input.modelRequestId,
      message: assistant('Before steer', 'before')
    })
    await f.service.steer(run.agentRunId, 'Last steer')
    expect(f.service.listSessions()[0].messageEdit?.reason).toContain('Stop')
    await expect(f.service.editLastMessageAndRestart(f.editInput())).rejects.toThrow()
    await f.service.abort(run.agentRunId)
    await run.completion
    const next = await f.service.editLastMessageAndRestart(f.editInput('Edited steer'))
    expect(JSON.stringify(f.runtime.active().input.history)).toContain('Before steer')
    expect(JSON.stringify(f.runtime.active().input.history)).not.toContain('Last steer')
    await f.finish(next)
    f.database.close()
  })

  it.each(['clarification', 'quick_action', 'approval_continuation'])(
    'does not fall back past the latest %s message',
    async (kind) => {
      const f = await fixture()
      await f.finish(await f.send('Ordinary message'))
      const presentation =
        kind === 'clarification'
          ? { kind: 'clarification_answer', toolCallId: 'question' }
          : kind === 'quick_action'
            ? {
                kind,
                action: 'rewrite',
                label: 'Rewrite',
                selectedText: 'Selection',
                displayInstruction: null
              }
            : { kind }
      f.event('user_message', {
        content: 'Generated',
        delivery: kind === 'clarification' ? kind : 'prompt',
        timestamp: Date.now(),
        presentation
      })
      expect(f.service.listSessions()[0].messageEdit?.targetEventId).toBeNull()
      f.database.close()
    }
  )

  it('invalidates pending proposals and rejects stale approval authority', async () => {
    const f = await fixture()
    const first = await f.send('Propose a change')
    const id = f.proposal(first.agentRunId)
    await f.finish(first)
    const next = await f.service.editLastMessageAndRestart(f.editInput())
    expect(
      f.database.immediate((db) =>
        db
          .prepare('SELECT status FROM mutation_proposals WHERE mutation_proposal_id = ?')
          .pluck()
          .get(id)
      )
    ).toBe('rejected')
    expect(() => f.database.immediate((db) => requireProposal(db, f.agentSessionId, id))).toThrow(
      'does not exist'
    )
    await f.finish(next)
    f.database.close()
  })

  it('blocks actual brief application while ignoring effects before the latest message', async () => {
    const f = await fixture()
    const run = await f.send('First request')
    const id = f.proposal(run.agentRunId)
    f.database.immediate((db) =>
      db
        .prepare(
          "UPDATE mutation_proposals SET status = 'applied', applied_brief_version = 2, decision_at = '2026-09-07T12:00:00.000Z' WHERE mutation_proposal_id = ?"
        )
        .run(id)
    )
    await f.finish(run)
    expect(f.service.listSessions()[0].messageEdit?.reason).toContain('changed project content')
    await expect(f.service.editLastMessageAndRestart(f.editInput())).rejects.toThrow(
      'changed project content'
    )
    // A subsequent request starts after the effect receipt, even in the same millisecond.
    await f.finish(await f.send('New question'))
    expect(f.service.listSessions()[0].messageEdit?.reason).toBeNull()
    const next = await f.service.editLastMessageAndRestart(f.editInput())
    await f.finish(next)
    f.database.close()
  })

  it('leaves the original suffix intact when provider preparation fails', async () => {
    const f = await fixture()
    await f.finish(await f.send('Original'))
    const before = f.service.listEvents(f.agentSessionId)
    const failing = createService(f.database, f.runtime, undefined, {
      resolveModelLimits: async () => {
        throw new Error('Unavailable model')
      }
    })
    await expect(failing.editLastMessageAndRestart(f.editInput())).rejects.toThrow(
      'Unavailable model'
    )
    expect(f.service.listEvents(f.agentSessionId)).toEqual(before)
    expect(
      f.database.immediate((db) =>
        db.prepare('SELECT COUNT(*) FROM agent_message_replacements').pluck().get()
      )
    ).toBe(0)
    f.database.close()
  })

  it('rechecks history after asynchronous preparation and before committing', async () => {
    const f = await fixture()
    await f.finish(await f.send('Original'))
    const limits = f.service.listRuns(f.agentSessionId)[0].modelLimits
    const racing = createService(f.database, f.runtime, undefined, {
      resolveModelLimits: async () => {
        f.event('user_message', {
          content: 'Newer message',
          delivery: 'prompt',
          timestamp: Date.now()
        })
        return limits
      }
    })
    await expect(racing.editLastMessageAndRestart(f.editInput())).rejects.toThrow(
      'conversation changed'
    )
    expect(
      f.database.immediate((db) =>
        db.prepare('SELECT COUNT(*) FROM agent_message_replacements').pluck().get()
      )
    ).toBe(0)
    f.database.close()
  })

  it('discards summaries containing the replaced turn and retains an earlier valid checkpoint', async () => {
    const f = await fixture()
    await f.finish(await f.send('First'), 'Earlier answer')
    const firstThrough = f.editInput().expectedThroughSequence
    const summary = (text: string, through: number) =>
      f.event('compaction_summary', {
        summary: text,
        coveredThroughSequence: through,
        timestamp: Date.now(),
        estimatedInputTokens: 10
      })
    const older = summary('Earlier valid memory', firstThrough)
    await f.finish(await f.send('Replace me'), 'Obsolete answer')
    summary('Obsolete summary', f.editInput().expectedThroughSequence)
    const next = await f.service.editLastMessageAndRestart(f.editInput())
    expect(latestSuccessfulCheckpoint(f.database, f.agentSessionId)?.eventId).toBe(older)
    expect(JSON.stringify(f.runtime.active().input.history)).not.toContain('Obsolete')
    await f.finish(next)
    f.database.close()
  })

  it('omits a tool fact whose result was replaced at a steering boundary', async () => {
    const f = await fixture()
    const run = await f.send('Earlier turn')
    const toolCallId = randomUUID()
    f.event(
      'tool_call',
      {
        toolCallId,
        toolName: 'search_knowledge',
        args: {},
        timestamp: Date.now()
      },
      run.agentRunId
    )
    f.event(
      'user_message',
      { content: 'Old steering', delivery: 'steer', timestamp: Date.now() },
      run.agentRunId
    )
    f.event(
      'tool_result',
      {
        toolCallId,
        toolName: 'search_knowledge',
        isError: false,
        result: {},
        timestamp: Date.now()
      },
      run.agentRunId
    )
    await f.finish(run)
    const next = await f.service.editLastMessageAndRestart(f.editInput('New steering'))
    await f.finish(next)
    const material = buildNextCompactionMaterial({
      database: f.database,
      agentSessionId: f.agentSessionId
    })
    expect(material?.sourcePayloadJson).toContain('Earlier turn')
    expect(material?.sourcePayloadJson).toContain('New steering')
    expect(material?.sourcePayloadJson).not.toContain('Old steering')
    expect(material?.sourcePayloadJson).not.toContain('search_knowledge')
    f.database.close()
  })

  it('rolls back replacement and proposal invalidation when the new message cannot commit', async () => {
    const f = await fixture()
    const run = await f.send('Original')
    const id = f.proposal(run.agentRunId)
    await f.finish(run)
    const before = f.service.listEvents(f.agentSessionId)
    f.database.immediate((db) =>
      db.exec(
        "CREATE TRIGGER fail_edit BEFORE INSERT ON agent_events WHEN NEW.type = 'user_message' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END"
      )
    )
    await expect(f.service.editLastMessageAndRestart(f.editInput())).rejects.toThrow(
      'fixture failure'
    )
    expect(f.service.listEvents(f.agentSessionId)).toEqual(before)
    expect(
      f.database.immediate((db) =>
        db
          .prepare('SELECT status FROM mutation_proposals WHERE mutation_proposal_id = ?')
          .pluck()
          .get(id)
      )
    ).toBe('pending')
    f.database.close()
  })
})
