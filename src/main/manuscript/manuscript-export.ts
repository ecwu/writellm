import { createHash, randomUUID } from 'node:crypto'
import { access, lstat, mkdir, readFile, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type { Logger } from 'pino'
import {
  MANUSCRIPT_EXPORT_FORMAT,
  MANUSCRIPT_EXPORT_FORMAT_VERSION,
  MANUSCRIPT_EXPORT_MANIFEST_FILE,
  MANUSCRIPT_LOSS_REPORT_FILE,
  MANUSCRIPT_MARKDOWN_CONTENT_FILE,
  MANUSCRIPT_PANDOC_REFERENCES_FILE,
  MANUSCRIPT_DOCX_CONTENT_FILE,
  MANUSCRIPT_LATEX_CONTENT_FILE,
  MANUSCRIPT_PDF_CONTENT_FILE,
  MANUSCRIPT_NATIVE_CONTENT_FILE,
  manuscriptExportManifestSchema,
  manuscriptMarkdownLossReportSchema,
  manuscriptNativeExportSchema,
  type ManuscriptExportAsset,
  type ManuscriptExportKind,
  type ManuscriptExportManifest,
  type ManuscriptMarkdownLossReport
} from '../../shared/contracts/manuscript-export'
import type { ManuscriptAssembly } from '../../shared/contracts/manuscript'
import {
  buildPublicationAssembly,
  type PublicationOptions
} from '../../shared/contracts/publication'
import { normalizeCitationTitle } from '../../shared/readable-citation'
import { manuscriptToMarkdown, manuscriptToPandocMarkdown } from '../../shared/manuscript-markdown'
import type { ProjectDatabase } from '../project/project-database'
import type { SnapshotBarrier } from '../project/project-snapshot'
import {
  MANUSCRIPT_ASSETS_DIRECTORY,
  resolveExistingProjectPath,
  resolveProjectPath
} from '../project/project-paths'
import { writeAtomicFile } from '../storage/atomic-file'
import type { ManuscriptAssetService } from './asset-service'
import type { ManuscriptService } from './manuscript-service'
import { renderDocxPublication } from './docx-publication'
import { renderLatexPublication } from './latex-publication'
import type { PdfPublicationRenderer } from './pdf-publication'

const MAX_REFERENCED_ASSETS = 10_000

export interface PublishedManuscriptExport {
  manifest: ManuscriptExportManifest
  packageName: string
  lossReport?: ManuscriptMarkdownLossReport
}

export async function createManuscriptExport(options: {
  projectRoot: string
  projectId: string
  sourceAppVersion: string
  destination: string
  kind: ManuscriptExportKind
  manuscript: ManuscriptService
  assets: ManuscriptAssetService
  database: ProjectDatabase
  barrier: SnapshotBarrier
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  now?: () => Date
  createId?: () => string
  renderPdf?: PdfPublicationRenderer
  publicationOptions?: PublicationOptions
  signal?: AbortSignal
}): Promise<PublishedManuscriptExport> {
  const startedAt = Date.now()
  throwIfAborted(options.signal)
  if (!isAbsolute(options.destination)) {
    throw new Error('Manuscript export destination must be absolute')
  }
  const parent = dirname(options.destination)
  const packageName = basename(options.destination)
  if (packageName === '' || packageName === '.' || packageName === '..') {
    throw new Error('Manuscript export destination is invalid')
  }
  const canonicalParent = await realpath(parent)
  const destination = join(canonicalParent, packageName)
  const stage = join(
    canonicalParent,
    `.${safeStagePrefix(packageName)}.${(options.createId ?? randomUUID)()}.export.partial`
  )
  let mutationsPaused = false
  let publishersPaused = false
  options.log.info(
    {
      event: 'manuscript.export.started',
      projectId: options.projectId,
      exportKind: options.kind
    },
    'Whole-manuscript export started'
  )
  try {
    await ensureAbsent(destination)
    await mkdir(stage, { mode: 0o700 })
    await options.barrier.pauseMutations()
    mutationsPaused = true
    await options.barrier.finalEditorFlush()
    await options.barrier.pauseFilePublishers()
    publishersPaused = true
    throwIfAborted(options.signal)

    const assembly = options.manuscript.assemble()
    const exportedAssets = await captureAssets({
      assembly,
      projectRoot: options.projectRoot,
      database: options.database,
      assets: options.assets,
      signal: options.signal
    })
    throwIfAborted(options.signal)
    await publishAssets(stage, exportedAssets)

    const assets = exportedAssets.map(({ exportRecord }) => exportRecord)
    const assetInventorySha256 = sha256(canonicalJson(assets))
    let content: { relativePath: string; sha256: string; byteSize: number }
    let lossReport: ManuscriptMarkdownLossReport | undefined
    let lossReportRecord: ManuscriptExportManifest['lossReport']
    let bibliographyRecord: ManuscriptExportManifest['bibliography']
    let publicationSourceHash: string | undefined

    if (options.kind === 'native') {
      const native = manuscriptNativeExportSchema.parse({
        exportFormat: MANUSCRIPT_EXPORT_FORMAT,
        exportFormatVersion: MANUSCRIPT_EXPORT_FORMAT_VERSION,
        manuscript: assembly,
        assets
      })
      const bytes = Buffer.from(`${canonicalJson(native)}\n`)
      content = await publishContent(stage, MANUSCRIPT_NATIVE_CONTENT_FILE, bytes)
    } else if (options.kind === 'markdown' || options.kind === 'pandoc') {
      const pathsByLogicalUrl = new Map(
        assets.map((asset) => [asset.logicalUrl, asset.relativePath] as const)
      )
      const converted = (
        options.kind === 'pandoc' ? manuscriptToPandocMarkdown : manuscriptToMarkdown
      )(assembly, (logicalUrl) => {
        const path = pathsByLogicalUrl.get(logicalUrl)
        if (path === undefined) throw new Error('Markdown references an uncaptured asset')
        return path
      })
      lossReport = manuscriptMarkdownLossReportSchema.parse(converted.lossReport)
      content = await publishContent(
        stage,
        MANUSCRIPT_MARKDOWN_CONTENT_FILE,
        Buffer.from(converted.markdown)
      )
      const lossBytes = Buffer.from(`${canonicalJson(lossReport)}\n`)
      const publishedLosses = await publishContent(stage, MANUSCRIPT_LOSS_REPORT_FILE, lossBytes)
      lossReportRecord = { ...publishedLosses, lossCount: lossReport.losses.length }
      if (options.kind === 'pandoc') {
        const citedKeys = new Set(
          options.manuscript.getReferenceIndex().entries.flatMap((entry) => entry.citationKey ?? [])
        )
        const cslItems = options.database.immediate((database) =>
          (
            database
              .prepare('SELECT citation_key, csl_json FROM reference_items ORDER BY citation_key')
              .all() as Array<{ citation_key: string; csl_json: string }>
          )
            .filter((row) => citedKeys.has(row.citation_key))
            .map((row) => JSON.parse(row.csl_json) as unknown)
        )
        bibliographyRecord = await publishContent(
          stage,
          MANUSCRIPT_PANDOC_REFERENCES_FILE,
          Buffer.from(`${JSON.stringify(cslItems, null, 2)}\n`)
        )
      }
    } else {
      const references = options.manuscript.getReferenceIndex()
      const availableReferenceTitles = options.database.immediate(
        (database) =>
          new Set(
            (
              database
                .prepare("SELECT display_name FROM knowledge_items WHERE state = 'stored'")
                .pluck()
                .all() as string[]
            ).map(normalizeCitationTitle)
          )
      )
      const publication = buildPublicationAssembly({
        manuscript: assembly,
        references,
        assets: exportedAssets.map((asset) => ({
          assetId: asset.exportRecord.assetId,
          logicalUrl: asset.exportRecord.logicalUrl,
          mimeType: asset.exportRecord.mimeType,
          byteSize: asset.exportRecord.byteSize,
          width: asset.width,
          height: asset.height,
          availability: 'available'
        })),
        availableReferenceTitles,
        options: options.publicationOptions,
        hash: (value) => createHash('sha256').update(value).digest('hex')
      })
      if (!publication.ready) {
        const err = new Error('Publication preflight contains blocking errors')
        options.log.error(
          {
            event: 'manuscript.publication_assembly.failed',
            err,
            projectId: options.projectId,
            exportKind: options.kind,
            sourceHash: publication.sourceHash,
            findingCount: publication.findings.length,
            blockingFindingCount: publication.findings.filter(
              (finding) => finding.severity === 'error'
            ).length
          },
          'Publication preflight contains blocking errors'
        )
        throw err
      }
      options.log.info(
        {
          event: 'manuscript.publication_assembly.completed',
          projectId: options.projectId,
          exportKind: options.kind,
          manuscriptId: assembly.manuscriptId,
          sourceHash: publication.sourceHash,
          nodeCount: publication.nodes.length,
          assetCount: publication.assets.length,
          findingCount: publication.findings.length,
          ready: publication.ready
        },
        'Publication assembly completed'
      )
      publicationSourceHash = publication.sourceHash
      const capturedAssetById = new Map(
        exportedAssets.map((asset) => [asset.exportRecord.assetId, asset] as const)
      )
      let renderedLosses: ManuscriptMarkdownLossReport['losses']
      if (options.kind === 'docx') {
        const rendered = await renderDocxPublication({
          assembly: publication,
          log: options.log,
          readAsset: async (assetId) => {
            const asset = capturedAssetById.get(assetId)
            if (asset === undefined) throw new Error('DOCX asset is unavailable')
            return asset.bytes
          }
        })
        content = await publishContent(stage, MANUSCRIPT_DOCX_CONTENT_FILE, rendered.bytes)
        renderedLosses = rendered.losses
      } else if (options.kind === 'latex') {
        const rendered = renderLatexPublication({
          assembly: publication,
          log: options.log,
          assetRelativePath: (assetId) => {
            const asset = capturedAssetById.get(assetId)
            if (asset === undefined) throw new Error('LaTeX asset is unavailable')
            return asset.exportRecord.relativePath
          }
        })
        content = await publishContent(
          stage,
          MANUSCRIPT_LATEX_CONTENT_FILE,
          Buffer.from(rendered.tex)
        )
        renderedLosses = rendered.losses
      } else {
        if (options.renderPdf === undefined)
          throw new Error('PDF publication renderer is unavailable')
        const rendered = await options.renderPdf({
          assembly: publication,
          signal: options.signal,
          log: options.log,
          readAsset: async (assetId) => {
            const asset = capturedAssetById.get(assetId)
            if (asset === undefined) throw new Error('PDF asset is unavailable')
            return asset.bytes
          }
        })
        content = await publishContent(stage, MANUSCRIPT_PDF_CONTENT_FILE, rendered.bytes)
        renderedLosses = rendered.losses
      }
      lossReport = manuscriptMarkdownLossReportSchema.parse({
        formatVersion: 1,
        losses: [
          ...publication.findings
            .filter((finding) => finding.severity === 'warning' && finding.target !== null)
            .map((finding) => ({
              code: finding.code,
              sectionId: finding.target?.sectionId ?? '',
              blockId: finding.target?.blockId ?? 'section',
              message: finding.message
            })),
          ...renderedLosses
        ]
      })
      const publishedLosses = await publishContent(
        stage,
        MANUSCRIPT_LOSS_REPORT_FILE,
        Buffer.from(`${canonicalJson(lossReport)}\n`)
      )
      lossReportRecord = { ...publishedLosses, lossCount: lossReport.losses.length }
    }

    const manifest = manuscriptExportManifestSchema.parse({
      exportFormat: MANUSCRIPT_EXPORT_FORMAT,
      exportFormatVersion: MANUSCRIPT_EXPORT_FORMAT_VERSION,
      kind: options.kind,
      manuscriptId: assembly.manuscriptId,
      createdAt: (options.now ?? (() => new Date()))().toISOString(),
      sourceAppVersion: options.sourceAppVersion,
      ...(publicationSourceHash === undefined ? {} : { publicationSourceHash }),
      content,
      assetCount: assets.length,
      assetInventorySha256,
      assets,
      ...(bibliographyRecord === undefined ? {} : { bibliography: bibliographyRecord }),
      ...(lossReportRecord === undefined ? {} : { lossReport: lossReportRecord })
    })
    await writeAtomicFile(
      join(stage, MANUSCRIPT_EXPORT_MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`
    )
    await validateStagedExport(stage)
    throwIfAborted(options.signal)
    await ensureAbsent(destination)
    await rename(stage, destination)
    options.log.info(
      {
        event: 'manuscript.export.completed',
        projectId: options.projectId,
        exportKind: options.kind,
        manuscriptId: assembly.manuscriptId,
        contentSha256: content.sha256,
        assetCount: assets.length,
        lossCount: lossReport?.losses.length ?? 0,
        durationMs: Date.now() - startedAt
      },
      'Whole-manuscript export published'
    )
    return {
      manifest,
      packageName,
      ...(lossReport === undefined ? {} : { lossReport })
    }
  } catch (err) {
    options.log.error(
      {
        event: 'manuscript.export.failed',
        err,
        projectId: options.projectId,
        exportKind: options.kind,
        durationMs: Date.now() - startedAt
      },
      'Whole-manuscript export failed'
    )
    throw new Error('Whole-manuscript export failed', { cause: err })
  } finally {
    if (publishersPaused) {
      await options.barrier.resumeFilePublishers().catch((err) =>
        options.log.error(
          {
            event: 'manuscript.export.resume_publishers_failed',
            err,
            projectId: options.projectId
          },
          'Failed to resume manuscript export file publishers'
        )
      )
    }
    if (mutationsPaused) {
      await options.barrier.resumeMutations().catch((err) =>
        options.log.error(
          {
            event: 'manuscript.export.resume_mutations_failed',
            err,
            projectId: options.projectId
          },
          'Failed to resume manuscript export mutations'
        )
      )
    }
    await rm(stage, { recursive: true, force: true }).catch((err) =>
      options.log.error(
        { event: 'manuscript.export.stage_cleanup_failed', err, projectId: options.projectId },
        'Failed to clean manuscript export staging directory'
      )
    )
  }
}

export async function validateStagedExport(root: string): Promise<ManuscriptExportManifest> {
  const manifest = manuscriptExportManifestSchema.parse(
    JSON.parse(await readFile(join(root, MANUSCRIPT_EXPORT_MANIFEST_FILE), 'utf8')) as unknown
  )
  await verifyPublishedFile(root, manifest.content)
  const inventoryHash = sha256(canonicalJson(manifest.assets))
  if (inventoryHash !== manifest.assetInventorySha256) {
    throw new Error('Manuscript export asset inventory hash does not match')
  }
  if (manifest.assetCount !== manifest.assets.length) {
    throw new Error('Manuscript export asset count does not match')
  }
  validateInventoryPaths(manifest.assets)
  for (const asset of manifest.assets) await verifyPublishedFile(root, asset)
  if (manifest.kind === 'native') {
    if (manifest.content.relativePath !== MANUSCRIPT_NATIVE_CONTENT_FILE) {
      throw new Error('Native manuscript export content path is invalid')
    }
    const native = manuscriptNativeExportSchema.parse(
      JSON.parse(await readFile(join(root, manifest.content.relativePath), 'utf8')) as unknown
    )
    if (
      native.manuscript.manuscriptId !== manifest.manuscriptId ||
      canonicalJson(native.assets) !== canonicalJson(manifest.assets)
    ) {
      throw new Error('Native manuscript export content does not match its manifest')
    }
  } else if (manifest.kind === 'markdown' || manifest.kind === 'pandoc') {
    if (
      manifest.content.relativePath !== MANUSCRIPT_MARKDOWN_CONTENT_FILE ||
      manifest.lossReport?.relativePath !== MANUSCRIPT_LOSS_REPORT_FILE
    ) {
      throw new Error('Markdown manuscript export layout is invalid')
    }
    await verifyPublishedFile(root, manifest.lossReport)
    const losses = manuscriptMarkdownLossReportSchema.parse(
      JSON.parse(await readFile(join(root, manifest.lossReport.relativePath), 'utf8')) as unknown
    )
    if (losses.losses.length !== manifest.lossReport.lossCount) {
      throw new Error('Markdown manuscript export loss count does not match')
    }
    if (manifest.kind === 'pandoc') {
      if (manifest.bibliography?.relativePath !== MANUSCRIPT_PANDOC_REFERENCES_FILE) {
        throw new Error('Pandoc manuscript export bibliography path is invalid')
      }
      await verifyPublishedFile(root, manifest.bibliography)
      const bibliography = JSON.parse(
        await readFile(join(root, manifest.bibliography.relativePath), 'utf8')
      ) as unknown
      if (!Array.isArray(bibliography)) {
        throw new Error('Pandoc manuscript bibliography is invalid')
      }
    }
  } else if (manifest.kind === 'docx') {
    if (
      manifest.content.relativePath !== MANUSCRIPT_DOCX_CONTENT_FILE ||
      manifest.lossReport?.relativePath !== MANUSCRIPT_LOSS_REPORT_FILE
    ) {
      throw new Error('DOCX manuscript export layout is invalid')
    }
    await verifyPublishedFile(root, manifest.lossReport)
    const header = await readFile(join(root, manifest.content.relativePath))
    if (header.subarray(0, 2).toString('ascii') !== 'PK') {
      throw new Error('DOCX manuscript export is not an OOXML package')
    }
    const losses = manuscriptMarkdownLossReportSchema.parse(
      JSON.parse(await readFile(join(root, manifest.lossReport.relativePath), 'utf8')) as unknown
    )
    if (losses.losses.length !== manifest.lossReport.lossCount) {
      throw new Error('DOCX manuscript export loss count does not match')
    }
  } else if (manifest.kind === 'latex') {
    if (
      manifest.content.relativePath !== MANUSCRIPT_LATEX_CONTENT_FILE ||
      manifest.lossReport?.relativePath !== MANUSCRIPT_LOSS_REPORT_FILE ||
      manifest.publicationSourceHash === undefined
    ) {
      throw new Error('LaTeX manuscript export layout is invalid')
    }
    await verifyPublishedFile(root, manifest.lossReport)
    const source = await readFile(join(root, manifest.content.relativePath), 'utf8')
    if (
      !source.includes('\\documentclass') ||
      !source.includes(`% Publication source hash: ${manifest.publicationSourceHash}`) ||
      !source.endsWith('\\end{document}\n')
    ) {
      throw new Error('LaTeX manuscript export source is malformed')
    }
    const losses = manuscriptMarkdownLossReportSchema.parse(
      JSON.parse(await readFile(join(root, manifest.lossReport.relativePath), 'utf8')) as unknown
    )
    if (losses.losses.length !== manifest.lossReport.lossCount) {
      throw new Error('LaTeX manuscript export loss count does not match')
    }
  } else {
    if (
      manifest.content.relativePath !== MANUSCRIPT_PDF_CONTENT_FILE ||
      manifest.lossReport?.relativePath !== MANUSCRIPT_LOSS_REPORT_FILE ||
      manifest.publicationSourceHash === undefined
    ) {
      throw new Error('PDF manuscript export layout is invalid')
    }
    await verifyPublishedFile(root, manifest.lossReport)
    const source = await readFile(join(root, manifest.content.relativePath))
    if (source.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('PDF manuscript export content is malformed')
    }
    const losses = manuscriptMarkdownLossReportSchema.parse(
      JSON.parse(await readFile(join(root, manifest.lossReport.relativePath), 'utf8')) as unknown
    )
    if (losses.losses.length !== manifest.lossReport.lossCount) {
      throw new Error('PDF manuscript export loss count does not match')
    }
  }
  return manifest
}

interface CapturedAsset {
  exportRecord: ManuscriptExportAsset
  bytes: Buffer
  width: number | null
  height: number | null
}

async function captureAssets(options: {
  assembly: ManuscriptAssembly
  projectRoot: string
  database: ProjectDatabase
  assets: ManuscriptAssetService
  signal?: AbortSignal
}): Promise<CapturedAsset[]> {
  const references = new Map<string, Set<string>>()
  for (const item of options.assembly.sections) {
    const ids = collectAssetIds(item.revision.content)
    for (const assetId of ids) {
      const revisions = references.get(assetId) ?? new Set<string>()
      revisions.add(item.revision.sectionRevisionId)
      references.set(assetId, revisions)
    }
  }
  if (references.size > MAX_REFERENCED_ASSETS) {
    throw new Error('Manuscript export references too many assets')
  }
  const captured: CapturedAsset[] = []
  for (const assetId of [...references.keys()].sort()) {
    throwIfAborted(options.signal)
    const row = options.assets.get(assetId)
    const expectedSourcePath = `${MANUSCRIPT_ASSETS_DIRECTORY}/${row.sha256}${row.extension}`
    if (row.relative_path !== expectedSourcePath) {
      throw new Error('Manuscript asset database path is inconsistent')
    }
    const declaredSource = resolveProjectPath(options.projectRoot, row.relative_path)
    await assertNoSymbolicSegments(options.projectRoot, row.relative_path)
    const metadata = await lstat(declaredSource)
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error('Manuscript export asset is not a regular file')
    }
    await resolveExistingProjectPath(options.projectRoot, row.relative_path)
    const verified = await options.assets.readVerified(assetId)
    for (const revisionId of references.get(assetId) ?? []) {
      const registered = options.database.immediate(
        (database) =>
          database
            .prepare(
              `SELECT 1 FROM section_revision_assets
               WHERE section_revision_id = ? AND asset_id = ?`
            )
            .pluck()
            .get(revisionId, assetId) === 1
      )
      if (!registered) throw new Error('Manuscript asset revision registration is missing')
    }
    const relativePath = `assets/${verified.row.sha256}${verified.row.extension}`
    captured.push({
      exportRecord: {
        assetId,
        logicalUrl: `writellm-asset:${assetId}`,
        relativePath,
        sha256: verified.row.sha256,
        byteSize: verified.row.byte_size,
        mimeType: verified.row.mime_type
      },
      bytes: verified.bytes,
      width: verified.row.width,
      height: verified.row.height
    })
  }
  validateInventoryPaths(captured.map((item) => item.exportRecord))
  return captured
}

function collectAssetIds(
  document: ManuscriptAssembly['sections'][number]['revision']['content']
): Set<string> {
  const assetIds = new Set<string>()
  const visit = (blocks: typeof document): void => {
    for (const block of blocks) {
      if (block.type === 'image') {
        assetIds.add((block.props.url as string).slice('writellm-asset:'.length))
      }
      if (block.children.length > 0) visit(block.children)
    }
  }
  visit(document)
  return assetIds
}

async function publishAssets(stage: string, assets: readonly CapturedAsset[]): Promise<void> {
  for (const asset of assets) {
    const path = join(stage, ...asset.exportRecord.relativePath.split('/'))
    await writeAtomicFile(path, asset.bytes)
    await verifyPublishedFile(stage, asset.exportRecord)
  }
}

async function publishContent(
  stage: string,
  relativePath: string,
  bytes: Buffer
): Promise<{ relativePath: string; sha256: string; byteSize: number }> {
  await writeAtomicFile(join(stage, relativePath), bytes)
  const result = { relativePath, sha256: sha256(bytes), byteSize: bytes.byteLength }
  await verifyPublishedFile(stage, result)
  return result
}

async function verifyPublishedFile(
  root: string,
  file: { relativePath: string; sha256: string; byteSize: number }
): Promise<void> {
  const normalized = normalizeExportPath(file.relativePath)
  const absolute = join(root, ...normalized.split('/'))
  const metadata = await lstat(absolute)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== file.byteSize) {
    throw new Error('Manuscript export file metadata does not match')
  }
  const bytes = await readFile(absolute)
  if (sha256(bytes) !== file.sha256) {
    throw new Error('Manuscript export file hash does not match')
  }
}

function validateInventoryPaths(assets: readonly ManuscriptExportAsset[]): void {
  const seen = new Set<string>()
  const assetIds = new Set<string>()
  for (const asset of assets) {
    const normalized = normalizeExportPath(asset.relativePath)
    if (normalized !== asset.relativePath || !normalized.startsWith('assets/')) {
      throw new Error('Manuscript export asset path is invalid')
    }
    const folded = normalized.toLocaleLowerCase('en-US')
    if (seen.has(folded) || assetIds.has(asset.assetId)) {
      throw new Error('Manuscript export contains duplicate or case-colliding assets')
    }
    seen.add(folded)
    assetIds.add(asset.assetId)
  }
}

function normalizeExportPath(value: string): string {
  if (value === '' || value.includes('\0') || value.includes('\\') || isAbsolute(value)) {
    throw new Error('Manuscript export path is not normalized')
  }
  const segments = value.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('Manuscript export path contains an invalid segment')
  }
  return segments.join('/')
}

async function assertNoSymbolicSegments(root: string, relativePath: string): Promise<void> {
  let current = await realpath(root)
  for (const segment of relativePath.split('/')) {
    current = join(current, segment)
    const metadata = await lstat(current)
    if (metadata.isSymbolicLink()) {
      throw new Error('Manuscript export asset path contains a symbolic link')
    }
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Manuscript export contains a non-finite number')
    return value
  }
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value !== 'object') throw new Error('Manuscript export is not JSON serializable')
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])])
  )
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

async function ensureAbsent(path: string): Promise<void> {
  await access(path).then(
    () => {
      throw new Error('Manuscript export destination already exists')
    },
    (err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err
    }
  )
}

function safeStagePrefix(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)
  return sanitized === '' ? 'manuscript' : sanitized
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('Manuscript export was cancelled')
}
