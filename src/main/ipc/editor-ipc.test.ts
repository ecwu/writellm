import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import { ManuscriptDomainError } from '../../shared/contracts/manuscript'
import { registerEditorIpc, type EditorIpcMain } from './editor-ipc'

const projectSessionId = '11111111-1111-4111-8111-111111111111'
const snapshotClosingToken = '99999999-9999-4999-8999-999999999999'

function harness(options: { snapshotFlushTimeoutMs?: number } = {}) {
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
    assertMutationSession: vi.fn((value: string) => {
      if (value !== projectSessionId) throw new Error('stale')
      return context
    }),
    authorizeFinalFlush: vi.fn(() => context),
    beginSnapshotFlush: vi.fn((value: string) => ({
      projectSessionId: value,
      currentRevision: null,
      closingToken: snapshotClosingToken
    })),
    completeSnapshotFlush: vi.fn()
  }
  const logger = { error: vi.fn() }
  const registration = registerEditorIpc({
    manager: manager as never,
    logger,
    developmentUrl: 'http://localhost:5173',
    ipc,
    snapshotFlushTimeoutMs: options.snapshotFlushTimeoutMs
  })
  const sender = { id: 7, send: vi.fn(), isDestroyed: vi.fn(() => false) }
  const event = {
    sender,
    senderFrame: { url: 'http://localhost:5173/' }
  } as unknown as IpcMainInvokeEvent
  const invoke = (channel: string, input: unknown) =>
    handlers.get(channel)?.(event as never, input as never)
  return { context, editorPersistence, invoke, logger, manager, registration, sections, sender }
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
      expect.objectContaining({
        closingToken: authorization.closingToken,
        sectionId: 'section-2',
        sectionRevisionId: 'revision-2'
      })
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

  it('times out an unacknowledged snapshot flush instead of hanging', async () => {
    const { context, invoke, logger, manager, registration, sender } = harness({
      snapshotFlushTimeoutMs: 10
    })
    invoke(IPC_CHANNELS.editorLoadSection, { projectSessionId, sectionId: 'section-2' })
    invoke(IPC_CHANNELS.editorSubscribeFlush, {
      projectSessionId,
      subscriptionId: '33333333-3333-4333-8333-333333333333'
    })

    await expect(
      registration.snapshotParticipants.finalEditorFlush(context as never)
    ).rejects.toThrow('Snapshot editor flush timed out')

    expect(sender.send).toHaveBeenCalledWith(
      IPC_CHANNELS.editorFlushRequest,
      expect.objectContaining({
        purpose: 'snapshot',
        closingToken: snapshotClosingToken,
        sectionId: 'section-2',
        sectionRevisionId: 'revision-2'
      })
    )
    expect(manager.completeSnapshotFlush).toHaveBeenCalledWith(snapshotClosingToken)
    const logged = logger.error.mock.calls[0]?.[0] as Record<string, unknown>
    expect(logged).toMatchObject({
      event: 'editor.snapshot_flush.timeout',
      projectSessionId,
      closingToken: snapshotClosingToken,
      timeoutMs: 10
    })
    expect(logged.err).toBeInstanceOf(Error)
  })

  it('labels whole-manuscript final flushes as export work', async () => {
    const { context, invoke, manager, registration, sender } = harness()
    invoke(IPC_CHANNELS.editorLoadSection, { projectSessionId, sectionId: 'section-2' })
    invoke(IPC_CHANNELS.editorSubscribeFlush, {
      projectSessionId,
      subscriptionId: '33333333-3333-4333-8333-333333333333'
    })

    const flush = registration.snapshotParticipants.finalEditorFlush(context as never, 'export')
    expect(sender.send).toHaveBeenCalledWith(
      IPC_CHANNELS.editorFlushRequest,
      expect.objectContaining({
        purpose: 'export',
        closingToken: snapshotClosingToken,
        sectionId: 'section-2',
        sectionRevisionId: 'revision-2'
      })
    )
    invoke(IPC_CHANNELS.editorFlushAck, {
      projectSessionId,
      closingToken: snapshotClosingToken,
      purpose: 'export',
      sectionId: 'section-2',
      sectionRevisionId: 'revision-2'
    })
    await flush
    expect(manager.completeSnapshotFlush).toHaveBeenCalledWith(snapshotClosingToken)
  })

  it('logs the original export error while the renderer receives no absolute path', async () => {
    const { editorPersistence, invoke, logger } = harness()
    const absolutePath = '/Users/private/project/manuscript/exports/section-1.blocknote.json'
    const original = new Error(`ENOENT: no such file or directory, open '${absolutePath}'`)
    original.stack = `Error: ENOENT: no such file or directory\n    at save (${absolutePath}:1:1)`

    editorPersistence.loadSection.mockImplementationOnce(() => {
      throw original
    })
    const nativeJsonFailure = await Promise.resolve(
      invoke(IPC_CHANNELS.editorExportNativeJson, {
        projectSessionId,
        sectionId: 'section-1'
      })
    ).catch((err: unknown) => err)
    expect(nativeJsonFailure).toBeInstanceOf(Error)
    expect((nativeJsonFailure as Error).message).toBe('Native JSON export could not be completed')
    expect((nativeJsonFailure as Error).message).not.toContain('/Users/private')
    const nativeJsonLog = logger.error.mock.calls[0]?.[0] as Record<string, unknown>
    expect(nativeJsonLog.event).toBe('editor.export_native_json.failed')
    expect(nativeJsonLog.err).toBe(original)

    editorPersistence.loadSection.mockImplementationOnce(() => {
      throw original
    })
    const markdownFailure = await Promise.resolve(
      invoke(IPC_CHANNELS.editorExportMarkdown, {
        projectSessionId,
        sectionId: 'section-1',
        sectionRevisionId: 'revision-1',
        contentHash: 'a'.repeat(64),
        markdown: '# Section'
      })
    ).catch((err: unknown) => err)
    expect(markdownFailure).toBeInstanceOf(Error)
    expect((markdownFailure as Error).message).toBe('Markdown export could not be completed')
    expect((markdownFailure as Error).message).not.toContain('/Users/private')
    const markdownLog = logger.error.mock.calls[1]?.[0] as Record<string, unknown>
    expect(markdownLog.event).toBe('editor.export_markdown.failed')
    expect(markdownLog.err).toBe(original)
  })
})
