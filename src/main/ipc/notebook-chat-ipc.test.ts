import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import { registerNotebookChatIpc } from './notebook-chat-ipc'

const projectSessionId = '019d0000-0000-7000-8000-000000000420'
const snapshot = {
  projectSessionId,
  revision: 0,
  phase: 'idle',
  activeTurnId: null,
  sourceScope: { mode: 'all', knowledgeItemIds: [] },
  sourceReadiness: 'ready',
  availableKnowledgeItemIds: [],
  modelSelection: null,
  contextEpoch: 0,
  messages: [],
  lastError: null
} as const

describe('Notebook chat IPC', () => {
  it('authorizes, validates, subscribes, and routes commands to the active project session', async () => {
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
      setModel: vi.fn(async () => snapshot)
    }
    const manager = {
      assertActiveSession: vi.fn((sessionId: string) => {
        if (sessionId !== projectSessionId) throw new Error('stale project session')
        return { knowledgeChat: service }
      })
    }
    const broker = {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      revokeSession: vi.fn(),
      clear: vi.fn()
    }
    const registration = registerNotebookChatIpc({
      manager: manager as never,
      broker: broker as never,
      logger: { info: vi.fn(), error: vi.fn() },
      developmentUrl: 'http://localhost:5173',
      ipc: {
        handle: (channel, handler) => handlers.set(channel, handler as never),
        removeHandler: vi.fn()
      }
    })
    const sender = { id: 7, isDestroyed: () => false, send: vi.fn() }
    const trusted = {
      senderFrame: { url: 'http://localhost:5173/' },
      sender
    } as unknown as IpcMainInvokeEvent
    const invoke = (channel: string, input: unknown) =>
      handlers.get(channel)?.(trusted as never, input as never)

    await expect(invoke(IPC_CHANNELS.notebookChatSubscribe, { projectSessionId })).resolves.toEqual(
      { snapshot }
    )
    expect(broker.subscribe).toHaveBeenCalledWith(sender, projectSessionId)
    await expect(
      invoke(IPC_CHANNELS.notebookChatStartTurn, { projectSessionId, content: 'Question' })
    ).resolves.toMatchObject({ snapshot })
    expect(service.startTurn).toHaveBeenCalledWith('Question')
    await expect(
      invoke(IPC_CHANNELS.notebookChatSetSources, {
        projectSessionId,
        sourceScope: { mode: 'selected', knowledgeItemIds: [] }
      })
    ).resolves.toEqual(snapshot)

    const untrusted = {
      senderFrame: { url: 'https://attacker.invalid/' },
      sender
    } as unknown as IpcMainInvokeEvent
    expect(() =>
      handlers.get(IPC_CHANNELS.notebookChatSnapshot)?.(
        untrusted as never,
        { projectSessionId } as never
      )
    ).toThrow('Unauthorized IPC sender')
    expect(() =>
      invoke(IPC_CHANNELS.notebookChatStartTurn, {
        projectSessionId,
        content: 'x'.repeat(20_000)
      })
    ).toThrow()
    registration.revokeSession(projectSessionId)
    expect(broker.revokeSession).toHaveBeenCalledWith(projectSessionId)
  })
})
