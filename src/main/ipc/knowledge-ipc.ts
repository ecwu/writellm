import { reportIpcFailure } from '../observability/ipc-context'
import { dialog, ipcMain, shell, type BrowserWindow, type IpcMain } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, stat, writeFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import type { SectionRevision } from '../../shared/contracts/manuscript'
import { knowledgeIpcEndpoints } from '../../shared/contracts/ipc-endpoints-knowledge'
import { SUPPORTED_KNOWLEDGE_EXTENSIONS } from '../../shared/contracts/knowledge'
import type { PdfPreviewCapabilities } from '../knowledge/pdf-preview-capabilities'
import { KnowledgeCitationCoverageService } from '../knowledge/knowledge-citation-coverage-service'
import type { MineruWorkReferences } from '../knowledge/mineru-workflow-service'
import type { ProjectContext } from '../project/project-context'
import type { ProjectManager } from '../project/project-manager'
import type { BibliographyConnectorService } from '../references/bibliography-connector-service'
import type { CitationFormattingService } from '../references/citation-formatting-service'
import { createEndpointRegistrar } from './endpoint'
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
  logger: Pick<Logger, 'info' | 'warn' | 'error'>
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
  const handle = createEndpointRegistrar(ipc, {
    developmentUrl: options.developmentUrl,
    manager: options.manager
  })

  handle(knowledgeIpcEndpoints.list, (_parsed, context) => {
    return context.knowledgeImports.list()
  })

  handle(knowledgeIpcEndpoints.listReferences, (parsed, context) => {
    return context.references.list(parsed.query)
  })

  handle(knowledgeIpcEndpoints.searchReferences, (parsed, context) => {
    const startedAt = Date.now()
    try {
      const result = context.references.search(parsed.query)
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
      reportIpcFailure(
        options.logger,
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

  handle(knowledgeIpcEndpoints.bibliographySnapshot, (_parsed, context) => {
    return options.bibliographyConnectors?.snapshot(context.manifest.projectId) ?? null
  })

  handle(knowledgeIpcEndpoints.chooseBibliography, async (parsed, context) => {
    if (options.bibliographyConnectors === undefined) {
      throw new Error('Bibliography connectors are unavailable')
    }
    const path = options.selectBibliographyForTest
      ? await options.selectBibliographyForTest()
      : await chooseBibliography(options.getWindow())
    options.manager.assertActiveSession(parsed.projectSessionId)
    if (path === null) {
      return options.bibliographyConnectors.snapshot(context.manifest.projectId)
    }
    return await options.bibliographyConnectors.connect(context.manifest.projectId, path)
  })

  handle(knowledgeIpcEndpoints.refreshBibliography, async (_parsed, context) => {
    if (options.bibliographyConnectors === undefined) {
      throw new Error('Bibliography connectors are unavailable')
    }
    return await options.bibliographyConnectors.refreshForProject(context.manifest.projectId)
  })

  handle(knowledgeIpcEndpoints.prepareReferenceImport, async (parsed, context) => {
    if (options.bibliographyConnectors === undefined) {
      throw new Error('Bibliography connectors are unavailable')
    }
    try {
      return await options.bibliographyConnectors.prepareImport({
        projectId: context.manifest.projectId,
        projectSessionId: parsed.projectSessionId,
        connectorId: parsed.connectorId,
        candidateIds: new Set(parsed.candidateIds),
        includePdf: parsed.includePdf
      })
    } catch (err) {
      reportIpcFailure(
        options.logger,
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

  handle(knowledgeIpcEndpoints.referenceImportAttachmentsPage, async (parsed, context) => {
    if (options.bibliographyConnectors === undefined) {
      throw new Error('Bibliography connectors are unavailable')
    }
    return await options.bibliographyConnectors.importAttachmentsPage({
      projectId: context.manifest.projectId,
      projectSessionId: parsed.projectSessionId,
      previewId: parsed.previewId,
      candidateId: parsed.candidateId,
      cursor: parsed.cursor
    })
  })

  handle(knowledgeIpcEndpoints.confirmReferenceImport, async (parsed, context) => {
    if (options.bibliographyConnectors === undefined) {
      throw new Error('Bibliography connectors are unavailable')
    }
    try {
      return await options.bibliographyConnectors.confirmImport({
        projectId: context.manifest.projectId,
        previewId: parsed.previewId,
        selections: parsed.selections
      })
    } catch (err) {
      reportIpcFailure(
        options.logger,
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

  handle(knowledgeIpcEndpoints.exportBibliography, async (parsed, context) => {
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
      return {
        exported: false,
        exportedCount: 0,
        lossCount: generated.losses.length
      }
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
      return {
        exported: true,
        exportedCount: generated.exportedCount,
        lossCount: generated.losses.length
      }
    } catch (err) {
      reportIpcFailure(
        options.logger,
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

  handle(knowledgeIpcEndpoints.planLegacyCitationConversion, (parsed, context) => {
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
    return { planId, ...planned }
  })

  handle(knowledgeIpcEndpoints.applyLegacyCitationConversion, async (parsed) => {
    const plan = legacyConversionPlans.get(parsed.planId)
    legacyConversionPlans.delete(parsed.planId)
    let context: ProjectContext
    try {
      context = options.manager.assertMutationSession(parsed.projectSessionId)
    } catch (err) {
      reportIpcFailure(
        options.logger,
        {
          event: 'reference.legacy_conversion.failed',
          err,
          projectSessionId: parsed.projectSessionId
        },
        'Legacy citation conversion could not start'
      )
      throw new Error('Legacy citations could not be converted', { cause: err })
    }
    let status: 'converted' | 'failed' = 'converted'
    const revisions: SectionRevision[] = []
    const pendingRepairSectionIds: string[] = []
    let failureOwner: 'handler' | 'manuscript' = 'handler'
    try {
      if (
        plan === undefined ||
        plan.projectSessionId !== parsed.projectSessionId ||
        plan.expiresAt < Date.now() ||
        context.manuscript.getReferenceIndex().outlineVersion !== plan.outlineVersion
      ) {
        const err = new Error('Legacy citation conversion plan is stale')
        options.logger.error(
          {
            event: 'reference.legacy_conversion.stale_plan',
            err,
            projectSessionId: parsed.projectSessionId
          },
          'Legacy citation conversion needs a new plan'
        )
        return {
          status: 'stale_plan' as const,
          sectionsChanged: 0,
          pendingRepairSectionIds: []
        }
      }
      for (const entry of context.manuscript.assemble().sections) {
        const content = convertLegacyCitations(entry.revision.content, plan.citationKeyByTitle)
        // appendRevision records its original failure. The handler owns other failures.
        failureOwner = 'manuscript'
        const revision = context.manuscript.appendRevision({
          sectionId: entry.section.sectionId,
          baseRevisionId: entry.revision.sectionRevisionId,
          baseContentHash: entry.revision.contentHash,
          content,
          source: 'manual',
          sourceClass: 'manual_checkpoint'
        })
        failureOwner = 'handler'
        if (revision.sectionRevisionId !== entry.revision.sectionRevisionId)
          revisions.push(revision)
      }
    } catch (err) {
      if (failureOwner === 'handler') {
        reportIpcFailure(
          options.logger,
          {
            event: 'reference.legacy_conversion.failed',
            err,
            projectSessionId: parsed.projectSessionId,
            sectionsChanged: revisions.length
          },
          'Legacy citation conversion stopped. Committed revisions remain saved'
        )
      }
      status = 'failed'
    }
    // Finish all synchronous commits before publication can yield to another mutation.
    for (const revision of revisions) {
      try {
        const assertAuthorized = (): void => {
          options.manager.assertActiveSession(parsed.projectSessionId)
        }
        assertAuthorized()
        await context.editorPersistence.materialize(revision, assertAuthorized)
        assertAuthorized()
        context.editorPersistence.pruneRevisionBodies(revision.sectionId)
      } catch (err) {
        pendingRepairSectionIds.push(revision.sectionId)
        reportIpcFailure(
          options.logger,
          {
            event: 'reference.legacy_conversion.materialization_pending',
            err,
            projectSessionId: parsed.projectSessionId,
            sectionId: revision.sectionId,
            sectionRevisionId: revision.sectionRevisionId
          },
          'Converted revision remains saved. Its section mirror needs repair'
        )
      }
    }
    options.logger.info(
      {
        event:
          status === 'converted'
            ? 'reference.legacy_conversion.completed'
            : 'reference.legacy_conversion.partial',
        sectionsChanged: revisions.length,
        pendingRepairCount: pendingRepairSectionIds.length,
        replacementCount: plan?.citationKeyByTitle.size ?? 0
      },
      'Legacy citation conversion result recorded'
    )
    return {
      status,
      sectionsChanged: revisions.length,
      pendingRepairSectionIds
    }
  })

  handle(knowledgeIpcEndpoints.referenceSettings, (_parsed, context) => {
    return context.references.settings()
  })

  handle(knowledgeIpcEndpoints.setReferenceSettings, (parsed) => {
    return options.manager
      .assertMutationSession(parsed.projectSessionId)
      .references.setSettings(parsed.styleId, parsed.locale)
  })

  handle(knowledgeIpcEndpoints.chooseCustomReferenceStyle, async (_parsed, context) => {
    const path = options.selectCustomStyleForTest
      ? await options.selectCustomStyleForTest()
      : await chooseCustomStyle(options.getWindow())
    if (path === null) return context.references.settings()
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
      return context.references.setCustomStyle(relativePath, sha256)
    } catch (err) {
      reportIpcFailure(
        options.logger,
        { event: 'reference.custom_style_import.failed', err },
        'Custom CSL style import failed'
      )
      throw new Error('Custom CSL style could not be imported', { cause: err })
    }
  })

  handle(knowledgeIpcEndpoints.formatReferences, async (parsed, context) => {
    if (options.citationFormatting === undefined) {
      throw new Error('Citation formatting is unavailable')
    }
    const result = await options.citationFormatting.format(context)
    options.manager.assertActiveSession(parsed.projectSessionId)
    return result
  })

  handle(knowledgeIpcEndpoints.indexStatus, async (parsed, context) => {
    const readiness = context.projectIndex.readiness()
    if (readiness !== 'available') {
      return { readiness, indexed: false }
    }
    try {
      const indexed = await context.projectIndex.isCurrentGenerationIndexed()
      options.manager.assertActiveSession(parsed.projectSessionId)
      return { readiness, indexed }
    } catch (err) {
      reportIpcFailure(
        options.logger,
        { event: 'knowledge.index_status.failed', err, projectSessionId: parsed.projectSessionId },
        'Failed to inspect knowledge index status'
      )
      throw new Error('Knowledge index status could not be loaded', { cause: err })
    }
  })

  handle(knowledgeIpcEndpoints.citationCoveragePage, async (parsed, context) => {
    const startedAt = Date.now()
    const controller = new AbortController()
    const release = context.operations?.track(controller)
    try {
      const service = new KnowledgeCitationCoverageService({
        manuscript: context.manuscript,
        projectIndex: context.projectIndex,
        references: context.references
      })
      const result = await service.page(
        {
          filter: parsed.filter,
          query: parsed.query,
          ...(parsed.cursor === undefined ? {} : { cursor: parsed.cursor }),
          limit: parsed.limit
        },
        controller.signal
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
      reportIpcFailure(
        options.logger,
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

  handle(knowledgeIpcEndpoints.chooseAndImport, async (parsed, context) => {
    const paths = options.selectFilesForTest
      ? await options.selectFilesForTest()
      : await chooseFiles(options.getWindow())
    options.manager.assertActiveSession(parsed.projectSessionId)
    if (paths.length === 0) return context.knowledgeImports.list()
    try {
      await context.knowledgeImports.startImportPaths(paths)
      options.manager.assertActiveSession(parsed.projectSessionId)
      return context.knowledgeImports.list()
    } catch (err) {
      reportIpcFailure(
        options.logger,
        { event: 'knowledge.import_batch.failed', err, projectSessionId: parsed.projectSessionId },
        'Knowledge batch import failed'
      )
      throw new Error('One or more selected files could not be imported', { cause: err })
    }
  })

  handle(knowledgeIpcEndpoints.importDropped, async (parsed, context) => {
    try {
      await context.knowledgeImports.startImportPaths(parsed.paths)
      options.manager.assertActiveSession(parsed.projectSessionId)
      return context.knowledgeImports.list()
    } catch (err) {
      reportIpcFailure(
        options.logger,
        { event: 'knowledge.drop_import.failed', err, projectSessionId: parsed.projectSessionId },
        'Dropped knowledge import failed'
      )
      throw new Error('One or more dropped files could not be imported', { cause: err })
    }
  })

  handle(knowledgeIpcEndpoints.cancel, (parsed, context) => {
    const service = context.knowledgeImports
    service.cancel(parsed.knowledgeItemId)
    return service.list()
  })

  handle(knowledgeIpcEndpoints.delete, async (parsed, context) => {
    const references = context.mineruWorkflow.cancelForKnowledgeItem(parsed.knowledgeItemId)
    cancelMineruJobs(context, references)
    await context.mineruWorkflow.cleanupAllArtifacts(parsed.knowledgeItemId, references)
    await context.knowledgeImports.delete(parsed.knowledgeItemId)
    options.manager.assertActiveSession(parsed.projectSessionId)
    return context.knowledgeImports.list()
  })

  /** Report original-file failures, including session rejections, behind one safe error. */
  const originalFileBoundary =
    (event: string, message: string, failure: string) =>
    async <T>(_parsed: unknown, run: () => Promise<T>): Promise<T> => {
      try {
        return await run()
      } catch (err) {
        reportIpcFailure(options.logger, { event, err }, message)
        throw new Error(failure, { cause: err })
      }
    }
  const openOriginal = async (
    parsed: { knowledgeItemId: string },
    context: ProjectContext,
    reveal: boolean
  ): Promise<void> => {
    const absolutePath = await context.filesystem.assertExistingRegularFile(
      context.knowledgeImports.originalRelativePath(parsed.knowledgeItemId)
    )
    if (reveal) shell.showItemInFolder(absolutePath)
    else {
      const error = await shell.openPath(absolutePath)
      if (error) throw new Error('The original file could not be opened')
    }
  }

  handle(knowledgeIpcEndpoints.reveal, (parsed, context) => openOriginal(parsed, context, true), {
    around: originalFileBoundary(
      'knowledge.original_reveal.failed',
      'Reveal original failed',
      'The original file could not be revealed'
    )
  })
  handle(
    knowledgeIpcEndpoints.openOriginal,
    (parsed, context) => openOriginal(parsed, context, false),
    {
      around: originalFileBoundary(
        'knowledge.original_open.failed',
        'Open original failed',
        'The original file could not be opened'
      )
    }
  )

  handle(knowledgeIpcEndpoints.startParse, async (parsed, context) => {
    try {
      await context.mineruWorkflow.start(parsed.knowledgeItemId)
      options.manager.assertActiveSession(parsed.projectSessionId)
    } catch (err) {
      reportIpcFailure(
        options.logger,
        { event: 'knowledge.parse_start.failed', err, knowledgeItemId: parsed.knowledgeItemId },
        'Failed to start knowledge parsing'
      )
      throw new Error('Knowledge parsing could not be started', { cause: err })
    }
  })

  handle(knowledgeIpcEndpoints.cancelParse, async (parsed, context) => {
    try {
      const references = context.mineruWorkflow.cancelForKnowledgeItem(parsed.knowledgeItemId)
      cancelMineruJobs(context, references)
      await context.mineruWorkflow.cleanupCancelledArtifacts(parsed.knowledgeItemId, references)
      options.manager.assertActiveSession(parsed.projectSessionId)
    } catch (err) {
      reportIpcFailure(
        options.logger,
        { event: 'knowledge.parse_cancel.failed', err, knowledgeItemId: parsed.knowledgeItemId },
        'Failed to cancel knowledge parsing'
      )
      throw new Error('Knowledge parsing could not be cancelled', { cause: err })
    }
  })

  handle(knowledgeIpcEndpoints.refreshEmbeddings, async (parsed, context) => {
    try {
      await context.projectIndex.requestEmbeddingRefresh(parsed.knowledgeItemId)
      options.manager.assertActiveSession(parsed.projectSessionId)
    } catch (err) {
      reportIpcFailure(
        options.logger,
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

  handle(knowledgeIpcEndpoints.createPdfPreview, async (parsed, context) => {
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
      return options.pdfPreview.issue({
        projectSessionId: parsed.projectSessionId,
        knowledgeItemId: parsed.knowledgeItemId,
        absolutePath,
        byteSize: file.size,
        sourceSha256: item.sha256
      })
    } catch (err) {
      reportIpcFailure(
        options.logger,
        { event: 'knowledge.pdf_preview.failed', err, knowledgeItemId: parsed.knowledgeItemId },
        'Failed to create PDF preview capability'
      )
      throw new Error('PDF preview could not be created', { cause: err })
    }
  })

  handle(knowledgeIpcEndpoints.releasePdfPreview, (parsed, _context) => {
    options.pdfPreview?.revoke(parsed.previewId, parsed.projectSessionId)
  })

  handle(knowledgeIpcEndpoints.mappingPage, async (parsed, context) => {
    try {
      const result = await context.knowledgeMapping.page(parsed.knowledgeItemId, parsed.pageIndex)
      options.manager.assertActiveSession(parsed.projectSessionId)
      return result
    } catch (err) {
      reportIpcFailure(
        options.logger,
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

  handle(knowledgeIpcEndpoints.parsedMetadata, async (parsed, context) => {
    try {
      const result = await context.knowledgeNormalization.metadata(parsed.knowledgeItemId)
      options.manager.assertActiveSession(parsed.projectSessionId)
      return result
    } catch (err) {
      reportIpcFailure(
        options.logger,
        { event: 'knowledge.parsed_metadata.failed', err, knowledgeItemId: parsed.knowledgeItemId },
        'Failed to load parsed knowledge metadata'
      )
      throw new Error('Parsed knowledge metadata could not be loaded', { cause: err })
    }
  })

  handle(knowledgeIpcEndpoints.parsedBlocks, async (parsed, context) => {
    try {
      const result = await context.knowledgeNormalization.blockPage(
        parsed.knowledgeItemId,
        parsed.parseRevisionId,
        parsed.cursor,
        parsed.limit
      )
      options.manager.assertActiveSession(parsed.projectSessionId)
      return result
    } catch (err) {
      reportIpcFailure(
        options.logger,
        { event: 'knowledge.parsed_blocks.failed', err, knowledgeItemId: parsed.knowledgeItemId },
        'Failed to load parsed knowledge blocks'
      )
      throw new Error('Parsed knowledge blocks could not be loaded', { cause: err })
    }
  })

  handle(knowledgeIpcEndpoints.parsedMarkdown, async (parsed, context) => {
    try {
      const result = await context.knowledgeNormalization.markdown(
        parsed.knowledgeItemId,
        parsed.parseRevisionId
      )
      options.manager.assertActiveSession(parsed.projectSessionId)
      return result
    } catch (err) {
      reportIpcFailure(
        options.logger,
        { event: 'knowledge.parsed_markdown.failed', err, knowledgeItemId: parsed.knowledgeItemId },
        'Failed to load parsed knowledge Markdown'
      )
      throw new Error('Parsed knowledge Markdown could not be loaded', { cause: err })
    }
  })

  handle(knowledgeIpcEndpoints.parsedAsset, async (parsed, context) => {
    try {
      const result = await context.knowledgeNormalization.asset(
        parsed.knowledgeItemId,
        parsed.parseRevisionId,
        parsed.assetRef
      )
      options.manager.assertActiveSession(parsed.projectSessionId)
      return result
    } catch (err) {
      reportIpcFailure(
        options.logger,
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
      IPC_CHANNELS.referenceImportAttachmentsPage,
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
  for (const job of cancelled) context.runtime.cancel(job.jobId)
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
  return result.canceled ? [] : result.filePaths
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
