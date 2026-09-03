import { dialog, ipcMain, shell, type BrowserWindow, type IpcMain } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, stat, writeFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import {
  knowledgeCitationCoveragePageInputSchema,
  knowledgeCitationCoveragePageResultSchema,
  knowledgeEmbeddingRefreshInputSchema,
  knowledgeImportPathsInputSchema,
  knowledgeIndexStatusSchema,
  knowledgeItemActionInputSchema,
  knowledgeListInputSchema,
  knowledgeListResultSchema,
  parsedKnowledgeAssetInputSchema,
  parsedKnowledgeAssetSchema,
  parsedKnowledgeBlockPageInputSchema,
  parsedKnowledgeBlockPageSchema,
  parsedKnowledgeMarkdownInputSchema,
  parsedKnowledgeMarkdownSchema,
  parsedKnowledgeMetadataSchema,
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
import { KnowledgeCitationCoverageService } from '../knowledge/knowledge-citation-coverage-service'
import type { MineruWorkReferences } from '../knowledge/mineru-workflow-service'
import type { ProjectContext } from '../project/project-context'
import type { ProjectManager } from '../project/project-manager'
import type { BibliographyConnectorService } from '../references/bibliography-connector-service'
import type { CitationFormattingService } from '../references/citation-formatting-service'
import {
  bibliographyChooseInputSchema,
  bibliographyPrepareImportInputSchema,
  bibliographyImportPlanSchema,
  bibliographyConfirmImportInputSchema,
  bibliographyConfirmImportResultSchema,
  bibliographyExportInputSchema,
  bibliographyExportResultSchema,
  legacyCitationConversionPlanInputSchema,
  legacyCitationConversionPlanSchema,
  legacyCitationConversionApplyInputSchema,
  legacyCitationConversionApplyResultSchema,
  bibliographySnapshotInputSchema,
  bibliographySnapshotResultSchema,
  referenceListInputSchema,
  referenceListResultSchema,
  referenceSearchInputSchema,
  referenceSearchResultSchema,
  referenceSettingsInputSchema,
  referenceCustomStyleInputSchema,
  referenceSettingsSchema,
  formattedReferenceSnapshotInputSchema,
  formattedReferenceSnapshotSchema
} from '../../shared/contracts/references'
import { authorizeSender } from './authorize-sender'
import { createBibliographyExport } from '../references/reference-bibliography-export'
import { assertInTextCslStyle } from '../../shared/csl-style'
import { normalizeCitationTitle } from '../../shared/readable-citation'
import {
  convertLegacyCitations,
  planLegacyCitationConversion
} from '../references/legacy-citation-conversion'

export interface KnowledgeIpcMain extends Pick<IpcMain, 'handle' | 'removeHandler'> {}

export function registerKnowledgeIpc(options: {
  manager: ProjectManager
  getWindow: () => BrowserWindow | null
  logger: Pick<Logger, 'info' | 'error'>
  developmentUrl?: string
  ipc?: KnowledgeIpcMain
  selectFilesForTest?: () => Promise<string[]>
  pdfPreview?: PdfPreviewCapabilities
  bibliographyConnectors?: BibliographyConnectorService
  selectBibliographyForTest?: () => Promise<string | null>
  citationFormatting?: CitationFormattingService
  selectBibliographyExportForTest?: (format: 'bibtex' | 'csl-json') => Promise<string | null>
  selectCustomStyleForTest?: () => Promise<string | null>
}): () => void {
  const ipc = options.ipc ?? ipcMain
  const legacyConversionPlans = new Map<
    string,
    {
      projectSessionId: string
      outlineVersion: number
      citationKeyByTitle: Map<string, string>
      expiresAt: number
    }
  >()

  ipc.handle(IPC_CHANNELS.knowledgeList, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = knowledgeListInputSchema.parse(input)
    return knowledgeListResultSchema.parse(
      options.manager.assertActiveSession(parsed.projectSessionId).knowledgeImports.list()
    )
  })

  ipc.handle(IPC_CHANNELS.referenceList, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = referenceListInputSchema.parse(input)
    return referenceListResultSchema.parse(
      options.manager.assertActiveSession(parsed.projectSessionId).references.list(parsed.query)
    )
  })

  ipc.handle(IPC_CHANNELS.referenceSearch, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = referenceSearchInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    const startedAt = Date.now()
    try {
      const result = referenceSearchResultSchema.parse(context.references.search(parsed.query))
      options.manager.assertActiveSession(parsed.projectSessionId)
      options.logger.info(
        {
          event: 'reference.search.completed',
          projectSessionId: parsed.projectSessionId,
          returnedItemCount: result.items.length,
          hasReferences: result.hasReferences,
          durationMs: Date.now() - startedAt
        },
        'Reference search completed'
      )
      return result
    } catch (err) {
      options.logger.error(
        {
          event: 'reference.search.failed',
          err,
          projectSessionId: parsed.projectSessionId,
          durationMs: Date.now() - startedAt
        },
        'Reference search failed'
      )
      throw new Error('References could not be searched', { cause: err })
    }
  })

  ipc.handle(IPC_CHANNELS.referenceBibliographySnapshot, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = bibliographySnapshotInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    return bibliographySnapshotResultSchema.parse(
      options.bibliographyConnectors?.snapshot(context.manifest.projectId) ?? null
    )
  })

  ipc.handle(IPC_CHANNELS.referenceChooseBibliography, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = bibliographyChooseInputSchema.parse(input)
    const context = options.manager.assertMutationSession(parsed.projectSessionId)
    if (options.bibliographyConnectors === undefined) {
      throw new Error('Bibliography connectors are unavailable')
    }
    const path = options.selectBibliographyForTest
      ? await options.selectBibliographyForTest()
      : await chooseBibliography(options.getWindow())
    options.manager.assertActiveSession(parsed.projectSessionId)
    if (path === null) {
      return bibliographySnapshotResultSchema.parse(
        options.bibliographyConnectors.snapshot(context.manifest.projectId)
      )
    }
    return bibliographySnapshotResultSchema.parse(
      await options.bibliographyConnectors.connect(context.manifest.projectId, path)
    )
  })

  ipc.handle(IPC_CHANNELS.referenceRefreshBibliography, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = bibliographySnapshotInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    if (options.bibliographyConnectors === undefined) {
      throw new Error('Bibliography connectors are unavailable')
    }
    return bibliographySnapshotResultSchema.parse(
      await options.bibliographyConnectors.refreshForProject(context.manifest.projectId)
    )
  })

  ipc.handle(IPC_CHANNELS.referencePrepareImport, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = bibliographyPrepareImportInputSchema.parse(input)
    const context = options.manager.assertMutationSession(parsed.projectSessionId)
    if (options.bibliographyConnectors === undefined) {
      throw new Error('Bibliography connectors are unavailable')
    }
    try {
      return bibliographyImportPlanSchema.parse(
        await options.bibliographyConnectors.prepareImport({
          projectId: context.manifest.projectId,
          connectorId: parsed.connectorId,
          candidateIds: new Set(parsed.candidateIds),
          includePdf: parsed.includePdf
        })
      )
    } catch (err) {
      options.logger.error(
        {
          event: 'reference.import_prepare.failed',
          err,
          projectId: context.manifest.projectId,
          connectorId: parsed.connectorId,
          candidateCount: parsed.candidateIds.length,
          includePdf: parsed.includePdf
        },
        'Failed to prepare unified Reference import'
      )
      throw new Error('REFERENCE_IMPORT_PREPARE_FAILED', { cause: err })
    }
  })

  ipc.handle(IPC_CHANNELS.referenceConfirmImport, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = bibliographyConfirmImportInputSchema.parse(input)
    const context = options.manager.assertMutationSession(parsed.projectSessionId)
    if (options.bibliographyConnectors === undefined) {
      throw new Error('Bibliography connectors are unavailable')
    }
    try {
      return bibliographyConfirmImportResultSchema.parse(
        await options.bibliographyConnectors.confirmImport({
          projectId: context.manifest.projectId,
          previewId: parsed.previewId,
          selections: parsed.selections
        })
      )
    } catch (err) {
      options.logger.error(
        {
          event: 'reference.import_confirm.failed',
          err,
          projectId: context.manifest.projectId,
          previewId: parsed.previewId,
          referenceCount: parsed.selections.length
        },
        'Failed to confirm unified Reference import'
      )
      throw new Error('REFERENCE_IMPORT_CONFIRM_FAILED', { cause: err })
    }
  })

  ipc.handle(IPC_CHANNELS.referenceExportBibliography, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = bibliographyExportInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    const citedKeys = new Set(
      context.manuscript.getReferenceIndex().entries.flatMap((entry) => entry.citationKey ?? [])
    )
    const references = context.references
      .list()
      .filter((reference) => parsed.scope === 'all-project' || citedKeys.has(reference.citationKey))
    const generated = createBibliographyExport(references, parsed.format)
    const destination = options.selectBibliographyExportForTest
      ? await options.selectBibliographyExportForTest(parsed.format)
      : await chooseBibliographyExport(options.getWindow(), parsed.format)
    options.manager.assertActiveSession(parsed.projectSessionId)
    if (destination === null) {
      return bibliographyExportResultSchema.parse({
        exported: false,
        exportedCount: 0,
        lossCount: generated.losses.length
      })
    }
    try {
      await writeFile(destination, generated.content, { encoding: 'utf8', flag: 'wx' }).catch(
        async (err: NodeJS.ErrnoException) => {
          if (err.code !== 'EEXIST') throw err
          await writeFile(destination, generated.content, 'utf8')
        }
      )
      if (generated.losses.length > 0) {
        await writeFile(
          `${destination}.losses.json`,
          `${JSON.stringify({ format: parsed.format, losses: generated.losses }, null, 2)}\n`,
          'utf8'
        )
      }
      options.logger.info(
        {
          event: 'reference.bibliography_export.completed',
          format: parsed.format,
          scope: parsed.scope,
          exportedCount: generated.exportedCount,
          lossCount: generated.losses.length
        },
        'Bibliography export completed'
      )
      return bibliographyExportResultSchema.parse({
        exported: true,
        exportedCount: generated.exportedCount,
        lossCount: generated.losses.length
      })
    } catch (err) {
      options.logger.error(
        {
          event: 'reference.bibliography_export.failed',
          err,
          format: parsed.format,
          scope: parsed.scope
        },
        'Bibliography export failed'
      )
      throw new Error('Bibliography could not be exported', { cause: err })
    }
  })

  ipc.handle(IPC_CHANNELS.referencePlanLegacyConversion, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = legacyCitationConversionPlanInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    const index = context.manuscript.getReferenceIndex()
    const planned = planLegacyCitationConversion(index, context.references.list())
    const planId = randomUUID()
    legacyConversionPlans.set(planId, {
      projectSessionId: parsed.projectSessionId,
      outlineVersion: index.outlineVersion,
      citationKeyByTitle: new Map(
        planned.replacements.map((entry) => [
          normalizeCitationTitle(entry.title),
          entry.citationKey
        ])
      ),
      expiresAt: Date.now() + 10 * 60_000
    })
    while (legacyConversionPlans.size > 16) {
      const oldest = legacyConversionPlans.keys().next().value
      if (oldest === undefined) break
      legacyConversionPlans.delete(oldest)
    }
    return legacyCitationConversionPlanSchema.parse({ planId, ...planned })
  })

  ipc.handle(IPC_CHANNELS.referenceApplyLegacyConversion, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = legacyCitationConversionApplyInputSchema.parse(input)
    const context = options.manager.assertMutationSession(parsed.projectSessionId)
    const plan = legacyConversionPlans.get(parsed.planId)
    legacyConversionPlans.delete(parsed.planId)
    if (
      plan === undefined ||
      plan.projectSessionId !== parsed.projectSessionId ||
      plan.expiresAt < Date.now() ||
      context.manuscript.getReferenceIndex().outlineVersion !== plan.outlineVersion
    ) {
      throw new Error('Legacy citation conversion plan is stale')
    }
    let sectionsChanged = 0
    for (const entry of context.manuscript.assemble().sections) {
      const content = convertLegacyCitations(entry.revision.content, plan.citationKeyByTitle)
      const revision = context.manuscript.appendRevision({
        sectionId: entry.section.sectionId,
        baseRevisionId: entry.revision.sectionRevisionId,
        baseContentHash: entry.revision.contentHash,
        content,
        source: 'manual',
        sourceClass: 'manual_checkpoint'
      })
      if (revision.sectionRevisionId !== entry.revision.sectionRevisionId) sectionsChanged += 1
    }
    options.logger.info(
      {
        event: 'reference.legacy_conversion.completed',
        sectionsChanged,
        replacementCount: plan.citationKeyByTitle.size
      },
      'Legacy citations converted after explicit confirmation'
    )
    return legacyCitationConversionApplyResultSchema.parse({ sectionsChanged })
  })

  ipc.handle(IPC_CHANNELS.referenceGetSettings, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = bibliographySnapshotInputSchema.parse(input)
    return referenceSettingsSchema.parse(
      options.manager.assertActiveSession(parsed.projectSessionId).references.settings()
    )
  })

  ipc.handle(IPC_CHANNELS.referenceSetSettings, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = referenceSettingsInputSchema.parse(input)
    return referenceSettingsSchema.parse(
      options.manager
        .assertMutationSession(parsed.projectSessionId)
        .references.setSettings(parsed.styleId, parsed.locale)
    )
  })

  ipc.handle(IPC_CHANNELS.referenceChooseCustomStyle, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = referenceCustomStyleInputSchema.parse(input)
    const context = options.manager.assertMutationSession(parsed.projectSessionId)
    const path = options.selectCustomStyleForTest
      ? await options.selectCustomStyleForTest()
      : await chooseCustomStyle(options.getWindow())
    if (path === null) return referenceSettingsSchema.parse(context.references.settings())
    try {
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > 1024 * 1024) {
        throw new Error('Custom CSL must be a bounded regular file')
      }
      const xml = await readFile(path, 'utf8')
      assertInTextCslStyle(xml)
      const sha256 = createHash('sha256').update(xml).digest('hex')
      const relativePath = `.writellm/references/styles/${sha256}.csl`
      await context.filesystem.ensureDirectory('.writellm/references/styles')
      try {
        const created = await context.filesystem.createExclusiveFile(relativePath)
        try {
          await created.handle.writeFile(xml, 'utf8')
          await created.handle.sync()
        } finally {
          await created.handle.close()
        }
      } catch (err) {
        if ((err as { code?: string }).code !== 'path_exists') throw err
        const existing = await readFile(
          await context.filesystem.assertExistingRegularFile(relativePath),
          'utf8'
        )
        if (createHash('sha256').update(existing).digest('hex') !== sha256) {
          throw new Error('Existing custom CSL resource failed integrity verification')
        }
      }
      return referenceSettingsSchema.parse(context.references.setCustomStyle(relativePath, sha256))
    } catch (err) {
      options.logger.error(
        { event: 'reference.custom_style_import.failed', err },
        'Custom CSL style import failed'
      )
      throw new Error('Custom CSL style could not be imported', { cause: err })
    }
  })

  ipc.handle(IPC_CHANNELS.referenceFormatSnapshot, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = formattedReferenceSnapshotInputSchema.parse(input)
    if (options.citationFormatting === undefined) {
      throw new Error('Citation formatting is unavailable')
    }
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    const result = await options.citationFormatting.format(context)
    options.manager.assertActiveSession(parsed.projectSessionId)
    return formattedReferenceSnapshotSchema.parse(result)
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

  ipc.handle(IPC_CHANNELS.knowledgeCitationCoveragePage, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = knowledgeCitationCoveragePageInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    const startedAt = Date.now()
    if (context.projectIndex === null) {
      const result = knowledgeCitationCoveragePageResultSchema.parse({
        state: 'unavailable',
        reason: 'index_unavailable'
      })
      options.logger.info(
        {
          event: 'knowledge.citation_coverage.completed',
          projectSessionId: parsed.projectSessionId,
          filter: parsed.filter,
          state: result.state,
          durationMs: Date.now() - startedAt
        },
        'Knowledge citation coverage page loaded'
      )
      return result
    }
    const controller = new AbortController()
    const release = context.operations?.track(controller)
    try {
      const service = new KnowledgeCitationCoverageService({
        manuscript: context.manuscript,
        projectIndex: context.projectIndex,
        references: context.references
      })
      const result = knowledgeCitationCoveragePageResultSchema.parse(
        await service.page(
          {
            filter: parsed.filter,
            query: parsed.query,
            ...(parsed.cursor === undefined ? {} : { cursor: parsed.cursor }),
            limit: parsed.limit
          },
          controller.signal
        )
      )
      options.manager.assertActiveSession(parsed.projectSessionId)
      options.logger.info(
        {
          event: 'knowledge.citation_coverage.completed',
          projectSessionId: parsed.projectSessionId,
          filter: parsed.filter,
          state: result.state,
          ...(result.state === 'ready'
            ? {
                indexGenerationId: result.indexGenerationId,
                indexedSourceCount: result.summary.indexedSourceCount,
                citedSourceCount: result.summary.citedSourceCount,
                attentionCount: result.summary.attentionCount,
                returnedItemCount: result.items.length
              }
            : {}),
          durationMs: Date.now() - startedAt
        },
        'Knowledge citation coverage page loaded'
      )
      return result
    } catch (err) {
      options.logger.error(
        {
          event: 'knowledge.citation_coverage.failed',
          err,
          projectSessionId: parsed.projectSessionId,
          filter: parsed.filter,
          durationMs: Date.now() - startedAt
        },
        'Knowledge citation coverage page failed'
      )
      throw new Error('Knowledge citation coverage could not be loaded', { cause: err })
    } finally {
      release?.()
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
    const absolutePath = await context.filesystem.assertExistingRegularFile(
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
      const absolutePath = await context.filesystem.assertExistingRegularFile(relativePath)
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

  ipc.handle(IPC_CHANNELS.knowledgeParsedMetadata, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = knowledgeItemActionInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    if (context.knowledgeNormalization === null) throw new Error('Parsed knowledge is unavailable')
    try {
      const result = await context.knowledgeNormalization.metadata(parsed.knowledgeItemId)
      options.manager.assertActiveSession(parsed.projectSessionId)
      return parsedKnowledgeMetadataSchema.parse(result)
    } catch (err) {
      options.logger.error(
        { event: 'knowledge.parsed_metadata.failed', err, knowledgeItemId: parsed.knowledgeItemId },
        'Failed to load parsed knowledge metadata'
      )
      throw new Error('Parsed knowledge metadata could not be loaded', { cause: err })
    }
  })

  ipc.handle(IPC_CHANNELS.knowledgeParsedBlocks, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = parsedKnowledgeBlockPageInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    if (context.knowledgeNormalization === null) throw new Error('Parsed knowledge is unavailable')
    try {
      const result = await context.knowledgeNormalization.blockPage(
        parsed.knowledgeItemId,
        parsed.parseRevisionId,
        parsed.cursor,
        parsed.limit
      )
      options.manager.assertActiveSession(parsed.projectSessionId)
      return parsedKnowledgeBlockPageSchema.parse(result)
    } catch (err) {
      options.logger.error(
        { event: 'knowledge.parsed_blocks.failed', err, knowledgeItemId: parsed.knowledgeItemId },
        'Failed to load parsed knowledge blocks'
      )
      throw new Error('Parsed knowledge blocks could not be loaded', { cause: err })
    }
  })

  ipc.handle(IPC_CHANNELS.knowledgeParsedMarkdown, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = parsedKnowledgeMarkdownInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    if (context.knowledgeNormalization === null) throw new Error('Parsed knowledge is unavailable')
    try {
      const result = await context.knowledgeNormalization.markdown(
        parsed.knowledgeItemId,
        parsed.parseRevisionId
      )
      options.manager.assertActiveSession(parsed.projectSessionId)
      return parsedKnowledgeMarkdownSchema.parse(result)
    } catch (err) {
      options.logger.error(
        { event: 'knowledge.parsed_markdown.failed', err, knowledgeItemId: parsed.knowledgeItemId },
        'Failed to load parsed knowledge Markdown'
      )
      throw new Error('Parsed knowledge Markdown could not be loaded', { cause: err })
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
      IPC_CHANNELS.knowledgeCitationCoveragePage,
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
      IPC_CHANNELS.knowledgeParsedMetadata,
      IPC_CHANNELS.knowledgeParsedBlocks,
      IPC_CHANNELS.knowledgeParsedMarkdown,
      IPC_CHANNELS.knowledgeParsedAsset,
      IPC_CHANNELS.referenceList,
      IPC_CHANNELS.referenceSearch,
      IPC_CHANNELS.referenceChooseBibliography,
      IPC_CHANNELS.referenceBibliographySnapshot,
      IPC_CHANNELS.referenceRefreshBibliography,
      IPC_CHANNELS.referencePrepareImport,
      IPC_CHANNELS.referenceConfirmImport,
      IPC_CHANNELS.referenceExportBibliography,
      IPC_CHANNELS.referencePlanLegacyConversion,
      IPC_CHANNELS.referenceApplyLegacyConversion,
      IPC_CHANNELS.referenceGetSettings,
      IPC_CHANNELS.referenceSetSettings,
      IPC_CHANNELS.referenceChooseCustomStyle,
      IPC_CHANNELS.referenceFormatSnapshot
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

async function chooseBibliography(owner: BrowserWindow | null): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile'],
    filters: [{ name: 'Zotero bibliography', extensions: ['json', 'bib'] }]
  }
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

async function chooseBibliographyExport(
  owner: BrowserWindow | null,
  format: 'bibtex' | 'csl-json'
): Promise<string | null> {
  const extension = format === 'bibtex' ? 'bib' : 'json'
  const options: Electron.SaveDialogOptions = {
    defaultPath: `references.${extension}`,
    filters: [
      {
        name: format === 'bibtex' ? 'BibTeX bibliography' : 'CSL JSON bibliography',
        extensions: [extension]
      }
    ]
  }
  const result = owner
    ? await dialog.showSaveDialog(owner, options)
    : await dialog.showSaveDialog(options)
  return result.canceled ? null : (result.filePath ?? null)
}

async function chooseCustomStyle(owner: BrowserWindow | null): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile'],
    filters: [{ name: 'CSL citation style', extensions: ['csl'] }]
  }
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}
