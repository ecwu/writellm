import { ipcMain, type IpcMain, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import {
  editorFlushAckInputSchema,
  editorFlushRequestSchema,
  editorFlushSubscriptionInputSchema,
  editorSectionSchema,
  editorSessionInputSchema,
  exportMarkdownInputSchema,
  exportNativeJsonInputSchema,
  exportResultSchema,
  finalFlushSaveInputSchema,
  importMarkdownInputSchema,
  loadSectionInputSchema,
  ManuscriptDomainError,
  openEditorResultSchema,
  saveSectionDocumentInputSchema,
  saveSectionDocumentResponseSchema,
  type saveSectionDocumentResultSchema
} from '../../shared/contracts/manuscript'
import type { ProjectContext } from '../project/project-context'
import type {
  ProjectCloseParticipants,
  ProjectFinalFlushAuthorization,
  ProjectSnapshotParticipants,
  ProjectManager
} from '../project/project-manager'
import { resolveProjectPath } from '../project/project-paths'
import { writeAtomicFile } from '../storage/atomic-file'
import { authorizeSender } from './authorize-sender'

export interface EditorIpcMain extends Pick<IpcMain, 'handle' | 'removeHandler'> {}

interface PendingFlush {
  senderId: number
  authorization: ProjectFinalFlushAuthorization
  resolve: () => void
  reject: (error: Error) => void
  acknowledgedSectionId: string | null
  acknowledgedRevision: string | null
}

export function registerEditorIpc(options: {
  manager: ProjectManager
  logger: Pick<Logger, 'error'>
  developmentUrl?: string
  ipc?: EditorIpcMain
  snapshotFlushTimeoutMs?: number
}): {
  closeParticipants: ProjectCloseParticipants
  snapshotParticipants: Pick<ProjectSnapshotParticipants, 'finalEditorFlush'>
  flushForMutation(projectSessionId: string, affectedSectionIds: readonly string[]): Promise<void>
  revokeSession(sessionId: string): void
  unregister(): void
} {
  const ipc = options.ipc ?? ipcMain
  const snapshotFlushTimeoutMs = options.snapshotFlushTimeoutMs ?? 10_000
  const subscribers = new Map<string, Map<string, WebContents>>()
  const activeSections = new Map<string, string>()
  const pending = new Map<string, PendingFlush>()

  ipc.handle(IPC_CHANNELS.editorOpen, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = editorSessionInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    const result = openEditorResultSchema.parse(context.editorPersistence.openEditor())
    if (result.activeSection !== null) {
      activeSections.set(parsed.projectSessionId, result.activeSection.section.sectionId)
    }
    return result
  })
  ipc.handle(IPC_CHANNELS.editorLoadSection, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = loadSectionInputSchema.parse(input)
    const result = editorSectionSchema.parse(
      options.manager
        .assertActiveSession(parsed.projectSessionId)
        .editorPersistence.loadSection(parsed.sectionId)
    )
    activeSections.set(parsed.projectSessionId, result.section.sectionId)
    return result
  })
  ipc.handle(IPC_CHANNELS.editorSetActiveSection, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = loadSectionInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    context.manuscript.getSection(parsed.sectionId)
    activeSections.set(parsed.projectSessionId, parsed.sectionId)
  })
  ipc.handle(IPC_CHANNELS.editorSaveSectionDocument, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = saveSectionDocumentInputSchema.parse(input)
    const context = options.manager.assertMutationSession(parsed.projectSessionId)
    const result = await saveWithConflictResult(() => context.editorPersistence.save(parsed))
    options.manager.assertActiveSession(parsed.projectSessionId)
    return result
  })
  ipc.handle(IPC_CHANNELS.editorImportMarkdown, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = importMarkdownInputSchema.parse(input)
    const context = options.manager.assertMutationSession(parsed.projectSessionId)
    const result = await saveWithConflictResult(() =>
      context.editorPersistence.save(parsed, 'import')
    )
    options.manager.assertActiveSession(parsed.projectSessionId)
    return result
  })
  ipc.handle(IPC_CHANNELS.editorExportNativeJson, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = exportNativeJsonInputSchema.parse(input)
    try {
      const context = options.manager.assertActiveSession(parsed.projectSessionId)
      const current = editorSectionSchema.parse(
        context.editorPersistence.loadSection(parsed.sectionId)
      )
      const relativePath = `manuscript/exports/${encodeURIComponent(parsed.sectionId)}-${current.revision.sectionRevisionId}.blocknote.json`
      await writeAtomicFile(
        resolveProjectPath(context.projectRoot, relativePath),
        Buffer.from(JSON.stringify(current.revision.content))
      )
      return exportResultSchema.parse({ relativePath })
    } catch (err) {
      options.logger.error(
        {
          event: 'editor.export_native_json.failed',
          err,
          projectSessionId: parsed.projectSessionId
        },
        'Native JSON export failed'
      )
      throw new Error('Native JSON export could not be completed', { cause: err })
    }
  })
  ipc.handle(IPC_CHANNELS.editorExportMarkdown, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = exportMarkdownInputSchema.parse(input)
    try {
      const context = options.manager.assertActiveSession(parsed.projectSessionId)
      const current = context.editorPersistence.loadSection(parsed.sectionId).revision
      if (
        current.sectionRevisionId !== parsed.sectionRevisionId ||
        current.contentHash !== parsed.contentHash
      ) {
        throw new Error('Markdown export source revision is stale')
      }
      const relativePath = `manuscript/exports/${encodeURIComponent(parsed.sectionId)}-${parsed.sectionRevisionId}.md`
      await writeAtomicFile(
        resolveProjectPath(context.projectRoot, relativePath),
        Buffer.from(parsed.markdown)
      )
      return exportResultSchema.parse({ relativePath })
    } catch (err) {
      options.logger.error(
        { event: 'editor.export_markdown.failed', err, projectSessionId: parsed.projectSessionId },
        'Markdown export failed'
      )
      throw new Error('Markdown export could not be completed', { cause: err })
    }
  })
  ipc.handle(IPC_CHANNELS.editorSubscribeFlush, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = editorFlushSubscriptionInputSchema.parse(input)
    options.manager.assertActiveSession(parsed.projectSessionId)
    const leases = subscribers.get(parsed.projectSessionId) ?? new Map<string, WebContents>()
    leases.set(parsed.subscriptionId, event.sender)
    subscribers.set(parsed.projectSessionId, leases)
  })
  ipc.handle(IPC_CHANNELS.editorUnsubscribeFlush, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = editorFlushSubscriptionInputSchema.parse(input)
    const leases = subscribers.get(parsed.projectSessionId)
    if (leases?.get(parsed.subscriptionId)?.id === event.sender.id) {
      leases.delete(parsed.subscriptionId)
      if (leases.size === 0) subscribers.delete(parsed.projectSessionId)
    }
  })
  ipc.handle(IPC_CHANNELS.editorFinalFlushSave, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = finalFlushSaveInputSchema.parse(input)
    const currentPending = pending.get(parsed.closingToken)
    if (currentPending?.senderId !== event.sender.id)
      throw new Error('Final editor flush sender is not authorized')
    const context =
      parsed.purpose === 'mutation'
        ? options.manager.assertMutationSession(parsed.projectSessionId)
        : parsed.purpose === 'snapshot'
          ? options.manager.authorizeSnapshotFlush(parsed.projectSessionId, parsed.closingToken)
          : options.manager.authorizeFinalFlush(parsed.projectSessionId, parsed.closingToken)
    return saveWithConflictResult(() => context.editorPersistence.save(parsed))
  })
  ipc.handle(IPC_CHANNELS.editorFlushAck, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = editorFlushAckInputSchema.parse(input)
    const currentPending = pending.get(parsed.closingToken)
    if (
      currentPending === undefined ||
      currentPending.senderId !== event.sender.id ||
      currentPending.authorization.projectSessionId !== parsed.projectSessionId ||
      currentPending.acknowledgedSectionId !== null ||
      currentPending.acknowledgedRevision !== null
    )
      throw new Error('Editor flush acknowledgment is not authorized')
    currentPending.acknowledgedSectionId = parsed.sectionId
    currentPending.acknowledgedRevision = parsed.sectionRevisionId
    currentPending.resolve()
  })

  const closeParticipants: ProjectCloseParticipants = {
    getCurrentRevision: async (context) => activeRevision(context, activeSections),
    flushEditors: async (context, authorization) => {
      const activeSectionId = resolveActiveSection(context, activeSections)
      const currentRevision =
        activeSectionId === undefined
          ? undefined
          : context.manuscript.getSection(activeSectionId).currentRevisionId
      if (activeSectionId === undefined || currentRevision === undefined) return
      const sender = Array.from(subscribers.get(context.projectSessionId)?.values() ?? []).find(
        (candidate) => !candidate.isDestroyed()
      )
      if (sender === undefined) {
        if (activeSections.has(context.projectSessionId)) {
          throw new Error('Active editor final-flush subscriber is unavailable')
        }
        return
      }
      await new Promise<void>((resolve, reject) => {
        pending.set(authorization.closingToken, {
          senderId: sender.id,
          authorization,
          resolve,
          reject,
          acknowledgedSectionId: null,
          acknowledgedRevision: null
        })
        sender.send(
          IPC_CHANNELS.editorFlushRequest,
          editorFlushRequestSchema.parse({
            projectSessionId: context.projectSessionId,
            closingToken: authorization.closingToken,
            sectionId: activeSectionId,
            sectionRevisionId: currentRevision
          })
        )
      })
    },
    verifyFinalEditorFlush: async (context, authorization) => {
      const request = pending.get(authorization.closingToken)
      pending.delete(authorization.closingToken)
      if (request === undefined) return
      const activeSectionId = resolveActiveSection(context, activeSections)
      const currentRevision =
        activeSectionId === undefined
          ? null
          : context.manuscript.getSection(activeSectionId).currentRevisionId
      if (
        request.acknowledgedSectionId !== (activeSectionId ?? null) ||
        request.acknowledgedRevision !== currentRevision
      ) {
        throw new Error('Final editor flush revision was not acknowledged')
      }
    },
    stopJobClaims: async () => undefined,
    parkWorkers: async () => undefined,
    stopWorkersAndIndex: async () => undefined,
    revokeSubscriptions: async (sessionId) => {
      subscribers.delete(sessionId)
      activeSections.delete(sessionId)
    }
  }

  const snapshotParticipants: Pick<ProjectSnapshotParticipants, 'finalEditorFlush'> = {
    finalEditorFlush: async (context) => {
      const authorization = options.manager.beginSnapshotFlush(context.projectSessionId)
      const activeSectionId = resolveActiveSection(context, activeSections)
      const currentRevision =
        activeSectionId === undefined
          ? undefined
          : context.manuscript.getSection(activeSectionId).currentRevisionId
      const sender = Array.from(subscribers.get(context.projectSessionId)?.values() ?? []).find(
        (candidate) => !candidate.isDestroyed()
      )
      if (activeSectionId === undefined || currentRevision === undefined || sender === undefined) {
        options.manager.completeSnapshotFlush(authorization.closingToken)
        return
      }
      try {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await new Promise<void>((resolve, reject) => {
            pending.set(authorization.closingToken, {
              senderId: sender.id,
              authorization: { ...authorization, currentRevision },
              resolve,
              reject,
              acknowledgedSectionId: null,
              acknowledgedRevision: null
            })
            timer = setTimeout(() => {
              pending.delete(authorization.closingToken)
              const err = new Error('Snapshot editor flush timed out')
              options.logger.error(
                {
                  event: 'editor.snapshot_flush.timeout',
                  err,
                  projectSessionId: context.projectSessionId,
                  closingToken: authorization.closingToken,
                  timeoutMs: snapshotFlushTimeoutMs
                },
                'Snapshot editor flush timed out'
              )
              reject(err)
            }, snapshotFlushTimeoutMs)
            try {
              sender.send(
                IPC_CHANNELS.editorFlushRequest,
                editorFlushRequestSchema.parse({
                  projectSessionId: context.projectSessionId,
                  closingToken: authorization.closingToken,
                  purpose: 'snapshot',
                  sectionId: activeSectionId,
                  sectionRevisionId: currentRevision
                })
              )
            } catch (err) {
              pending.delete(authorization.closingToken)
              reject(err)
            }
          })
        } finally {
          if (timer !== undefined) clearTimeout(timer)
        }
        const request = pending.get(authorization.closingToken)
        pending.delete(authorization.closingToken)
        if (
          request?.acknowledgedSectionId !== activeSectionId ||
          request.acknowledgedRevision !==
            context.manuscript.getSection(activeSectionId).currentRevisionId
        ) {
          throw new Error('Snapshot editor flush revision was not acknowledged')
        }
      } finally {
        pending.delete(authorization.closingToken)
        options.manager.completeSnapshotFlush(authorization.closingToken)
      }
    }
  }

  const flushForMutation = async (
    projectSessionId: string,
    affectedSectionIds: readonly string[]
  ): Promise<void> => {
    const context = options.manager.assertMutationSession(projectSessionId)
    const activeSectionId = resolveActiveSection(context, activeSections)
    if (activeSectionId === undefined || !affectedSectionIds.includes(activeSectionId)) return
    const sender = Array.from(subscribers.get(projectSessionId)?.values() ?? []).find(
      (candidate) => !candidate.isDestroyed()
    )
    if (sender === undefined)
      throw new Error('Active editor mutation-flush subscriber is unavailable')
    const closingToken = randomUUID()
    const currentRevision = context.manuscript.getSection(activeSectionId).currentRevisionId
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await new Promise<void>((resolve, reject) => {
        pending.set(closingToken, {
          senderId: sender.id,
          authorization: { projectSessionId, closingToken, currentRevision },
          resolve,
          reject,
          acknowledgedSectionId: null,
          acknowledgedRevision: null
        })
        timer = setTimeout(() => {
          pending.delete(closingToken)
          const err = new Error('Agent mutation editor flush timed out')
          options.logger.error(
            {
              event: 'agent.mutation_barrier.timeout',
              err,
              projectSessionId,
              timeoutMs: snapshotFlushTimeoutMs
            },
            'Agent mutation editor flush timed out'
          )
          reject(err)
        }, snapshotFlushTimeoutMs)
        sender.send(
          IPC_CHANNELS.editorFlushRequest,
          editorFlushRequestSchema.parse({
            projectSessionId,
            closingToken,
            purpose: 'mutation',
            sectionId: activeSectionId,
            sectionRevisionId: currentRevision
          })
        )
      })
      const request = pending.get(closingToken)
      if (
        request?.acknowledgedSectionId !== activeSectionId ||
        request.acknowledgedRevision !==
          context.manuscript.getSection(activeSectionId).currentRevisionId
      ) {
        throw new Error('Agent mutation editor flush revision was not acknowledged')
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      pending.delete(closingToken)
    }
  }

  return {
    closeParticipants,
    snapshotParticipants,
    flushForMutation,
    revokeSession(sessionId) {
      subscribers.delete(sessionId)
      for (const [token, request] of pending) {
        if (request.authorization.projectSessionId === sessionId) {
          request.reject(new Error('Editor flush session was revoked'))
          pending.delete(token)
        }
      }
    },
    unregister() {
      subscribers.clear()
      activeSections.clear()
      for (const request of pending.values()) request.reject(new Error('Editor IPC unregistered'))
      pending.clear()
      for (const channel of [
        IPC_CHANNELS.editorOpen,
        IPC_CHANNELS.editorLoadSection,
        IPC_CHANNELS.editorSetActiveSection,
        IPC_CHANNELS.editorSaveSectionDocument,
        IPC_CHANNELS.editorImportMarkdown,
        IPC_CHANNELS.editorExportNativeJson,
        IPC_CHANNELS.editorExportMarkdown,
        IPC_CHANNELS.editorSubscribeFlush,
        IPC_CHANNELS.editorUnsubscribeFlush,
        IPC_CHANNELS.editorFinalFlushSave,
        IPC_CHANNELS.editorFlushAck
      ])
        ipc.removeHandler(channel)
    }
  }
}

