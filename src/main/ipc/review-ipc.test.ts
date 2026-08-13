import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import { registerReviewIpc } from './review-ipc'

const projectSessionId = '019d0000-0000-7000-8000-000000000301'

describe('Review fixture IPC', () => {
  it('authorizes the renderer, validates filters, and rechecks the project capability', () => {
    const handlers = new Map<string, (...args: never[]) => unknown>()
    const ipc = {
      handle: vi.fn((channel: string, handler: (...args: never[]) => unknown) => {
        handlers.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const list = vi.fn(() => ({ issues: [], nextCursor: null, total: 0 }))
    const manager = {
      assertActiveSession: vi.fn((sessionId: string) => {
        if (sessionId !== projectSessionId) throw new Error('Stale project capability')
        return { reviewIssues: { list, events: vi.fn(), updateByUser: vi.fn() } }
      }),
      assertMutationSession: vi.fn()
    }
    registerReviewIpc({
      manager: manager as never,
      logger: { info: vi.fn(), error: vi.fn() },
      developmentUrl: 'http://localhost:5173',
      ipc
    })
    const handler = handlers.get(IPC_CHANNELS.reviewListIssues)
    if (handler === undefined) throw new Error('Missing review list handler')
    const trusted = {
      senderFrame: { url: 'http://localhost:5173/' }
    } as unknown as IpcMainInvokeEvent
    expect(
      handler(
        trusted as never,
        {
          projectSessionId,
          statuses: ['open'],
          priorities: ['P1'],
          categories: [],
          limit: 25
        } as never
      )
    ).toEqual({ issues: [], nextCursor: null, total: 0 })
    expect(list).toHaveBeenCalledWith({
      statuses: ['open'],
      priorities: ['P1'],
      categories: [],
      limit: 25
    })

    const untrusted = {
      senderFrame: { url: 'https://attacker.invalid/' }
    } as unknown as IpcMainInvokeEvent
    expect(() => handler(untrusted as never, { projectSessionId, limit: 25 } as never)).toThrow(
      'Unauthorized IPC sender'
    )
    expect(() =>
      handler(trusted as never, { projectSessionId: crypto.randomUUID(), limit: 25 } as never)
    ).toThrow('Stale project capability')
  })
})
