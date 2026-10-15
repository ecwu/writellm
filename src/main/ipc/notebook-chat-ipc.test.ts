import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { NotebookChatSnapshot } from '../../shared/contracts/notebook'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import { KnowledgeChatEventBroker } from '../knowledge/knowledge-chat-event-broker'
import { withIpcLogging } from '../observability/ipc-context'
import { registerNotebookChatIpc } from './notebook-chat-ipc'

const notebookId = '019d0000-0000-7000-8000-000000000499'
const projectSessionId = '019d0000-0000-7000-8000-000000000420'
const snapshot: NotebookChatSnapshot = {
  projectSessionId,
  notebookId,
  revision: 0,
  phase: 'idle',
  activeTurnId: null,
  sourceScope: { mode: 'all', knowledgeItemIds: [] },
  sourceReadiness: 'ready',
  availableKnowledgeItemIds: [],
  modelSelection: null,
  thinkingLevel: 'off',
  contextEpoch: 0,
  messages: [],
  lastError: null
}

function harness() {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const service = {
    snapshot: vi.fn(async () => snapshot),
    startTurn: vi.fn(async () => ({
      turnId: '019d0000-0000-7000-8000-000000000421',
      snapshot
    })),
    stopTurn: vi.fn(async () => snapshot),
    clear: vi.fn(async () => snapshot),
    setSources: vi.fn(async () => snapshot),
    setModel: vi.fn(async () => snapshot),
    setThinkingLevel: vi.fn(async () => snapshot)
  }
  const registry = {
    instance: vi.fn((id: string) => {
      if (id !== notebookId) throw new Error('Notebook is closed or unavailable')
      return service
    }),
    createInstance: vi.fn(() => ({ ...service, notebookId })),
    destroyInstance: vi.fn(async (_id: string) => undefined)
  }
  let revoked = false
  const manager = {
    assertActiveSession: vi.fn((sessionId: string) => {
      if (revoked || sessionId !== projectSessionId) throw new Error('stale project session')
      return { knowledgeChat: registry }
    })
  }
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const broker = new KnowledgeChatEventBroker(logger)
  vi.spyOn(broker, 'subscribe')
  vi.spyOn(broker, 'unsubscribe')
  vi.spyOn(broker, 'revokeSession')
  const ipc = withIpcLogging(
    {
      handle: (channel: string, handler: (...args: never[]) => unknown) => {
        handlers.set(channel, handler)
      },
      removeHandler: vi.fn()
    },
    logger
  )
  const registration = registerNotebookChatIpc({
    manager: manager as never,
    broker: broker as never,
    logger,
    developmentUrl: 'http://localhost:5173',
    ipc: ipc as never
  })
  const sender = { id: 7, isDestroyed: () => false, send: vi.fn() }
  const trusted = {
    senderFrame: { url: 'http://localhost:5173/' },
    sender
  } as unknown as IpcMainInvokeEvent
  const invoke = (channel: string, input: unknown) =>
    handlers.get(channel)?.(trusted as never, input as never)

  return {
    handlers,
    service,
    registry,
    manager,
    broker,
    logger,
    registration,
    sender,
    trusted,
    invoke,
    revoke: () => {
      revoked = true
    }
  }
}

