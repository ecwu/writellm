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
  type EditorFlushRequest,
  type Section,
  type saveSectionDocumentResultSchema
} from '../../shared/contracts/manuscript'
import type { ProjectContext } from '../project/project-context'
import {
  ProjectSessionError,
  type ProjectManager,
  type ProjectCloseParticipants,
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
  request: EditorFlushRequest
  resolve: () => void
  reject: (error: Error) => void
  acknowledgedSectionId: string | null
  acknowledgedRevision: string | null
}

type SectionFlushRequest = EditorFlushRequest & { sectionId: string; sectionRevisionId: string }
type EditorCloseParticipants = Pick<
  ProjectCloseParticipants,
  'getCurrentRevision' | 'flushEditors' | 'verifyFinalEditorFlush'
>

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
  closeParticipants: EditorCloseParticipants
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

  function findFlushSubscriber(projectSessionId: string): WebContents | undefined {
    return Array.from(subscribers.get(projectSessionId)?.values() ?? []).find(
      (candidate) => !candidate.isDestroyed()
    )
  }

  function authorizedFlush(
    input: Pick<EditorFlushRequest, 'projectSessionId' | 'closingToken' | 'purpose'>,
    senderId: number
  ): PendingFlush | undefined {
    const flush = pending.get(input.closingToken)
    return flush?.senderId === senderId &&
      flush.request.projectSessionId === input.projectSessionId &&
      (flush.request.purpose ?? 'close') === (input.purpose ?? 'close')
      ? flush
      : undefined
  }

  function requestFlush(sender: WebContents, request: SectionFlushRequest): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      pending.set(request.closingToken, {
        senderId: sender.id,
        request,
        resolve,
        reject,
        acknowledgedSectionId: null,
        acknowledgedRevision: null
      })
      sender.send(IPC_CHANNELS.editorFlushRequest, editorFlushRequestSchema.parse(request))
    })
  }

  async function flushWithTimeout(
    context: ProjectContext,
    sender: WebContents,
    request: SectionFlushRequest
  ): Promise<void> {
    const { projectSessionId, closingToken, sectionId, purpose } = request
    const mutation = purpose === 'mutation'
    const label = mutation ? 'Manuscript mutation editor flush' : 'Snapshot editor flush'
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const err = new Error(`${label} timed out`)
          options.logger.error(
            {
              event: mutation ? 'editor.mutation_barrier.timeout' : 'editor.snapshot_flush.timeout',
              err,
              projectSessionId,
              ...(mutation ? {} : { closingToken }),
              timeoutMs: snapshotFlushTimeoutMs
            },
            err.message
          )
          reject(err)
        }, snapshotFlushTimeoutMs)
      })
      await Promise.race([requestFlush(sender, request), timeout])
      verifyFlush(
        pending.get(closingToken),
        sectionId,
        context.manuscript.getSection(sectionId).currentRevisionId,
        label
      )
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      pending.delete(closingToken)
    }
  }

  handle(editorIpcEndpoints.loadSection, (parsed, context) =>
    context.editorPersistence.loadSection(parsed.sectionId)
  )
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
      const manuscript = context.manuscript.assemble()
      const current = manuscript.sections.find(
        ({ section }) => section.sectionId === parsed.sectionId
      )?.revision
      if (
        current === undefined ||
        current.sectionRevisionId !== parsed.sectionRevisionId ||
        current.contentHash !== parsed.contentHash
      ) {
        throw new Error('Markdown export source revision is stale')
      }
      const relativePath = `manuscript/exports/${encodeURIComponent(parsed.sectionId)}-${parsed.sectionRevisionId}.md`
      const converted = manuscriptSectionToMarkdown(manuscript, parsed.sectionId, (logicalUrl) => {
        const match = /^writellm-asset:([0-9a-f-]+)$/iu.exec(logicalUrl)
        if (match?.[1] === undefined) throw new Error('Markdown asset reference is invalid')
        return context.manuscriptAssets.markdownReference(match[1])
      })
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
    if (authorizedFlush(parsed, event.sender.id) === undefined)
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
    const currentPending = authorizedFlush(parsed, event.sender.id)
    if (
      currentPending === undefined ||
      currentPending.acknowledgedSectionId !== null ||
      currentPending.acknowledgedRevision !== null
    )
      throw new Error('Editor flush acknowledgment is not authorized')
    currentPending.acknowledgedSectionId = parsed.sectionId
    currentPending.acknowledgedRevision = parsed.sectionRevisionId
    currentPending.resolve()
  })

  const closeParticipants: EditorCloseParticipants = {
    getCurrentRevision: async (context) =>
      resolveActiveSection(context, activeSections)?.currentRevisionId ?? null,
    flushEditors: async (context, authorization) => {
      const section = resolveActiveSection(context, activeSections)
      if (section === undefined) return
      const sender = findFlushSubscriber(context.projectSessionId)
      if (sender === undefined) {
        if (activeSections.has(context.projectSessionId)) {
          throw new Error('Active editor final-flush subscriber is unavailable')
        }
        return
      }
      await requestFlush(sender, {
        projectSessionId: context.projectSessionId,
        closingToken: authorization.closingToken,
        sectionId: section.sectionId,
        sectionRevisionId: section.currentRevisionId,
        bodyRequired: true
      })
    },
    verifyFinalEditorFlush: async (context, authorization) => {
      const request = pending.get(authorization.closingToken)
      pending.delete(authorization.closingToken)
      if (request === undefined) return
      const section = resolveActiveSection(context, activeSections)
      verifyFlush(
        request,
        section?.sectionId ?? null,
        section?.currentRevisionId ?? null,
        'Final editor flush'
      )
    }
  }

  const snapshotParticipants: Pick<ProjectSnapshotParticipants, 'finalEditorFlush'> = {
    finalEditorFlush: async (context, purpose = 'snapshot') => {
      const { projectSessionId } = context
      const { closingToken } = options.manager.beginSnapshotFlush(projectSessionId)
      try {
        const section = resolveActiveSection(context, activeSections)
        const sender = findFlushSubscriber(projectSessionId)
        if (section === undefined || sender === undefined) return
        await flushWithTimeout(context, sender, {
          projectSessionId,
          closingToken,
          purpose,
          bodyRequired: true,
          sectionId: section.sectionId,
          sectionRevisionId: section.currentRevisionId
        })
      } finally {
        options.manager.completeSnapshotFlush(closingToken)
      }
    }
  }

  const flushForMutation = async (
    projectSessionId: string,
    affectedSectionIds: readonly string[],
    flushMetadata = false
  ): Promise<void> => {
    const context = options.manager.assertMutationSession(projectSessionId)
    const section = resolveActiveSection(context, activeSections)
    if (section === undefined) return
    const bodyRequired = affectedSectionIds.includes(section.sectionId)
    if (!bodyRequired && !flushMetadata) return
    const sender = findFlushSubscriber(projectSessionId)
    if (sender === undefined)
      throw new Error('Active editor mutation-flush subscriber is unavailable')
    await flushWithTimeout(context, sender, {
      projectSessionId,
      closingToken: randomUUID(),
      purpose: 'mutation',
      bodyRequired,
      sectionId: section.sectionId,
      sectionRevisionId: section.currentRevisionId
    })
  }

  return {
    authorizeLayoutFlush(projectSessionId, closingToken, senderId) {
      const request = pending.get(closingToken)
      const active = options.manager.snapshot().activeProject
      if (
        !request ||
        request.acknowledgedRevision !== null ||
        request.senderId !== senderId ||
        request.request.projectSessionId !== projectSessionId ||
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
      activeSections.delete(sessionId)
      importService.revokeSession(sessionId)
      for (const [token, request] of pending) {
        if (request.request.projectSessionId === sessionId) {
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

function verifyFlush(
  request: PendingFlush | undefined,
  sectionId: string | null,
  revisionId: string | null,
  label: string
): void {
  if (request?.acknowledgedSectionId !== sectionId || request.acknowledgedRevision !== revisionId) {
    throw new Error(`${label} revision was not acknowledged`)
  }
}

function resolveActiveSection(
  context: ProjectContext,
  activeSections: Map<string, string>
): Section | undefined {
  const sections = context.manuscript.listSections()
  const activeSectionId = activeSections.get(context.projectSessionId)
  const activeSection = sections.find((section) => section.sectionId === activeSectionId)
  if (activeSection !== undefined) return activeSection
  const fallback = sections[0]
  if (activeSectionId !== undefined) {
    if (fallback === undefined) activeSections.delete(context.projectSessionId)
    else activeSections.set(context.projectSessionId, fallback.sectionId)
  }
  return fallback
}
