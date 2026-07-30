import { dialog, ipcMain, shell, type BrowserWindow, type IpcMain } from 'electron'
import { stat } from 'node:fs/promises'
import type { Logger } from 'pino'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import {
  knowledgeEmbeddingRefreshInputSchema,
  knowledgeImportPathsInputSchema,
  knowledgeIndexStatusSchema,
  knowledgeItemActionInputSchema,
  knowledgeListInputSchema,
  knowledgeListResultSchema,
  parsedKnowledgeAssetInputSchema,
  parsedKnowledgeAssetSchema,
  parsedKnowledgeDocumentSchema,
  SUPPORTED_KNOWLEDGE_EXTENSIONS
} from '../../shared/contracts/knowledge'
import {
  knowledgeMappingPageInputSchema,
  knowledgeMappingPageSchema,
  pdfPreviewInputSchema,
  pdfPreviewReleaseInputSchema,
  pdfPreviewResultSchema
} from '../../shared/contracts/knowledge-mapping'
import type { PdfPreviewCapabilities } from '../knowledge/pdf-preview-capabilities'
import type { MineruWorkReferences } from '../knowledge/mineru-workflow-service'
import type { ProjectContext } from '../project/project-context'
import type { ProjectManager } from '../project/project-manager'
import { resolveProjectPath } from '../project/project-paths'
import { authorizeSender } from './authorize-sender'

export interface KnowledgeIpcMain extends Pick<IpcMain, 'handle' | 'removeHandler'> {}