describe('Notebook chat IPC', () => {
  it('authorizes, validates, subscribes, and routes commands to the active project session', async () => {
    const { handlers, service, broker, registration, sender, invoke } = harness()
    await expect(
      invoke(IPC_CHANNELS.notebookChatSubscribe, { projectSessionId, notebookId })
    ).resolves.toEqual({ snapshot })
    expect(broker.subscribe).toHaveBeenCalledWith(sender, projectSessionId, notebookId)
    await expect(
      invoke(IPC_CHANNELS.notebookChatStartTurn, {
        projectSessionId,
        notebookId,
        content: 'Question'
      })
    ).resolves.toMatchObject({ snapshot })
    expect(service.startTurn).toHaveBeenCalledWith('Question')
    await expect(
      invoke(IPC_CHANNELS.notebookChatSetSources, {
        projectSessionId,
        notebookId,
        sourceScope: { mode: 'selected', knowledgeItemIds: [] }
      })
    ).resolves.toEqual(snapshot)
    await expect(
      invoke(IPC_CHANNELS.notebookChatSetThinkingLevel, {
        projectSessionId,
        notebookId,
        level: 'high'
      })
    ).resolves.toEqual(snapshot)
    expect(service.setThinkingLevel).toHaveBeenCalledWith('high')

    const untrusted = {
      senderFrame: { url: 'https://attacker.invalid/' },
      sender
    } as unknown as IpcMainInvokeEvent
    expect(() =>
      handlers.get(IPC_CHANNELS.notebookChatSnapshot)?.(
        untrusted as never,
        { projectSessionId, notebookId } as never
      )
    ).toThrow('Unauthorized IPC sender')
    expect(() =>
      invoke(IPC_CHANNELS.notebookChatStartTurn, {
        projectSessionId,
        notebookId,
        content: 'x'.repeat(20_000)
      })
    ).toThrow()
    registration.revokeSession(projectSessionId)
    expect(broker.revokeSession).toHaveBeenCalledWith(projectSessionId)
  })
})

const scope = { projectSessionId, notebookId }
const requests = [
  [IPC_CHANNELS.notebookCreate, { projectSessionId }],
  [IPC_CHANNELS.notebookDestroy, scope],
  [IPC_CHANNELS.notebookChatSnapshot, scope],
  [IPC_CHANNELS.notebookChatStartTurn, { ...scope, content: 'Question' }],
  [IPC_CHANNELS.notebookChatStopTurn, scope],
  [IPC_CHANNELS.notebookChatClear, scope],
  [
    IPC_CHANNELS.notebookChatSetSources,
    { ...scope, sourceScope: { mode: 'all', knowledgeItemIds: [] } }
  ],
  [
    IPC_CHANNELS.notebookChatSetModel,
    { ...scope, modelSelection: { presetId: 'builtin:openai', modelId: 'model' } }
  ],
  [IPC_CHANNELS.notebookChatSetThinkingLevel, { ...scope, level: 'off' }],
  [IPC_CHANNELS.notebookChatSubscribe, scope]
] as const

it.each(requests)(
  'rejects revoked project capabilities on %s without invoking Notebook services',
  async (channel, input) => {
    const fixture = harness()
    fixture.revoke()
    await expect(fixture.invoke(channel, input)).rejects.toMatchObject({
      cause: { message: 'stale project session' }
    })
    expect(fixture.service.snapshot).not.toHaveBeenCalled()
    expect(fixture.service.startTurn).not.toHaveBeenCalled()
    expect(fixture.registry.instance).not.toHaveBeenCalled()
    expect(fixture.registry.createInstance).not.toHaveBeenCalled()
    expect(fixture.registry.destroyInstance).not.toHaveBeenCalled()
    expect(fixture.logger.error).toHaveBeenCalledOnce()
    if (channel === IPC_CHANNELS.notebookChatSubscribe)
      expect(fixture.broker.unsubscribe).toHaveBeenCalledWith(
        fixture.sender.id,
        projectSessionId,
        notebookId
      )
  }
)

it('rejects a closed Notebook and rolls back a failed subscription without delivering later events', async () => {
  const fixture = harness()
  const closedId = '019d0000-0000-7000-8000-000000000999'
  await expect(
    fixture.invoke(IPC_CHANNELS.notebookChatSnapshot, { ...scope, notebookId: closedId })
  ).rejects.toMatchObject({
    message: 'Notebook is closed or unavailable',
    cause: { message: 'Notebook is closed or unavailable' }
  })
  fixture.logger.error.mockClear()
  const failure = new Error('Snapshot unavailable')
  fixture.service.snapshot.mockRejectedValueOnce(failure)
  await expect(fixture.invoke(IPC_CHANNELS.notebookChatSubscribe, scope)).rejects.toMatchObject({
    message: 'Notebook could not connect',
    cause: failure
  })
  fixture.broker.publish({ kind: 'snapshot', ...scope, revision: 0, snapshot })
  expect(fixture.sender.send).not.toHaveBeenCalled()
  expect(fixture.logger.error).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ event: 'knowledge.notebook.subscribe.failed', err: failure }),
    expect.any(String)
  )
})

