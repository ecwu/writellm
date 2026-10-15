import { agentDiagnosticForLogging } from '../../shared/agent-diagnostic-error'
import { expect, it, vi } from 'vitest'
import { AgentSessionQueries } from './session-queries'
import {
  createDatabase,
  createService,
  FakeAgentRuntime,
  log
} from './session-service.test-support'

it('reads populated run history and bounded event pages without opening write transactions', async () => {
  const database = await createDatabase()
  const runtime = new FakeAgentRuntime()
  const service = createService(database, runtime)
  const session = service.createSession('Read history')
  const started = await service.startRun({
    agentSessionId: session.agentSessionId,
    prompt: 'Draft an opening.',
    editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
  })
  runtime.active().resolve()
  await started.completion
  const expectedRuns = service.listRuns(session.agentSessionId)
  const expectedEvents = service.listEvents(session.agentSessionId)
  expect(expectedRuns).toHaveLength(1)
  expect(expectedEvents.length).toBeGreaterThan(0)
  const write = vi.spyOn(database, 'immediate').mockImplementation(() => {
    throw new Error('A history query must not request a write transaction')
  })
  try {
    const queries = new AgentSessionQueries(database, log)
    expect(queries.listRuns(session.agentSessionId)).toEqual(expectedRuns)
    expect(queries.requireRun(started.agentRunId)).toEqual(expectedRuns[0])
    expect(queries.listEvents(session.agentSessionId)).toEqual(expectedEvents)
    const page = queries.listEventPage(session.agentSessionId, 0, 1)
    expect(page.events).toEqual(expectedEvents.slice(0, 1))
    expect(page.hasMore).toBe(expectedEvents.length > 1)
    expect(() => queries.listRuns(crypto.randomUUID())).toThrow('Agent session does not exist')
    expect(() => queries.requireRun(crypto.randomUUID())).toThrow('Agent run does not exist')
    expect(write).not.toHaveBeenCalled()
  } finally {
    write.mockRestore()
    database.close()
  }
})

it('distinguishes missing legacy diagnostics from malformed stored JSON and reports one safe failure', async () => {
  const database = await createDatabase()
  const runtime = new FakeAgentRuntime()
  const service = createService(database, runtime)
  const session = service.createSession('Historical error')
  const started = await service.startRun({
    agentSessionId: session.agentSessionId,
    prompt: 'Draft.',
    editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
  })
  runtime.active().resolve()
  await started.completion
  const warn = vi.fn()
  const queries = new AgentSessionQueries(database, { warn })
  database.immediate((native) =>
    native
      .prepare('UPDATE agent_runs SET error_json = ? WHERE agent_run_id = ?')
      .run(JSON.stringify({ code: 'legacy_failure' }), started.agentRunId)
  )
  expect(queries.requireRun(started.agentRunId)).toMatchObject({
    errorCode: 'legacy_failure',
    errorDetails: null
  })
  expect(warn).not.toHaveBeenCalled()
  database.immediate((native) => {
    native.pragma('ignore_check_constraints = ON')
    native
      .prepare('UPDATE agent_runs SET error_json = ? WHERE agent_run_id = ?')
      .run('Private damaged JSON', started.agentRunId)
    native.pragma('ignore_check_constraints = OFF')
  })
  expect(queries.requireRun(started.agentRunId)).toMatchObject({
    errorCode: 'agent_run_failed',
    errorDetails: null
  })
  expect(warn).toHaveBeenCalledOnce()
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({
      event: 'agent.history.error_record_invalid',
      agentRunId: started.agentRunId,
      err: expect.any(SyntaxError)
    }),
    expect.any(String)
  )
  const error = warn.mock.calls[0]?.[0].err
  expect(JSON.stringify(agentDiagnosticForLogging(error))).not.toContain('Private damaged JSON')
  database.close()
})
