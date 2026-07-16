import type { IpcMainInvokeEvent } from 'electron'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import { ManuscriptDomainError } from '../../shared/contracts/manuscript'
import { registerEditorIpc, type EditorIpcMain } from './editor-ipc'

const projectSessionId = '11111111-1111-4111-8111-111111111111'

function harness() {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const ipc: EditorIpcMain = {
    handle: vi.fn((channel, handler) => handlers.set(channel, handler as never)),
    removeHandler: vi.fn()
  }
  const sections = [
    { sectionId: 'section-1', currentRevisionId: 'revision-1' },
    { sectionId: 'section-2', currentRevisionId: 'revision-2' }
  ]
  const editorPersistence = {
    openEditor: vi.fn(),
    loadSection: vi.fn((sectionId: string) => ({
      section: {
        sectionId,
        manuscriptId: 'manuscript-1',
        parentSectionId: null,
        position: sectionId === 'section-1' ? 0 : 1,
        level: 1,
        title: sectionId,
        objective: null,
        status: 'drafting',
        currentRevisionId: sectionId === 'section-1' ? 'revision-1' : 'revision-2',
        createdAt: '2026-07-16T00:00:00.000Z',
        updatedAt: '2026-07-16T00:00:00.000Z'
      },
      revision: {
        sectionRevisionId: sectionId === 'section-1' ? 'revision-1' : 'revision-2',
        sectionId,
        revisionNumber: 1,
        source: 'manual',
        content: [],
        contentSchemaVersion: 1,
        contentHash: 'a'.repeat(64),
        priorRevisionId: null,
        wordCount: 0,
        characterCount: 0,
        countAlgorithmVersion: 1,
        agentRunId: null,
        agentToolCallId: null,
        agentProposalId: null,
        createdAt: '2026-07-16T00:00:00.000Z'
      }
    })),
    save: vi.fn()
  }
  const context = {
    projectSessionId,
    editorPersistence,
    manuscript: {
      listSections: vi.fn(() => sections),
      getSection: vi.fn((sectionId: string) =>
        sections.find((section) => section.sectionId === sectionId)
      )
    }
  }
  const manager = {
    assertActiveSession: vi.fn((value: string) => {
      if (value !== projectSessionId) throw new Error('stale')
      return context
    }),
    authorizeFinalFlush: vi.fn(() => context)
  }
  const registration = registerEditorIpc({
    manager: manager as never,
    logger: pino({ level: 'silent' }),
    developmentUrl: 'http://localhost:5173',
    ipc
  })
  const sender = { id: 7, send: vi.fn(), isDestroyed: vi.fn(() => false) }
  const event = {
    sender,
    senderFrame: { url: 'http://localhost:5173/' }
  } as unknown as IpcMainInvokeEvent
  const invoke = (channel: string, input: unknown) =>
    handlers.get(channel)?.(event as never, input as never)
  return { context, editorPersistence, invoke, registration, sections, sender }
}

describe('editor IPC active-section final flush', () => {
  it('tracks and verifies the active non-first section revision', async () => {
    const { context, invoke, registration, sender } = harness()
    invoke(IPC_CHANNELS.editorLoadSection, { projectSessionId, sectionId: 'section-2' })
    invoke(IPC_CHANNELS.editorSubscribeFlush, {
      projectSessionId,
      subscriptionId: '33333333-3333-4333-8333-333333333333'
    })
    const authorization = {
      projectSessionId,
      currentRevision: 'revision-2',
      closingToken: '22222222-2222-4222-8222-222222222222'
    }

    await expect(registration.closeParticipants.getCurrentRevision(context as never)).resolves.toBe(
      'revision-2'
    )
    const flush = registration.closeParticipants.flushEditors(context as never, authorization)
    expect(sender.send).toHaveBeenCalledWith(
      IPC_CHANNELS.editorFlushRequest,
      expect.objectContaining({ closingToken: authorization.closingToken })
    )
    invoke(IPC_CHANNELS.editorFlushAck, {
      projectSessionId,
      closingToken: authorization.closingToken,
      sectionId: 'section-2',
      sectionRevisionId: 'revision-2'
    })
    await flush
    await expect(
      registration.closeParticipants.verifyFinalEditorFlush(context as never, authorization)
    ).resolves.toBeUndefined()
  })

  it('tracks an explicitly activated cached section without loading it again', async () => {
    const { context, editorPersistence, invoke, registration } = harness()
    invoke(IPC_CHANNELS.editorSetActiveSection, { projectSessionId, sectionId: 'section-2' })
    await expect(registration.closeParticipants.getCurrentRevision(context as never)).resolves.toBe(
      'revision-2'
    )
    expect(editorPersistence.loadSection).not.toHaveBeenCalled()
  })

  it('does not let an old subscription release remove a newer flush lease', async () => {
    const { context, invoke, registration, sender } = harness()
    invoke(IPC_CHANNELS.editorSetActiveSection, { projectSessionId, sectionId: 'section-2' })
    invoke(IPC_CHANNELS.editorSubscribeFlush, {
      projectSessionId,
      subscriptionId: '33333333-3333-4333-8333-333333333333'
    })
    invoke(IPC_CHANNELS.editorSubscribeFlush, {
      projectSessionId,
      subscriptionId: '44444444-4444-4444-8444-444444444444'
    })
    invoke(IPC_CHANNELS.editorUnsubscribeFlush, {
      projectSessionId,
      subscriptionId: '33333333-3333-4333-8333-333333333333'
    })
    const authorization = {
      projectSessionId,
      currentRevision: 'revision-2',
      closingToken: '55555555-5555-4555-8555-555555555555'
    }

    const flush = registration.closeParticipants.flushEditors(context as never, authorization)
    expect(sender.send).toHaveBeenCalledOnce()
    invoke(IPC_CHANNELS.editorFlushAck, {
      projectSessionId,
      closingToken: authorization.closingToken,
      sectionId: 'section-2',
      sectionRevisionId: 'revision-2'
    })
    await flush
  })

  it('refuses to close an active editor when its final-flush subscriber is missing', async () => {
    const { context, invoke, registration } = harness()
    invoke(IPC_CHANNELS.editorSetActiveSection, { projectSessionId, sectionId: 'section-2' })
    await expect(
      registration.closeParticipants.flushEditors(context as never, {
        projectSessionId,
        currentRevision: 'revision-2',
        closingToken: '66666666-6666-4666-8666-666666666666'
      })
    ).rejects.toThrow('final-flush subscriber is unavailable')
  })

  it('falls back safely when the previously active section was deleted', async () => {
    const { context, invoke, registration, sections } = harness()
    invoke(IPC_CHANNELS.editorLoadSection, { projectSessionId, sectionId: 'section-2' })
    sections.pop()
    await expect(registration.closeParticipants.getCurrentRevision(context as never)).resolves.toBe(
      'revision-1'
    )
  })

  it('returns a typed revision conflict instead of relying on serialized Error properties', async () => {
    const { editorPersistence, invoke } = harness()
    editorPersistence.save.mockRejectedValueOnce(
      new ManuscriptDomainError('section_revision_conflict', 'The section body has changed')
    )
    await expect(
      invoke(IPC_CHANNELS.editorSaveSectionDocument, {
        projectSessionId,
        sectionId: 'section-1',
        baseRevisionId: 'revision-1',
        baseContentHash: 'a'.repeat(64),
        document: []
      })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'section_revision_conflict',
        message: 'The section body has changed'
      }
    })
  })
})
