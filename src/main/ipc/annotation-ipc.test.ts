import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import { registerAnnotationIpc } from './annotation-ipc'

const projectSessionId = '019d0000-0000-7000-8000-000000000310'
const annotationId = '019d0000-0000-7000-8000-000000000311'

describe('Annotation IPC', () => {
  it('authorizes sender and session capabilities and validates bounded list/create/update input', () => {
    const handlers = new Map<string, (...args: never[]) => unknown>()
    const ipc = {
      handle: vi.fn((channel: string, handler: (...args: never[]) => unknown) => {
        handlers.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const record = {
      annotationId,
      kind: 'todo',
      status: 'open',
      body: 'Verify evidence',
      sectionId: '019d0000-0000-7000-8000-000000000312',
      blockId: 'block-1',
      anchorRevisionId: '019d0000-0000-7000-8000-000000000313',
      textAnchor: null,
      textAnchorFingerprint: null,
      anchorStatus: 'current',
      version: 1,
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
      resolvedAt: null
    } as const
    const annotations = {
      list: vi.fn(() => ({ annotations: [record], nextCursor: null, total: 1 })),
      create: vi.fn(() => record),
      update: vi.fn(() => ({
        ...record,
        status: 'resolved',
        version: 2,
        resolvedAt: record.updatedAt
      }))
    }
    const manager = {
      assertActiveSession: vi.fn((sessionId: string) => {
        if (sessionId !== projectSessionId) throw new Error('Stale project capability')
        return { annotations }
      }),
      assertMutationSession: vi.fn((sessionId: string) => {
        if (sessionId !== projectSessionId) throw new Error('Stale project capability')
        return { annotations }
      })
    }
    registerAnnotationIpc({
      manager: manager as never,
      logger: { info: vi.fn(), error: vi.fn() },
      developmentUrl: 'http://localhost:5173',
      ipc
    })
    const trusted = { senderFrame: { url: 'http://localhost:5173/' } } as IpcMainInvokeEvent
    const list = handlers.get(IPC_CHANNELS.annotationsList)
    const create = handlers.get(IPC_CHANNELS.annotationsCreate)
    const update = handlers.get(IPC_CHANNELS.annotationsUpdate)
    if (list === undefined || create === undefined || update === undefined) {
      throw new Error('Missing annotation IPC handlers')
    }
    expect(
      list(
        trusted as never,
        { projectSessionId, statuses: ['open'], kinds: [], limit: 25 } as never
      )
    ).toMatchObject({ total: 1 })
    expect(annotations.list).toHaveBeenCalledWith({ statuses: ['open'], kinds: [], limit: 25 })
    expect(
      create(
        trusted as never,
        {
          projectSessionId,
          kind: 'todo',
          body: 'Verify evidence',
          sectionId: record.sectionId,
          blockId: record.blockId
        } as never
      )
    ).toMatchObject({ annotationId })
    expect(
      update(
        trusted as never,
        {
          projectSessionId,
          operation: { action: 'resolve', annotationId, expectedVersion: 1 }
        } as never
      )
    ).toMatchObject({ status: 'resolved' })

    const untrusted = { senderFrame: { url: 'https://attacker.invalid/' } } as IpcMainInvokeEvent
    expect(() => list(untrusted as never, { projectSessionId, limit: 25 } as never)).toThrow(
      'Unauthorized IPC sender'
    )
    expect(() =>
      list(trusted as never, { projectSessionId: crypto.randomUUID(), limit: 25 } as never)
    ).toThrow('Stale project capability')
  })
})
