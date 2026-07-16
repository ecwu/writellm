import { dialog, ipcMain, shell, type BrowserWindow, type IpcMain } from 'electron'
import type { Logger } from 'pino'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import {
  knowledgeImportPathsInputSchema,
  knowledgeItemActionInputSchema,
  knowledgeListInputSchema,
  knowledgeListResultSchema,
  parsedKnowledgeAssetInputSchema,
  parsedKnowledgeAssetSchema,
  parsedKnowledgeDocumentSchema,
  SUPPORTED_KNOWLEDGE_EXTENSIONS
} from '../../shared/contracts/knowledge'
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
}): () => void {
  const ipc = options.ipc ?? ipcMain

  ipc.handle(IPC_CHANNELS.knowledgeList, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = knowledgeListInputSchema.parse(input)
    return knowledgeListResultSchema.parse(
      options.manager.assertActiveSession(parsed.projectSessionId).knowledgeImports.list()
    )
  })

  ipc.handle(IPC_CHANNELS.knowledgeChooseAndImport, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = knowledgeListInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
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
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
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
    const service = options.manager.assertActiveSession(parsed.projectSessionId).knowledgeImports
    service.cancel(parsed.knowledgeItemId)
    return knowledgeListResultSchema.parse(service.list())
  })

  ipc.handle(IPC_CHANNELS.knowledgeDelete, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = knowledgeItemActionInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
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
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
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
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
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

  ipc.handle(IPC_CHANNELS.knowledgeParsedDocument, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = knowledgeItemActionInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
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
      IPC_CHANNELS.knowledgeChooseAndImport,
      IPC_CHANNELS.knowledgeImportDropped,
      IPC_CHANNELS.knowledgeCancel,
      IPC_CHANNELS.knowledgeDelete,
      IPC_CHANNELS.knowledgeReveal,
      IPC_CHANNELS.knowledgeOpenOriginal,
      IPC_CHANNELS.knowledgeStartParse,
      IPC_CHANNELS.knowledgeCancelParse,
      IPC_CHANNELS.knowledgeParsedDocument,
      IPC_CHANNELS.knowledgeParsedAsset
    ])
      ipc.removeHandler(channel)
  }
}

function cancelMineruJobs(context: ProjectContext, references: MineruWorkReferences): void {
  const cancelled = [
    ...context.jobs.requestCancellationForPayload({
      types: ['mineru.submit', 'mineru.poll', 'mineru.download'],
      field: 'parseTaskId',
      values: references.parseTaskIds
    }),
    ...context.jobs.requestCancellationForPayload({
      types: ['mineru.normalize'],
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