export function registerKnowledgeIpc(options: {
  manager: ProjectManager
  getWindow: () => BrowserWindow | null
  logger: Pick<Logger, 'info' | 'error'>
  developmentUrl?: string
  ipc?: KnowledgeIpcMain
  selectFilesForTest?: () => Promise<string[]>
  pdfPreview?: PdfPreviewCapabilities
}): () => void {
  const ipc = options.ipc ?? ipcMain

  ipc.handle(IPC_CHANNELS.knowledgeList, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = knowledgeListInputSchema.parse(input)
    return knowledgeListResultSchema.parse(
      options.manager.assertActiveSession(parsed.projectSessionId).knowledgeImports.list()
    )
  })

  ipc.handle(IPC_CHANNELS.knowledgeIndexStatus, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = knowledgeListInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    if (context.projectIndex === null) throw new Error('Knowledge index status is unavailable')
    const readiness = context.projectIndex.readiness()
    if (readiness !== 'available') {
      return knowledgeIndexStatusSchema.parse({ readiness, indexed: false })
    }
    try {
      const indexed = await context.projectIndex.isCurrentGenerationIndexed()
      options.manager.assertActiveSession(parsed.projectSessionId)
      return knowledgeIndexStatusSchema.parse({ readiness, indexed })
    } catch (err) {
      options.logger.error(
        { event: 'knowledge.index_status.failed', err, projectSessionId: parsed.projectSessionId },
        'Failed to inspect knowledge index status'
      )
      throw new Error('Knowledge index status could not be loaded', { cause: err })
    }
  })

  ipc.handle(IPC_CHANNELS.knowledgeChooseAndImport, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = knowledgeListInputSchema.parse(input)
    const context = options.manager.assertMutationSession(parsed.projectSessionId)
    const paths = options.selectFilesForTest
      ? await options.selectFilesForTest()
      : await chooseFiles(options.getWindow())
    options.manager.assertActiveSession(parsed.projectSessionId)
    if (paths.length === 0) return knowledgeListResultSchema.parse(context.knowledgeImports.list())
    try {
      await context.knowledgeImports.startImportPaths(paths)
      options.manager.assertActiveSession(parsed.projectSessionId)
      return knowledgeListResultSchema.parse(context.knowledgeImports.list())
    } catch (err) {
      options.logger.error(
        { event: 'knowledge.import_batch.failed', err, projectSessionId: parsed.projectSessionId },
        'Knowledge batch import failed'
      )
      throw new Error('One or more selected files could not be imported', { cause: err })
    }
  })

  ipc.handle(IPC_CHANNELS.knowledgeImportDropped, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = knowledgeImportPathsInputSchema.parse(input)
    const context = options.manager.assertMutationSession(parsed.projectSessionId)
    try {
      await context.knowledgeImports.startImportPaths(parsed.paths)
      options.manager.assertActiveSession(parsed.projectSessionId)
      return knowledgeListResultSchema.parse(context.knowledgeImports.list())
    } catch (err) {
      options.logger.error(
        { event: 'knowledge.drop_import.failed', err, projectSessionId: parsed.projectSessionId },
        'Dropped knowledge import failed'
      )
      throw new Error('One or more dropped files could not be imported', { cause: err })
    }
  })

  ipc.handle(IPC_CHANNELS.knowledgeCancel, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = knowledgeItemActionInputSchema.parse(input)
    const service = options.manager.assertMutationSession(parsed.projectSessionId).knowledgeImports
    service.cancel(parsed.knowledgeItemId)
    return knowledgeListResultSchema.parse(service.list())
  })

  ipc.handle(IPC_CHANNELS.knowledgeDelete, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = knowledgeItemActionInputSchema.parse(input)
    const context = options.manager.assertMutationSession(parsed.projectSessionId)
    if (context.mineruWorkflow !== null) {
      const references = context.mineruWorkflow.cancelForKnowledgeItem(parsed.knowledgeItemId)
      cancelMineruJobs(context, references)
      await context.mineruWorkflow.cleanupAllArtifacts(parsed.knowledgeItemId, references)
    }
    await context.knowledgeImports.delete(parsed.knowledgeItemId)
    options.manager.assertActiveSession(parsed.projectSessionId)
    return knowledgeListResultSchema.parse(context.knowledgeImports.list())
  })

  const openOriginal = async (input: unknown, reveal: boolean): Promise<void> => {
    const parsed = knowledgeItemActionInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    const absolutePath = resolveProjectPath(
      context.projectRoot,
      context.knowledgeImports.originalRelativePath(parsed.knowledgeItemId)
    )
    if (reveal) shell.showItemInFolder(absolutePath)
    else {
      const error = await shell.openPath(absolutePath)
      if (error) throw new Error('The original file could not be opened')
    }
  }

  ipc.handle(IPC_CHANNELS.knowledgeReveal, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    try {
      await openOriginal(input, true)
    } catch (err) {
      options.logger.error(
        { event: 'knowledge.original_reveal.failed', err },
        'Reveal original failed'
      )
      throw new Error('The original file could not be revealed', { cause: err })
    }
  })
  ipc.handle(IPC_CHANNELS.knowledgeOpenOriginal, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    try {
      await openOriginal(input, false)
    } catch (err) {
      options.logger.error({ event: 'knowledge.original_open.failed', err }, 'Open original failed')
      throw new Error('The original file could not be opened', { cause: err })
    }
  })

  ipc.handle(IPC_CHANNELS.knowledgeStartParse, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = knowledgeItemActionInputSchema.parse(input)
    const context = options.manager.assertMutationSession(parsed.projectSessionId)
    if (context.mineruWorkflow === null) throw new Error('MinerU parsing is unavailable')
    try {
      await context.mineruWorkflow.start(parsed.knowledgeItemId)
      options.manager.assertActiveSession(parsed.projectSessionId)
    } catch (err) {
      options.logger.error(
        { event: 'knowledge.parse_start.failed', err, knowledgeItemId: parsed.knowledgeItemId },
        'Failed to start knowledge parsing'
      )
      throw new Error('Knowledge parsing could not be started', { cause: err })
    }
  })

  ipc.handle(IPC_CHANNELS.knowledgeCancelParse, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = knowledgeItemActionInputSchema.parse(input)
    const context = options.manager.assertMutationSession(parsed.projectSessionId)
    if (context.mineruWorkflow === null) throw new Error('MinerU parsing is unavailable')
    try {
      const references = context.mineruWorkflow.cancelForKnowledgeItem(parsed.knowledgeItemId)
      cancelMineruJobs(context, references)
      await context.mineruWorkflow.cleanupCancelledArtifacts(parsed.knowledgeItemId, references)
      options.manager.assertActiveSession(parsed.projectSessionId)
    } catch (err) {
      options.logger.error(
        { event: 'knowledge.parse_cancel.failed', err, knowledgeItemId: parsed.knowledgeItemId },
        'Failed to cancel knowledge parsing'
      )
      throw new Error('Knowledge parsing could not be cancelled', { cause: err })
    }
  })

  ipc.handle(IPC_CHANNELS.knowledgeRefreshEmbeddings, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = knowledgeEmbeddingRefreshInputSchema.parse(input)
    const context = options.manager.assertMutationSession(parsed.projectSessionId)
    if (context.projectIndex === null) throw new Error('Knowledge embeddings are unavailable')
    try {
      await context.projectIndex.requestEmbeddingRefresh(parsed.knowledgeItemId)
      options.manager.assertActiveSession(parsed.projectSessionId)
    } catch (err) {
      options.logger.error(
        {
          event: 'knowledge.embedding_refresh.failed',
          err,
          projectSessionId: parsed.projectSessionId,
          ...(parsed.knowledgeItemId === undefined
            ? {}
            : { knowledgeItemId: parsed.knowledgeItemId })
        },
        'Failed to queue knowledge embedding refresh'
      )
      throw new Error('Knowledge embeddings could not be refreshed', { cause: err })
    }
  })

  ipc.handle(IPC_CHANNELS.knowledgeCreatePdfPreview, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = pdfPreviewInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    if (options.pdfPreview === undefined) throw new Error('PDF preview is unavailable')
    const item = context.knowledgeImports
      .list()
      .find((candidate) => candidate.knowledgeItemId === parsed.knowledgeItemId)
    if (item?.extension !== 'pdf' || item.mimeType !== 'application/pdf') {
      throw new Error('PDF preview is only available for PDF sources')
    }
    try {
      const relativePath = context.knowledgeImports.originalRelativePath(parsed.knowledgeItemId)
      const absolutePath = resolveProjectPath(context.projectRoot, relativePath)
      const file = await stat(absolutePath)
      if (!file.isFile() || file.size !== item.byteSize || item.sha256 === null) {
        throw new Error('Original PDF is unavailable')
      }
      options.manager.assertActiveSession(parsed.projectSessionId)
      return pdfPreviewResultSchema.parse(
        options.pdfPreview.issue({
          projectSessionId: parsed.projectSessionId,
          knowledgeItemId: parsed.knowledgeItemId,
          absolutePath,
          byteSize: file.size,
          sourceSha256: item.sha256
        })
      )
    } catch (err) {
      options.logger.error(
        { event: 'knowledge.pdf_preview.failed', err, knowledgeItemId: parsed.knowledgeItemId },
        'Failed to create PDF preview capability'
      )
      throw new Error('PDF preview could not be created', { cause: err })
    }
  })

  ipc.handle(IPC_CHANNELS.knowledgeReleasePdfPreview, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = pdfPreviewReleaseInputSchema.parse(input)
    options.manager.assertActiveSession(parsed.projectSessionId)
    options.pdfPreview?.revoke(parsed.previewId, parsed.projectSessionId)
  })

  ipc.handle(IPC_CHANNELS.knowledgeMappingPage, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = knowledgeMappingPageInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    if (context.knowledgeMapping === null || context.knowledgeMapping === undefined) {
      throw new Error('Knowledge mapping is unavailable')
    }
    try {
      const result = await context.knowledgeMapping.page(parsed.knowledgeItemId, parsed.pageIndex)
      options.manager.assertActiveSession(parsed.projectSessionId)
      return knowledgeMappingPageSchema.parse(result)
    } catch (err) {
      options.logger.error(
        {
          event: 'knowledge.mapping.failed',
          err,
          projectSessionId: parsed.projectSessionId,
          knowledgeItemId: parsed.knowledgeItemId,
          pageIndex: parsed.pageIndex
        },
        'Failed to load knowledge mapping page'
      )
      throw new Error('Knowledge mapping could not be loaded', { cause: err })
    }
  })

  ipc.handle(IPC_CHANNELS.knowledgeParsedDocument, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = knowledgeItemActionInputSchema.parse(input)
    const context = options.manager.assertMutationSession(parsed.projectSessionId)
    if (context.knowledgeNormalization === null) throw new Error('Parsed knowledge is unavailable')
    try {
      const result = await context.knowledgeNormalization.detail(parsed.knowledgeItemId)
      options.manager.assertActiveSession(parsed.projectSessionId)
      return parsedKnowledgeDocumentSchema.parse(result)
    } catch (err) {
      options.logger.error(
        { event: 'knowledge.parsed_document.failed', err, knowledgeItemId: parsed.knowledgeItemId },
        'Failed to load parsed knowledge document'
      )
      throw new Error('Parsed knowledge document could not be loaded', { cause: err })
    }
  })

  ipc.handle(IPC_CHANNELS.knowledgeParsedAsset, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = parsedKnowledgeAssetInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    if (context.knowledgeNormalization === null) throw new Error('Parsed knowledge is unavailable')
    try {
      const result = await context.knowledgeNormalization.asset(
        parsed.knowledgeItemId,
        parsed.parseRevisionId,
        parsed.assetRef
      )
      options.manager.assertActiveSession(parsed.projectSessionId)
      return parsedKnowledgeAssetSchema.parse(result)
    } catch (err) {
      options.logger.error(
        { event: 'knowledge.parsed_asset.failed', err, knowledgeItemId: parsed.knowledgeItemId },
        'Failed to load parsed knowledge asset'
      )
      throw new Error('Parsed knowledge asset could not be loaded', { cause: err })
    }
  })

  return () => {
    for (const channel of [
      IPC_CHANNELS.knowledgeList,
      IPC_CHANNELS.knowledgeIndexStatus,
      IPC_CHANNELS.knowledgeChooseAndImport,
      IPC_CHANNELS.knowledgeImportDropped,
      IPC_CHANNELS.knowledgeCancel,
      IPC_CHANNELS.knowledgeDelete,
      IPC_CHANNELS.knowledgeReveal,
      IPC_CHANNELS.knowledgeOpenOriginal,
      IPC_CHANNELS.knowledgeStartParse,
      IPC_CHANNELS.knowledgeCancelParse,
      IPC_CHANNELS.knowledgeRefreshEmbeddings,
      IPC_CHANNELS.knowledgeCreatePdfPreview,
      IPC_CHANNELS.knowledgeReleasePdfPreview,
      IPC_CHANNELS.knowledgeMappingPage,
      IPC_CHANNELS.knowledgeParsedDocument,
      IPC_CHANNELS.knowledgeParsedAsset
    ])
      ipc.removeHandler(channel)
  }
}

function cancelMineruJobs(context: ProjectContext, references: MineruWorkReferences): void {
  const cancelled = [
    ...context.jobs.requestCancellationForPayload({
      types: ['mineru_parse'],
      field: 'parseTaskId',
      values: references.parseTaskIds
    }),
    ...context.jobs.requestCancellationForPayload({
      types: ['normalize_parse_revision'],
      field: 'parseRevisionId',
      values: references.parseRevisionIds
    })
  ]
  for (const job of cancelled) context.runtime.scheduler.cancel(job.jobId)
}

async function chooseFiles(owner: BrowserWindow | null): Promise<string[]> {
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Supported knowledge sources', extensions: [...SUPPORTED_KNOWLEDGE_EXTENSIONS] }
    ]
  }
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? [] : result.filePaths.slice(0, 50)
}
