import { reportIpcFailure } from '../observability/ipc-context'
import {
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMain,
  type OpenDialogOptions,
  type WebContents
} from 'electron'
import { randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import { editorIpcEndpoints } from '../../shared/contracts/ipc-endpoints-editor'
import {
  editorFlushRequestSchema,
  editorSectionSchema,
  ManuscriptDomainError,
  saveSectionDocumentResponseSchema,
  type saveSectionDocumentResultSchema
} from '../../shared/contracts/manuscript'
import type { ProjectContext } from '../project/project-context'
import {
  ProjectSessionError,
  type ProjectManager,
  type ProjectCloseParticipants,
  type ProjectFinalFlushAuthorization,
  type ProjectSnapshotParticipants
} from '../project/project-manager'
import { resolveProjectPath } from '../project/project-paths'
import { writeAtomicFile } from '../storage/atomic-file'
import { createEndpointRegistrar } from './endpoint'
import type { ManuscriptAssetCapabilities } from '../manuscript/asset-capabilities'
import { manuscriptSectionToMarkdown } from '../../shared/manuscript-markdown'
import { ManuscriptImportService } from '../manuscript/manuscript-import-service'
import type { LatexImportWorkerResult } from '../../shared/contracts/latex-import'

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
  logger: Pick<Logger, 'info' | 'warn' | 'error'>
  developmentUrl?: string
  ipc?: EditorIpcMain
  snapshotFlushTimeoutMs?: number
  assetCapabilities?: ManuscriptAssetCapabilities
  getWindow?: () => BrowserWindow | null
  selectImportSourceForTest?: () => Promise<string | null>
  parseLatex?: (input: {
    source: string
    sourceHash: string
    project?: {
      entryRelativePath: string
      textFiles: Array<{ relativePath: string; kind: 'tex' | 'bib'; source: string }>
      assetPaths: string[]
    } | null
    signal?: AbortSignal
  }) => Promise<LatexImportWorkerResult>
}): {
  authorizeLayoutFlush(projectSessionId: string, closingToken: string, senderId: number): string
  closeParticipants: ProjectCloseParticipants
  snapshotParticipants: Pick<ProjectSnapshotParticipants, 'finalEditorFlush'>
  flushForMutation(
    projectSessionId: string,
    affectedSectionIds: readonly string[],
    flushMetadata?: boolean
  ): Promise<void>
  revokeSession(sessionId: string): void
  unregister(): void
} {
  const ipc = options.ipc ?? ipcMain
  const snapshotFlushTimeoutMs = options.snapshotFlushTimeoutMs ?? 10_000
  const subscribers = new Map<string, Map<string, WebContents>>()
  const activeSections = new Map<string, string>()
  const pending = new Map<string, PendingFlush>()
  const handle = createEndpointRegistrar(ipc, {
    developmentUrl: options.developmentUrl,
    manager: options.manager
  })
  const importService = new ManuscriptImportService({
    log: options.logger,
    parseLatex: options.parseLatex
  })

  handle(editorIpcEndpoints.open, (parsed, context) => {
    const result = context.editorPersistence.openEditor()
    if (result.activeSection !== null) {
      activeSections.set(parsed.projectSessionId, result.activeSection.section.sectionId)
    }
    return result
  })
  handle(editorIpcEndpoints.loadSection, (parsed, context) => {
    const result = context.editorPersistence.loadSection(parsed.sectionId)
    activeSections.set(parsed.projectSessionId, result.section.sectionId)
    return result
  })
  handle(editorIpcEndpoints.setActiveSection, (parsed, context) => {
    context.manuscript.getSection(parsed.sectionId)
    activeSections.set(parsed.projectSessionId, parsed.sectionId)
  })
  handle(editorIpcEndpoints.saveSectionDocument, async (parsed, context) => {
    const result = await saveWithConflictResult(() => context.editorPersistence.save(parsed))
    options.manager.assertActiveSession(parsed.projectSessionId)
    return result
  })
  handle(editorIpcEndpoints.createImportPlan, async (parsed, context) => {
    const selectedPath =
      options.selectImportSourceForTest === undefined
        ? await selectImportSource(options.getWindow?.() ?? null, parsed.selection ?? 'file')
        : await options.selectImportSourceForTest()
    if (selectedPath === null) return { status: 'cancelled' as const }
    const plan = await importService.createPlan({
      context,
      sourcePath: selectedPath,
      activeSectionId: parsed.activeSectionId
    })
    options.manager.assertActiveSession(parsed.projectSessionId)
    return { status: 'ready' as const, plan }
  })
  handle(editorIpcEndpoints.applyImportPlan, async (parsed, context) => {
    const result = await importService.apply(context, parsed)
    options.manager.assertActiveSession(parsed.projectSessionId)
    return result
  })
  handle(editorIpcEndpoints.cancelImportPlan, async (parsed, context) => {
    return await importService.cancel(context, parsed.planId)
  })
  /** Report export failures, including session rejections, behind one safe error. */
  const exportBoundary =
    (event: string, message: string, failure: string) =>
    async <T>(parsed: { projectSessionId: string }, run: () => Promise<T>): Promise<T> => {
      try {
        return await run()
      } catch (err) {
        reportIpcFailure(
          options.logger,
          { event, err, projectSessionId: parsed.projectSessionId },
          message
        )
        throw new Error(failure, { cause: err })
      }
    }
  handle(
    editorIpcEndpoints.exportNativeJson,
    async (parsed, context) => {
      const current = editorSectionSchema.parse(
        context.editorPersistence.loadSection(parsed.sectionId)
      )
      const relativePath = `manuscript/exports/${encodeURIComponent(parsed.sectionId)}-${current.revision.sectionRevisionId}.blocknote.json`
      await writeAtomicFile(
        resolveProjectPath(context.projectRoot, relativePath),
        Buffer.from(JSON.stringify(current.revision.content))
      )
      return { relativePath }
    },
    {
      around: exportBoundary(
        'editor.export_native_json.failed',
        'Native JSON export failed',
        'Native JSON export could not be completed'
      )
    }
  )
  handle(
    editorIpcEndpoints.exportMarkdown,
    async (parsed, context) => {
      const current = context.editorPersistence.loadSection(parsed.sectionId).revision
      if (
        current.sectionRevisionId !== parsed.sectionRevisionId ||
        current.contentHash !== parsed.contentHash
      ) {
        throw new Error('Markdown export source revision is stale')
      }
      const relativePath = `manuscript/exports/${encodeURIComponent(parsed.sectionId)}-${parsed.sectionRevisionId}.md`
      const converted = manuscriptSectionToMarkdown(
        context.manuscript.assemble(),
        parsed.sectionId,
        (logicalUrl) => {
          const match = /^writellm-asset:([0-9a-f-]+)$/iu.exec(logicalUrl)
          if (match?.[1] === undefined) throw new Error('Markdown asset reference is invalid')
          return context.manuscriptAssets.markdownReference(match[1])
        }
      )
      await writeAtomicFile(
        resolveProjectPath(context.projectRoot, relativePath),
        Buffer.from(converted.markdown)
      )
      return { relativePath }
    },
    {
      around: exportBoundary(
        'editor.export_markdown.failed',
        'Markdown export failed',
        'Markdown export could not be completed'
      )
    }
  )
  handle(editorIpcEndpoints.uploadAsset, async (parsed, context) => {
    const bytes = decodeBase64(parsed.dataBase64)
    const result = await context.manuscriptAssets.store({
      bytes,
      mimeType: parsed.mimeType,
      sourceType: 'upload',
      originalName: parsed.originalName
    })
    options.manager.assertActiveSession(parsed.projectSessionId)
    return result
  })
  handle(editorIpcEndpoints.resolveAsset, (parsed) => {
    try {
      const context = options.manager.assertActiveSession(parsed.projectSessionId)
      context.manuscriptAssets.get(parsed.assetId)
      if (options.assetCapabilities === undefined) throw new Error('Asset previews are unavailable')
      return {
        status: 'resolved' as const,
        ...options.assetCapabilities.issue({
          projectSessionId: parsed.projectSessionId,
          assetId: parsed.assetId,
          assets: context.manuscriptAssets
        })
      }
    } catch (err) {
      if (!(err instanceof ProjectSessionError)) throw err
      reportIpcFailure(
        options.logger,
        {
          event: 'editor.resolve_asset.session_revoked',
          err,
          projectSessionId: parsed.projectSessionId,
          assetId: parsed.assetId
        },
        'Asset resolution arrived after the project session was revoked'
      )
      return { status: 'session-revoked' as const }
    }
  })
  handle(editorIpcEndpoints.listAssets, async (parsed, context) => {
    const page = await context.manuscriptAssets.listWorkspace(parsed)
    options.manager.assertActiveSession(parsed.projectSessionId)
    return page
  })
  handle(editorIpcEndpoints.deleteAsset, async (parsed, context) => {
    const result = await context.manuscriptAssets.deleteUnprotected(parsed.assetId)
    options.manager.assertActiveSession(parsed.projectSessionId)
    return result
  })
  handle(editorIpcEndpoints.subscribeFlush, (parsed, _context, event) => {
    const leases = subscribers.get(parsed.projectSessionId) ?? new Map<string, WebContents>()
    leases.set(parsed.subscriptionId, event.sender)
    subscribers.set(parsed.projectSessionId, leases)
  })
  handle(editorIpcEndpoints.unsubscribeFlush, (parsed, _context, event) => {
    const leases = subscribers.get(parsed.projectSessionId)
    if (leases?.get(parsed.subscriptionId)?.id === event.sender.id) {
      leases.delete(parsed.subscriptionId)
      if (leases.size === 0) subscribers.delete(parsed.projectSessionId)
    }
  })
  handle(editorIpcEndpoints.finalFlushSave, async (parsed, _context, event) => {
    const currentPending = pending.get(parsed.closingToken)
    if (currentPending?.senderId !== event.sender.id)
      throw new Error('Final editor flush sender is not authorized')
    const context =
      parsed.purpose === 'mutation'
        ? options.manager.assertMutationSession(parsed.projectSessionId)
        : parsed.purpose === 'snapshot' || parsed.purpose === 'export'
          ? options.manager.authorizeSnapshotFlush(parsed.projectSessionId, parsed.closingToken)
          : options.manager.authorizeFinalFlush(parsed.projectSessionId, parsed.closingToken)
    return saveWithConflictResult(() => context.editorPersistence.save(parsed))
  })
  handle(editorIpcEndpoints.acknowledgeFlush, (parsed, _context, event) => {
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
      importService.revokeSession(sessionId)
    }
  }

  const snapshotParticipants: Pick<ProjectSnapshotParticipants, 'finalEditorFlush'> = {
    finalEditorFlush: async (context, purpose = 'snapshot') => {
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
                  purpose,
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
    affectedSectionIds: readonly string[],
    flushMetadata = false
  ): Promise<void> => {
    const context = options.manager.assertMutationSession(projectSessionId)
    const activeSectionId = resolveActiveSection(context, activeSections)
    if (activeSectionId === undefined) return
    const bodyRequired = affectedSectionIds.includes(activeSectionId)
    if (!bodyRequired && !flushMetadata) return
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
          const err = new Error('Manuscript mutation editor flush timed out')
          options.logger.error(
            {
              event: 'editor.mutation_barrier.timeout',
              err,
              projectSessionId,
              timeoutMs: snapshotFlushTimeoutMs
            },
            'Manuscript mutation editor flush timed out'
          )
          reject(err)
        }, snapshotFlushTimeoutMs)
        sender.send(
          IPC_CHANNELS.editorFlushRequest,
          editorFlushRequestSchema.parse({
            projectSessionId,
            closingToken,
            purpose: 'mutation',
            bodyRequired,
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
        throw new Error('Manuscript mutation editor flush revision was not acknowledged')
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      pending.delete(closingToken)
    }
  }

  return {
    authorizeLayoutFlush(projectSessionId, closingToken, senderId) {
      const request = pending.get(closingToken)
      const active = options.manager.snapshot().activeProject
      if (
        !request ||
        request.acknowledgedRevision !== null ||
        request.senderId !== senderId ||
        request.authorization.projectSessionId !== projectSessionId ||
        active?.projectSessionId !== projectSessionId
      )
        throw new Error('Layout flush is not authorized')
      return active.projectId
    },
    closeParticipants,
    snapshotParticipants,
    flushForMutation,
    revokeSession(sessionId) {
      subscribers.delete(sessionId)
      importService.revokeSession(sessionId)
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
        IPC_CHANNELS.editorCreateImportPlan,
        IPC_CHANNELS.editorApplyImportPlan,
        IPC_CHANNELS.editorCancelImportPlan,
        IPC_CHANNELS.editorExportNativeJson,
        IPC_CHANNELS.editorExportMarkdown,
        IPC_CHANNELS.editorUploadAsset,
        IPC_CHANNELS.editorResolveAsset,
        IPC_CHANNELS.editorListAssets,
        IPC_CHANNELS.editorDeleteAsset,
        IPC_CHANNELS.editorSubscribeFlush,
        IPC_CHANNELS.editorUnsubscribeFlush,
        IPC_CHANNELS.editorFinalFlushSave,
        IPC_CHANNELS.editorFlushAck
      ])
        ipc.removeHandler(channel)
    }
  }
}

function decodeBase64(value: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Image payload is not canonical base64')
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.byteLength === 0 || bytes.toString('base64') !== value) {
    throw new Error('Image payload is not canonical base64')
  }
  return bytes
}

async function selectImportSource(
  window: BrowserWindow | null,
  selectionType: 'file' | 'directory'
): Promise<string | null> {
  const options: OpenDialogOptions = {
    title: selectionType === 'directory' ? 'Import LaTeX project folder' : 'Import manuscript',
    properties: [selectionType === 'directory' ? 'openDirectory' : 'openFile'],
    ...(selectionType === 'file'
      ? { filters: [{ name: 'Manuscript source', extensions: ['md', 'tex', 'zip'] }] }
      : {})
  }
  const selection =
    window === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(window, options)
  return selection.canceled ? null : (selection.filePaths[0] ?? null)
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
