import { expect, it, vi } from 'vitest'
import { AgentSessionQueries } from './session-queries'
import { createDatabase, createService, FakeAgentRuntime } from './session-service.test-support'

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
    const queries = new AgentSessionQueries(database)
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