async function saveWithConflictResult(
  operation: () => Promise<ReturnType<typeof saveSectionDocumentResultSchema.parse>>
): Promise<ReturnType<typeof saveSectionDocumentResponseSchema.parse>> {
  try {
    return saveSectionDocumentResponseSchema.parse({ ok: true, result: await operation() })
  } catch (err) {
    if (err instanceof ManuscriptDomainError && err.code === 'section_revision_conflict') {
      return saveSectionDocumentResponseSchema.parse({
        ok: false,
        error: { code: err.code, message: 'The section body has changed' }
      })
    }
    throw err
  }
}

function activeRevision(
  context: ProjectContext,
  activeSections: Map<string, string>
): string | null {
  const activeSectionId = resolveActiveSection(context, activeSections)
  return activeSectionId === undefined
    ? null
    : context.manuscript.getSection(activeSectionId).currentRevisionId
}

function resolveActiveSection(
  context: ProjectContext,
  activeSections: Map<string, string>
): string | undefined {
  const sections = context.manuscript.listSections()
  const activeSectionId = activeSections.get(context.projectSessionId)
  if (
    activeSectionId !== undefined &&
    sections.some((section) => section.sectionId === activeSectionId)
  ) {
    return activeSectionId
  }
  const fallback = sections[0]?.sectionId
  if (activeSectionId !== undefined) {
    if (fallback === undefined) activeSections.delete(context.projectSessionId)
    else activeSections.set(context.projectSessionId, fallback)
  }
  return fallback
}