it('destroys a newly created instance if its initial snapshot fails and reports the failure once', async () => {
  const fixture = harness()
  const failure = new Error('Snapshot unavailable')
  fixture.service.snapshot.mockRejectedValueOnce(failure)
  await expect(
    fixture.invoke(IPC_CHANNELS.notebookCreate, { projectSessionId })
  ).rejects.toMatchObject({ message: 'Notebook operation failed', cause: failure })
  expect(fixture.registry.destroyInstance).toHaveBeenCalledExactlyOnceWith(notebookId)
  expect(fixture.logger.error).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ event: 'knowledge.notebook.create_snapshot.failed', err: failure }),
    expect.any(String)
  )
})

it.each([
  ['Notebook is already running', 'Notebook is already running'],
  ['A Notebook requires sources', 'A Notebook requires sources'],
  ['Select a source', 'Select a source'],
  ['Only currently indexed sources are available', 'Only currently indexed sources are available'],
  ['Stop the active turn first', 'Stop the active turn first'],
  ['Configure and select an Agent model', 'Configure and select an Agent model'],
  ['Up to 10 Notebooks may be open', 'Up to 10 Notebooks may be open'],
  ['Private provider failure', 'Notebook operation failed']
])(
  'reports a failed command once and projects the allowed message for %s',
  async (message, safeMessage) => {
    const fixture = harness()
    const failure = new Error(message)
    fixture.service.startTurn.mockRejectedValueOnce(failure)
    await expect(
      fixture.invoke(IPC_CHANNELS.notebookChatStartTurn, { ...scope, content: 'Question' })
    ).rejects.toMatchObject({ message: safeMessage, cause: failure })
    expect(fixture.logger.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ event: 'knowledge.notebook.start_turn.failed', err: failure }),
      expect.any(String)
    )
  }
)

it('uses the safe generic message for a non-Error failure and bounds allowed messages', async () => {
  const fixture = harness()
  fixture.service.startTurn.mockRejectedValueOnce({ privateData: 'secret' })
  await expect(
    fixture.invoke(IPC_CHANNELS.notebookChatStartTurn, { ...scope, content: 'Question' })
  ).rejects.toMatchObject({
    message: 'Notebook operation failed',
    cause: { privateData: 'secret' }
  })
  fixture.service.startTurn.mockRejectedValueOnce(new Error(`Notebook ${'x'.repeat(2_000)}`))
  await expect(
    fixture.invoke(IPC_CHANNELS.notebookChatStartTurn, { ...scope, content: 'Question' })
  ).rejects.toHaveProperty('message', `Notebook ${'x'.repeat(991)}`)
})

it('creates and destroys Notebooks and stops event delivery after instance or project revocation', async () => {
  const fixture = harness()
  await expect(fixture.invoke(IPC_CHANNELS.notebookCreate, { projectSessionId })).resolves.toEqual(
    snapshot
  )
  await fixture.invoke(IPC_CHANNELS.notebookChatSubscribe, scope)
  const event = { kind: 'snapshot' as const, ...scope, revision: 0, snapshot }
  fixture.broker.publish(event)
  expect(fixture.sender.send).toHaveBeenCalledOnce()
  await fixture.invoke(IPC_CHANNELS.notebookDestroy, scope)
  fixture.broker.publish(event)
  expect(fixture.sender.send).toHaveBeenCalledOnce()
  await fixture.invoke(IPC_CHANNELS.notebookChatSubscribe, scope)
  fixture.registration.revokeSession(projectSessionId)
  fixture.broker.publish(event)
  expect(fixture.sender.send).toHaveBeenCalledOnce()
  await fixture.invoke(IPC_CHANNELS.notebookChatSubscribe, scope)
  fixture.registration.unregister()
  fixture.broker.publish(event)
  expect(fixture.sender.send).toHaveBeenCalledOnce()
})
