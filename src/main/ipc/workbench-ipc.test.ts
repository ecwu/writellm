import { describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { registerWorkbenchIpc } from './workbench-ipc'
import { IPC_CHANNELS } from '../../shared/contracts/channels'

const projectSessionId = '11111111-1111-4111-8111-111111111111'
const closingToken = '22222222-2222-4222-8222-222222222222'
const layout = { version: 1, tabs: [{ kind: 'knowledge' }], activeTabId: 'knowledge', tools: null }

describe('workbench layout IPC', () => {
  it('requires the active session or sender-bound final-flush capability and rejects private state', async () => {
    const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
    let closing = false
    const write = vi.fn(async () => undefined)
    const registration = registerWorkbenchIpc({
      manager: {
        assertActiveSession: (session) => {
          if (closing || session !== projectSessionId) throw new Error('revoked')
          return { manifest: { projectId: 'project-1' } } as never
        }
      },
      authorizeLayoutFlush: (session, token, sender) => {
        if (session !== projectSessionId || token !== closingToken || sender !== 7)
          throw new Error('unauthorized')
        return 'project-1'
      },
      settings: { getWorkbenchLayout: async () => layout, setWorkbenchLayout: write } as never,
      log: { info: vi.fn(), error: vi.fn() },
      developmentUrl: 'http://localhost:5173',
      ipc: {
        handle: (channel, handler) => {
          handlers.set(channel, handler)
        },
        removeHandler: vi.fn()
      }
    })
    const event = {
      sender: { id: 7 },
      senderFrame: { url: 'http://localhost:5173/' }
    } as IpcMainInvokeEvent
    const save = (input: unknown, sender = event) =>
      handlers.get(IPC_CHANNELS.workbenchLayoutSave)?.(sender, input)
    await expect(save({ projectSessionId, layout })).resolves.toBeUndefined()
    closing = true
    await expect(save({ projectSessionId, layout })).rejects.toThrow('revoked')
    await expect(save({ projectSessionId, closingToken, layout })).resolves.toBeUndefined()
    await expect(
      save({ projectSessionId, closingToken, layout }, {
        ...event,
        sender: { id: 8 }
      } as IpcMainInvokeEvent)
    ).rejects.toThrow('unauthorized')
    await expect(
      save({
        projectSessionId,
        closingToken,
        layout: { ...layout, tabs: [{ kind: 'notebook', notebookId: closingToken }] }
      })
    ).rejects.toThrow()
    await expect(
      save({ projectSessionId, closingToken, layout: { ...layout, path: '/private/project' } })
    ).rejects.toThrow()
    expect(write).toHaveBeenCalledTimes(2)
    closing = false
    await handlers.get(IPC_CHANNELS.workbenchLayoutReset)?.(event, { projectSessionId })
    expect(write).toHaveBeenLastCalledWith('project-1', { ...layout, tools: null })
    registration.unregister()
  })
})
