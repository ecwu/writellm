import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ipcMain, type IpcMain, type WebContents } from 'electron'
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
  ProjectManager
} from '../project/project-manager'
import { resolveProjectPath } from '../project/project-paths'
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
}): {
  closeParticipants: ProjectCloseParticipants
  revokeSession(sessionId: string): void
  unregister(): void
} {
  const ipc = options.ipc ?? ipcMain
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
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    const result = await saveWithConflictResult(() => context.editorPersistence.save(parsed))
    options.manager.assertActiveSession(parsed.projectSessionId)
    return result
  })
  ipc.handle(IPC_CHANNELS.editorImportMarkdown, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = importMarkdownInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    const result = await saveWithConflictResult(() =>
      context.editorPersistence.save(parsed, 'import')
    )
    options.manager.assertActiveSession(parsed.projectSessionId)
    return result
  })
  ipc.handle(IPC_CHANNELS.editorExportNativeJson, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = exportNativeJsonInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    const current = editorSectionSchema.parse(
      context.editorPersistence.loadSection(parsed.sectionId)
    )
    const relativePath = `manuscript/exports/${encodeURIComponent(parsed.sectionId)}-${current.revision.sectionRevisionId}.blocknote.json`
    return writeAtomic(
      resolveProjectPath(context.projectRoot, relativePath),
      Buffer.from(JSON.stringify(current.revision.content))
    ).then(() => exportResultSchema.parse({ relativePath }))
  })
  ipc.handle(IPC_CHANNELS.editorExportMarkdown, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = exportMarkdownInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    const current = context.editorPersistence.loadSection(parsed.sectionId).revision
    if (
      current.sectionRevisionId !== parsed.sectionRevisionId ||
      current.contentHash !== parsed.contentHash
    ) {
      throw new Error('Markdown export source revision is stale')
    }
    const relativePath = `manuscript/exports/${encodeURIComponent(parsed.sectionId)}-${parsed.sectionRevisionId}.md`
    await writeAtomic(
      resolveProjectPath(context.projectRoot, relativePath),
      Buffer.from(parsed.markdown)
    )
    return exportResultSchema.parse({ relativePath })
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
    const context = options.manager.authorizeFinalFlush(
      parsed.projectSessionId,
      parsed.closingToken
    )
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
            closingToken: authorization.closingToken
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
        request.acknowledgedSectionId !== activeSectionId ||
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

  return {
    closeParticipants,
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

async function writeAtomic(destination: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(destination), { recursive: true })
  const temporary = `${destination}.${randomUUID()}.tmp`
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, destination)
    const directory = await open(dirname(destination), 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  } finally {
    await handle?.close().catch(() => undefined)
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}
