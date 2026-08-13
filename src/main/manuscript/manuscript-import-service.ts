import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, posix, relative, resolve, sep } from 'node:path'
import type { Logger } from 'pino'
import {
  MANUSCRIPT_IMPORT_PLAN_VERSION,
  MAX_MANUSCRIPT_IMPORT_ASSETS,
  MAX_MANUSCRIPT_IMPORT_CAPTURE_BYTES,
  MAX_MANUSCRIPT_IMPORT_SOURCE_BYTES,
  manuscriptImportApplyResultSchema,
  manuscriptImportCancelResultSchema,
  manuscriptImportPlanSchema,
  type ManuscriptImportApplyInput,
  type ManuscriptImportApplyResult,
  type ManuscriptImportCancelResult,
  type ManuscriptImportPlan
} from '../../shared/contracts/manuscript-import'
import {
  blockNoteDocumentSchema,
  type BlockNoteDocument,
  type ManuscriptAssetResult
} from '../../shared/contracts/manuscript'
import type { ProjectContext } from '../project/project-context'
import { PROJECT_TEMP_DIRECTORY } from '../project/project-paths'
import { writeAtomicFile } from '../storage/atomic-file'
import { extractBoundedZip } from '../storage/bounded-zip-extractor'
import { extractSectionText } from './content'
import { parseMarkdownImport } from './markdown-import-adapter'
import type { LatexImportWorkerResult } from '../../shared/contracts/latex-import'
import { mapLatexImportResult } from './latex-import-mapper'

const IMPORT_DIRECTORY = `${PROJECT_TEMP_DIRECTORY}/manuscript-import`
const IMPORT_PLAN_TTL_MS = 30 * 60 * 1_000
const MAX_IMPORT_RESOURCE_BYTES = 20 * 1024 * 1024
const MAX_IMPORT_RESOURCE_TOTAL_BYTES = 100 * 1024 * 1024
const MAX_LATEX_ARCHIVE_BYTES = 32 * 1024 * 1024
const MAX_LATEX_PROJECT_FILES = 500
const MAX_LATEX_PROJECT_DEPTH = 32
const LATEX_PROJECT_EXTENSIONS = new Set([
  '.tex',
  '.bib',
  '.sty',
  '.cls',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp'
])

interface StageManifestEntry {
  relativePath: string
  byteSize: number
  sha256: string
}

interface StagedLatexProject {
  entryRelativePath: string
  textFiles: Array<{ relativePath: string; kind: 'tex' | 'bib'; source: string }>
  assetPaths: string[]
  files: StageManifestEntry[]
}

interface StagedImportSource {
  format: 'markdown' | 'latex' | 'latex-project'
  displayName: string
  byteSize: number
  sourceHash: string
  primaryBytes: Buffer
  resourceRoot: string | null
  manifest: StageManifestEntry[]
  latexProject: StagedLatexProject | null
}

interface StoredPlan {
  projectSessionId: string
  stageRelativePath: string
  stageManifest: StageManifestEntry[]
  plan: ManuscriptImportPlan
  context: ProjectContext
}

export class ManuscriptImportService {
  readonly #plans = new Map<string, StoredPlan>()
  readonly #activatedSessions = new Set<string>()

  constructor(
    private readonly options: {
      log: Pick<Logger, 'info' | 'warn' | 'error'>
      now?: () => Date
      createId?: () => string
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
    }
  ) {}

  async createPlan(input: {
    context: ProjectContext
    sourcePath: string
    activeSectionId: string
    signal?: AbortSignal
  }): Promise<ManuscriptImportPlan> {
    const startedAt = Date.now()
    const createId = this.options.createId ?? randomUUID
    const planId = createId()
    const stageRelativePath = `${IMPORT_DIRECTORY}/${planId}`
    let publishedAssetCount = 0
    try {
      await this.#activate(input.context)
      input.signal?.throwIfAborted()
      await input.context.filesystem.ensureDirectory(stageRelativePath)
      const selected = await stageImportSource({
        sourcePath: input.sourcePath,
        stageRoot: resolve(input.context.projectRoot, stageRelativePath),
        signal: input.signal,
        log: this.options.log
      })
      this.options.log.info(
        {
          event: 'manuscript.import.staged',
          projectId: input.context.manifest.projectId,
          projectSessionId: input.context.projectSessionId,
          planId,
          format: selected.format,
          sourceHash: selected.sourceHash,
          sourceByteSize: selected.byteSize,
          fileCount: selected.manifest.length,
          durationMs: Date.now() - startedAt
        },
        'Manuscript import source staged'
      )
      const sourceHash = selected.sourceHash
      const workspace = input.context.manuscript.getWorkspace()
      const active = input.context.editorPersistence.loadSection(input.activeSectionId)
      const resourceRoot = selected.resourceRoot
      const resourceCache = new Map<string, Awaited<ReturnType<typeof captureImageResource>>>()
      let totalResourceBytes = 0
      const displayName = selected.displayName
      const resolveImage = async (reference: string) => {
        input.signal?.throwIfAborted()
        if (resourceRoot === null) throw new Error('Import resource root is unavailable')
        const captured = await captureImageResource(resourceRoot, reference)
        let cached = resourceCache.get(captured.sha256)
        if (cached === undefined) {
          if (resourceCache.size >= MAX_MANUSCRIPT_IMPORT_ASSETS) {
            throw new Error('Import contains too many image resources')
          }
          totalResourceBytes += captured.bytes.byteLength
          if (totalResourceBytes > MAX_IMPORT_RESOURCE_TOTAL_BYTES) {
            throw new Error('Import image resources exceed the 100 MiB total limit')
          }
          cached = captured
          resourceCache.set(captured.sha256, captured)
          const stagedName = `${captured.sha256}${captured.extension}`
          await writeAtomicFile(
            resolve(input.context.projectRoot, stageRelativePath, 'resources', stagedName),
            captured.bytes,
            { mode: 0o600, publishWithoutReplacement: true }
          )
        }
        const result = await input.context.manuscriptAssets.store({
          bytes: cached.bytes,
          mimeType: cached.mimeType,
          sourceType: 'upload',
          originalName: cached.displayName
        })
        publishedAssetCount += 1
        return { result, displayName: cached.displayName, sha256: cached.sha256 }
      }
      const parsed =
        selected.format === 'markdown'
          ? await parseMarkdownImport({
              bytes: selected.primaryBytes,
              displayName,
              createId,
              signal: input.signal,
              resolveImage,
              log: this.options.log
            })
          : await this.#parseLatex({
              bytes: selected.primaryBytes,
              displayName,
              sourceHash,
              createId,
              project: selected.latexProject,
              stageRoot: resolve(input.context.projectRoot, stageRelativePath),
              context: input.context,
              signal: input.signal
            })
      publishedAssetCount += selected.format === 'markdown' ? 0 : parsed.assets.length
      const expiresAt = new Date(
        (this.options.now ?? (() => new Date()))().getTime() + IMPORT_PLAN_TTL_MS
      ).toISOString()
      const plan = manuscriptImportPlanSchema.parse({
        version: MANUSCRIPT_IMPORT_PLAN_VERSION,
        planId,
        expiresAt,
        source: {
          displayName,
          format: selected.format,
          byteSize: selected.byteSize,
          sha256: sourceHash
        },
        base: {
          manuscriptId: workspace.manuscriptId,
          briefVersion: workspace.brief.version,
          outlineVersion: workspace.outlineVersion,
          activeSectionId: active.section.sectionId,
          activeRevisionId: active.revision.sectionRevisionId,
          activeContentHash: active.revision.contentHash
        },
        proposedBrief: { title: parsed.proposedTitle },
        sections: parsed.sections.map((section) => ({
          ...section,
          blockCount: countBlocks(section.document),
          previewText: extractSectionText(section.document).slice(0, 20_000)
        })),
        assets: parsed.assets.map((asset) => ({
          assetId: asset.result.assetId,
          logicalUrl: asset.result.logicalUrl,
          displayName: asset.displayName,
          mimeType: asset.result.mimeType,
          byteSize: asset.result.byteSize,
          sha256: asset.sha256
        })),
        warnings: parsed.warnings,
        unsupported: parsed.unsupported,
        losses: parsed.losses,
        noOp: parsed.sections.length === 0
      })
      this.#plans.set(planId, {
        projectSessionId: input.context.projectSessionId,
        stageRelativePath,
        stageManifest: selected.manifest,
        plan,
        context: input.context
      })
      this.options.log.info(
        {
          event: 'manuscript.import.plan_created',
          projectId: input.context.manifest.projectId,
          projectSessionId: input.context.projectSessionId,
          planId,
          sourceHash,
          sourceByteSize: selected.byteSize,
          sectionCount: plan.sections.length,
          assetCount: plan.assets.length,
          lossCount: plan.losses.length,
          durationMs: Date.now() - startedAt
        },
        'Manuscript import plan created'
      )
      return plan
    } catch (err) {
      await input.context.filesystem.removeTree(stageRelativePath).catch(() => undefined)
      this.options.log.error(
        {
          event: 'manuscript.import.plan_failed',
          err,
          projectId: input.context.manifest.projectId,
          projectSessionId: input.context.projectSessionId,
          planId,
          publishedAssetCount,
          durationMs: Date.now() - startedAt
        },
        'Manuscript import planning failed'
      )
      throw err
    }
  }

  async apply(
    context: ProjectContext,
    input: ManuscriptImportApplyInput
  ): Promise<ManuscriptImportApplyResult> {
    const startedAt = Date.now()
    try {
      return await this.#apply(context, input)
    } catch (err) {
      this.options.log.error(
        {
          event: 'manuscript.import.apply_failed',
          err,
          projectId: context.manifest.projectId,
          projectSessionId: context.projectSessionId,
          planId: input.planId,
          mode: input.mode,
          durationMs: Date.now() - startedAt
        },
        'Manuscript import apply failed'
      )
      throw err
    }
  }

  async #apply(
    context: ProjectContext,
    input: ManuscriptImportApplyInput
  ): Promise<ManuscriptImportApplyResult> {
    const startedAt = Date.now()
    const stored = this.#requirePlan(context, input.planId)
    if (stored.plan.noOp) throw new Error('Empty import plan cannot be applied')
    await this.#verifyStage(context, stored)
    const workspace = context.manuscript.getWorkspace()
    const active = context.editorPersistence.loadSection(stored.plan.base.activeSectionId)
    if (
      workspace.manuscriptId !== stored.plan.base.manuscriptId ||
      workspace.brief.version !== stored.plan.base.briefVersion ||
      workspace.outlineVersion !== stored.plan.base.outlineVersion ||
      active.revision.sectionRevisionId !== stored.plan.base.activeRevisionId ||
      active.revision.contentHash !== stored.plan.base.activeContentHash
    ) {
      throw new Error('Manuscript changed after this import plan was created')
    }

    let result: ManuscriptImportApplyResult
    if (input.mode === 'create_sections') {
      const imported = context.manuscript.importSectionsAtomic({
        baseBriefVersion: stored.plan.base.briefVersion,
        baseOutlineVersion: stored.plan.base.outlineVersion,
        sections: stored.plan.sections.map((section) => ({
          title: section.title,
          outlineLevel: section.outlineLevel,
          document: section.document
        }))
      })
      let materializationPending = false
      for (const revision of imported.revisions) {
        try {
          await context.editorPersistence.materialize(revision)
        } catch (err) {
          materializationPending = true
          this.options.log.error(
            {
              event: 'manuscript.import.materialization_failed',
              err,
              projectId: context.manifest.projectId,
              planId: input.planId,
              sectionId: revision.sectionId,
              sectionRevisionId: revision.sectionRevisionId
            },
            'Imported section materialization failed'
          )
        }
      }
      result = manuscriptImportApplyResultSchema.parse({
        status: 'applied',
        mode: input.mode,
        sourceHash: stored.plan.source.sha256,
        createdSectionIds: imported.sections.map((section) => section.sectionId),
        affectedRevisionIds: imported.revisions.map((revision) => revision.sectionRevisionId),
        materializationPending
      })
    } else {
      const document = flattenForActiveSection(stored.plan.sections)
      const saved = await context.editorPersistence.save(
        {
          projectSessionId: context.projectSessionId,
          sectionId: stored.plan.base.activeSectionId,
          baseRevisionId: stored.plan.base.activeRevisionId,
          baseContentHash: stored.plan.base.activeContentHash,
          document,
          revisionSource: 'import'
        },
        'import'
      )
      result = manuscriptImportApplyResultSchema.parse({
        status: 'applied',
        mode: input.mode,
        sourceHash: stored.plan.source.sha256,
        createdSectionIds: [],
        affectedRevisionIds: [saved.revision.sectionRevisionId],
        materializationPending: saved.disposition === 'saved_materialization_pending'
      })
    }
    await this.#discard(context, stored)
    this.options.log.info(
      {
        event: 'manuscript.import.applied',
        projectId: context.manifest.projectId,
        projectSessionId: context.projectSessionId,
        planId: input.planId,
        mode: input.mode,
        sourceHash: stored.plan.source.sha256,
        createdSectionCount: result.createdSectionIds.length,
        durationMs: Date.now() - startedAt
      },
      'Manuscript import applied'
    )
    return result
  }

  async cancel(context: ProjectContext, planId: string): Promise<ManuscriptImportCancelResult> {
    const stored = this.#plans.get(planId)
    if (stored === undefined || stored.projectSessionId !== context.projectSessionId) {
      return manuscriptImportCancelResultSchema.parse({ status: 'not_found' })
    }
    await this.#discard(context, stored)
    this.options.log.info(
      {
        event: 'manuscript.import.cancelled',
        projectId: context.manifest.projectId,
        projectSessionId: context.projectSessionId,
        planId
      },
      'Manuscript import cancelled'
    )
    return manuscriptImportCancelResultSchema.parse({ status: 'cancelled' })
  }

  revokeSession(projectSessionId: string): void {
    for (const stored of [...this.#plans.values()]) {
      if (stored.projectSessionId === projectSessionId) {
        void this.#discard(stored.context, stored)
      }
    }
    this.#activatedSessions.delete(projectSessionId)
  }

  async #activate(context: ProjectContext): Promise<void> {
    if (this.#activatedSessions.has(context.projectSessionId)) return
    await context.filesystem.removeTree(IMPORT_DIRECTORY)
    await context.filesystem.ensureDirectory(IMPORT_DIRECTORY)
    this.#activatedSessions.add(context.projectSessionId)
    this.options.log.info(
      {
        event: 'manuscript.import.crash_staging_cleaned',
        projectId: context.manifest.projectId,
        projectSessionId: context.projectSessionId
      },
      'Stale manuscript import staging removed'
    )
  }

  #requirePlan(context: ProjectContext, planId: string): StoredPlan {
    const stored = this.#plans.get(planId)
    if (stored === undefined || stored.projectSessionId !== context.projectSessionId) {
      throw new Error('Import plan does not exist in the active project session')
    }
    if (Date.parse(stored.plan.expiresAt) <= (this.options.now ?? (() => new Date()))().getTime()) {
      void this.#discard(context, stored)
      throw new Error('Import plan has expired')
    }
    return stored
  }

  async #verifyStage(context: ProjectContext, stored: StoredPlan): Promise<void> {
    const observed: StageManifestEntry[] = []
    for (const entry of stored.stageManifest) {
      const path = await context.filesystem.assertExistingRegularFile(
        `${stored.stageRelativePath}/${entry.relativePath}`
      )
      const bytes = await readFile(path)
      const current = {
        relativePath: entry.relativePath,
        byteSize: bytes.byteLength,
        sha256: sha256(bytes)
      }
      if (current.byteSize !== entry.byteSize || current.sha256 !== entry.sha256) {
        throw new Error('Captured import source no longer matches the reviewed plan')
      }
      observed.push(current)
    }
    const observedByteSize = observed.reduce((total, entry) => total + entry.byteSize, 0)
    const observedHash =
      stored.plan.source.format === 'latex-project' ? hashManifest(observed) : observed[0]?.sha256
    if (
      observedByteSize !== stored.plan.source.byteSize ||
      observedHash !== stored.plan.source.sha256
    ) {
      throw new Error('Captured import manifest no longer matches the reviewed plan')
    }
  }

  async #parseLatex(input: {
    bytes: Buffer
    displayName: string
    sourceHash: string
    createId: () => string
    project: StagedLatexProject | null
    stageRoot: string
    context: ProjectContext
    signal?: AbortSignal
  }): Promise<{
    proposedTitle: string | null
    sections: ReturnType<typeof mapLatexImportResult>
    assets: Array<{
      result: ManuscriptAssetResult
      displayName: string
      sha256: string
    }>
    warnings: LatexImportWorkerResult['warnings']
    unsupported: LatexImportWorkerResult['unsupported']
    losses: LatexImportWorkerResult['losses']
  }> {
    if (this.options.parseLatex === undefined) throw new Error('LaTeX import parser is unavailable')
    const source = input.bytes.toString('utf8')
    if (source.includes('\uFFFD')) throw new Error('LaTeX source must be valid UTF-8')
    const parsed = await this.options.parseLatex({
      source,
      sourceHash: input.sourceHash,
      project:
        input.project === null
          ? null
          : {
              entryRelativePath: input.project.entryRelativePath,
              textFiles: input.project.textFiles,
              assetPaths: input.project.assetPaths
            },
      signal: input.signal
    })
    if (parsed.sourceHash !== input.sourceHash) throw new Error('LaTeX parser source hash mismatch')
    const assets: Array<{
      result: ManuscriptAssetResult
      displayName: string
      sha256: string
    }> = []
    const resources = new Map<string, { logicalUrl: string; displayName: string }>()
    const references = new Set(
      parsed.sections.flatMap((section) =>
        section.nodes.flatMap((node) => (node.type === 'figure' ? [node.relativePath] : []))
      )
    )
    for (const reference of references) {
      input.signal?.throwIfAborted()
      if (input.project === null || !input.project.assetPaths.includes(reference)) {
        throw new Error('LaTeX parser returned an uncaptured image reference')
      }
      const captured = await captureImageResource(resolve(input.stageRoot, 'project'), reference)
      const result = await input.context.manuscriptAssets.store({
        bytes: captured.bytes,
        mimeType: captured.mimeType,
        sourceType: 'upload',
        originalName: captured.displayName
      })
      assets.push({ result, displayName: captured.displayName, sha256: captured.sha256 })
      resources.set(reference, { logicalUrl: result.logicalUrl, displayName: captured.displayName })
    }
    const mapped = mapLatexImportResult(parsed, input.createId, resources, this.options.log).map(
      (section) => ({
        ...section,
        title:
          section.title === 'Imported LaTeX manuscript'
            ? importSourceTitle(input.displayName)
            : section.title
      })
    )
    return {
      proposedTitle: parsed.proposedTitle,
      sections: mapped,
      assets,
      warnings: parsed.warnings,
      unsupported: parsed.unsupported,
      losses: parsed.losses
    }
  }

  async #discard(context: ProjectContext, stored: StoredPlan): Promise<void> {
    this.#plans.delete(stored.plan.planId)
    await context.filesystem.removeTree(stored.stageRelativePath).catch((err) => {
      this.options.log.warn(
        {
          event: 'manuscript.import.staging_cleanup_failed',
          err,
          projectId: context.manifest.projectId,
          projectSessionId: context.projectSessionId,
          planId: stored.plan.planId
        },
        'Manuscript import staging cleanup failed'
      )
    })
  }
}

async function stageImportSource(input: {
  sourcePath: string
  stageRoot: string
  signal?: AbortSignal
  log?: Pick<Logger, 'info' | 'warn' | 'error'>
}): Promise<StagedImportSource> {
  const metadata = await lstat(input.sourcePath)
  if (metadata.isSymbolicLink()) throw new Error('Import source cannot be a symbolic link')
  if (metadata.isDirectory()) {
    const root = await realpath(input.sourcePath)
    return stageLatexDirectory({
      sourceRoot: root,
      stageRoot: input.stageRoot,
      displayName: basename(root).slice(0, 500),
      explicitEntry: null,
      forceProjectFormat: true,
      signal: input.signal
    })
  }
  if (!metadata.isFile()) throw new Error('Import source must be a regular file or directory')
  const canonical = await realpath(input.sourcePath)
  const extension = extname(canonical).toLowerCase()
  if (extension === '.md') {
    const selected = await captureSelectedFile(canonical)
    await writeAtomicFile(resolve(input.stageRoot, 'source.md'), selected.bytes, { mode: 0o600 })
    const entry = {
      relativePath: 'source.md',
      byteSize: selected.bytes.byteLength,
      sha256: sha256(selected.bytes)
    }
    return {
      format: 'markdown',
      displayName: basename(canonical).slice(0, 500),
      byteSize: entry.byteSize,
      sourceHash: entry.sha256,
      primaryBytes: selected.bytes,
      resourceRoot: dirname(canonical),
      manifest: [entry],
      latexProject: null
    }
  }
  if (extension === '.tex') {
    return stageDirectLatexEntry({
      sourceRoot: dirname(canonical),
      stageRoot: input.stageRoot,
      displayName: basename(canonical).slice(0, 500),
      entryRelativePath: basename(canonical).normalize('NFC'),
      signal: input.signal
    })
  }
  if (extension !== '.zip') throw new Error('Import source type is not supported')
  if (metadata.size > MAX_LATEX_ARCHIVE_BYTES) {
    throw new Error('LaTeX project archive exceeds the 32 MiB compressed limit')
  }
  const archiveBytes = await readFile(canonical)
  const stagedArchive = resolve(input.stageRoot, 'source.zip')
  await writeAtomicFile(stagedArchive, archiveBytes, { mode: 0o600 })
  const extracted = await extractBoundedZip({
    archivePath: stagedArchive,
    destinationRoot: resolve(input.stageRoot, 'project'),
    label: 'LaTeX project archive',
    allowedExtensions: LATEX_PROJECT_EXTENSIONS,
    maxFiles: MAX_LATEX_PROJECT_FILES,
    maxExpandedBytes: MAX_MANUSCRIPT_IMPORT_CAPTURE_BYTES,
    maxFileBytes: MAX_IMPORT_RESOURCE_BYTES,
    maxCompressionRatio: 100,
    log: input.log
  })
  await rm(stagedArchive, { force: true })
  return buildStagedLatexProject({
    stageRoot: input.stageRoot,
    displayName: basename(canonical).slice(0, 500),
    files: extracted.files.map((file) => ({
      ...file,
      relativePath: `project/${file.relativePath}`
    })),
    explicitEntry: null,
    forceProjectFormat: true
  })
}

async function stageDirectLatexEntry(input: {
  sourceRoot: string
  stageRoot: string
  displayName: string
  entryRelativePath: string
  signal?: AbortSignal
}): Promise<StagedImportSource> {
  const files: StageManifestEntry[] = []
  const captured = new Set<string>()
  let totalBytes = 0

  const capture = async (relativePath: string): Promise<string | null> => {
    const normalized = posix.normalize(relativePath.normalize('NFC'))
    if (
      normalized === '..' ||
      normalized.startsWith('../') ||
      normalized.startsWith('/') ||
      normalized.includes('\\')
    ) {
      return null
    }
    if (captured.has(normalized)) return normalized
    const extension = extname(normalized).toLowerCase()
    if (!LATEX_PROJECT_EXTENSIONS.has(extension)) return null
    const sourcePath = resolve(input.sourceRoot, normalized)
    let metadata: Awaited<ReturnType<typeof lstat>>
    try {
      metadata = await lstat(sourcePath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
    if (metadata.isSymbolicLink()) throw new Error('LaTeX project contains a symbolic link')
    if (!metadata.isFile()) return null
    if (metadata.size > MAX_IMPORT_RESOURCE_BYTES) {
      throw new Error('LaTeX project file exceeds the 20 MiB per-file limit')
    }
    const canonical = await realpath(sourcePath)
    const fromRoot = relative(input.sourceRoot, canonical)
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new Error('LaTeX project file escapes the selected root')
    }
    const bytes = await readFile(canonical)
    totalBytes += bytes.byteLength
    if (totalBytes > MAX_MANUSCRIPT_IMPORT_CAPTURE_BYTES) {
      throw new Error('LaTeX project exceeds the 100 MiB capture limit')
    }
    if (files.length >= MAX_LATEX_PROJECT_FILES) throw new Error('LaTeX project has too many files')
    await writeAtomicFile(resolve(input.stageRoot, 'project', normalized), bytes, { mode: 0o600 })
    captured.add(normalized)
    files.push({
      relativePath: `project/${normalized}`,
      byteSize: bytes.byteLength,
      sha256: sha256(bytes)
    })
    return normalized
  }

  const visitTex = async (relativePath: string, depth: number): Promise<void> => {
    if (depth > 16) throw new Error('LaTeX include nesting exceeds the supported depth')
    const normalized = await capture(relativePath)
    if (normalized === null) return
    const bytes = await readFile(resolve(input.stageRoot, 'project', normalized))
    if (bytes.byteLength > MAX_MANUSCRIPT_IMPORT_SOURCE_BYTES) {
      throw new Error('LaTeX project text file exceeds the 8 MiB parser limit')
    }
    const source = bytes.toString('utf8')
    if (source.includes('\uFFFD')) throw new Error('LaTeX project text must be valid UTF-8')
    for (const match of source.matchAll(/\\(?:input|include)\s*\{([^}]+)\}/gu)) {
      const dependency = resolveRelativeLatexPath(normalized, match[1]?.trim() ?? '', '.tex')
      if (dependency !== null && !captured.has(dependency)) await visitTex(dependency, depth + 1)
    }
    for (const match of source.matchAll(/\\(?:bibliography|addbibresource)\s*\{([^}]+)\}/gu)) {
      for (const requested of (match[1] ?? '').split(',')) {
        const dependency = resolveRelativeLatexPath(normalized, requested.trim(), '.bib')
        if (dependency !== null) await capture(dependency)
      }
    }
    for (const match of source.matchAll(/\\includegraphics(?:\[[^\]]*\])?\s*\{([^}]+)\}/gu)) {
      const requested = resolveRelativeLatexPath(normalized, match[1]?.trim() ?? '', '')
      if (requested === null) continue
      const candidates =
        posix.extname(requested) === ''
          ? ['.png', '.jpg', '.jpeg', '.webp'].map((extension) => `${requested}${extension}`)
          : [requested]
      for (const candidate of candidates) {
        if ((await capture(candidate)) !== null) break
      }
    }
  }

  await visitTex(input.entryRelativePath, 0)
  return buildStagedLatexProject({
    stageRoot: input.stageRoot,
    displayName: input.displayName,
    files,
    explicitEntry: input.entryRelativePath,
    forceProjectFormat: false
  })
}

async function stageLatexDirectory(input: {
  sourceRoot: string
  stageRoot: string
  displayName: string
  explicitEntry: string | null
  forceProjectFormat: boolean
  signal?: AbortSignal
}): Promise<StagedImportSource> {
  const files: StageManifestEntry[] = []
  const seen = new Map<string, string>()
  let totalBytes = 0
  const walk = async (directory: string, prefix: string, depth: number): Promise<void> => {
    if (depth > MAX_LATEX_PROJECT_DEPTH) throw new Error('LaTeX project directory is too deep')
    const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name, 'en')
    )
    for (const entry of entries) {
      input.signal?.throwIfAborted()
      if (['.git', '.writellm', 'node_modules'].includes(entry.name)) continue
      const normalizedName = entry.name.normalize('NFC')
      const relativePath = prefix === '' ? normalizedName : `${prefix}/${normalizedName}`
      const source = resolve(directory, entry.name)
      const metadata = await lstat(source)
      if (metadata.isSymbolicLink()) throw new Error('LaTeX project contains a symbolic link')
      if (metadata.isDirectory()) {
        await walk(source, relativePath, depth + 1)
        continue
      }
      if (!metadata.isFile()) throw new Error('LaTeX project contains a non-regular entry')
      const extension = extname(normalizedName).toLowerCase()
      if (!LATEX_PROJECT_EXTENSIONS.has(extension)) continue
      const collisionKey = relativePath.toLocaleLowerCase('en-US')
      const prior = seen.get(collisionKey)
      if (prior !== undefined) {
        throw new Error(
          `LaTeX project paths collide after normalization: ${prior} and ${relativePath}`
        )
      }
      seen.set(collisionKey, relativePath)
      if (files.length >= MAX_LATEX_PROJECT_FILES)
        throw new Error('LaTeX project has too many files')
      if (metadata.size > MAX_IMPORT_RESOURCE_BYTES) {
        throw new Error('LaTeX project file exceeds the 20 MiB per-file limit')
      }
      const canonical = await realpath(source)
      const fromRoot = relative(input.sourceRoot, canonical)
      if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
        throw new Error('LaTeX project file escapes the selected root')
      }
      const bytes = await readFile(canonical)
      totalBytes += bytes.byteLength
      if (totalBytes > MAX_MANUSCRIPT_IMPORT_CAPTURE_BYTES) {
        throw new Error('LaTeX project exceeds the 100 MiB capture limit')
      }
      await writeAtomicFile(resolve(input.stageRoot, 'project', relativePath), bytes, {
        mode: 0o600
      })
      files.push({
        relativePath: `project/${relativePath}`,
        byteSize: bytes.byteLength,
        sha256: sha256(bytes)
      })
    }
  }
  await walk(input.sourceRoot, '', 0)
  return buildStagedLatexProject({ ...input, files })
}

async function buildStagedLatexProject(input: {
  stageRoot: string
  displayName: string
  files: StageManifestEntry[]
  explicitEntry: string | null
  forceProjectFormat: boolean
}): Promise<StagedImportSource> {
  const textFiles: StagedLatexProject['textFiles'] = []
  const assetPaths: string[] = []
  let textBytes = 0
  for (const entry of input.files) {
    const relativePath = entry.relativePath.replace(/^project\//u, '')
    const extension = extname(relativePath).toLowerCase()
    if (extension === '.tex' || extension === '.bib') {
      const bytes = await readFile(resolve(input.stageRoot, entry.relativePath))
      if (bytes.byteLength > MAX_MANUSCRIPT_IMPORT_SOURCE_BYTES) {
        throw new Error('LaTeX project text file exceeds the 8 MiB parser limit')
      }
      const source = bytes.toString('utf8')
      if (source.includes('\uFFFD')) throw new Error('LaTeX project text must be valid UTF-8')
      textBytes += bytes.byteLength
      if (textBytes > 16 * 1024 * 1024) {
        throw new Error('LaTeX project text exceeds the 16 MiB parser limit')
      }
      textFiles.push({ relativePath, kind: extension === '.tex' ? 'tex' : 'bib', source })
    } else if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) {
      assetPaths.push(relativePath)
    }
  }
  const texFiles = textFiles.filter((file) => file.kind === 'tex')
  let entryRelativePath = input.explicitEntry
  if (
    entryRelativePath !== null &&
    !texFiles.some((file) => file.relativePath === entryRelativePath)
  ) {
    throw new Error('Selected LaTeX entry was not captured from its project root')
  }
  if (entryRelativePath === null) {
    const main = texFiles.find((file) => file.relativePath === 'main.tex')
    const documents = texFiles.filter((file) => /\\begin\s*\{document\}/u.test(file.source))
    entryRelativePath =
      main?.relativePath ?? (documents.length === 1 ? documents[0]?.relativePath : null) ?? null
  }
  if (entryRelativePath === null) {
    throw new Error('LaTeX project needs root main.tex or exactly one document entry')
  }
  const entry = textFiles.find(
    (file) => file.kind === 'tex' && file.relativePath === entryRelativePath
  )
  if (entry === undefined) throw new Error('LaTeX project entry source is missing')
  const allManifest = [...input.files].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, 'en')
  )
  const includedPaths = input.forceProjectFormat
    ? null
    : latexDependencyClosure(entryRelativePath, textFiles, assetPaths)
  const selectedTextFiles =
    includedPaths === null
      ? textFiles
      : textFiles.filter((file) => includedPaths.has(file.relativePath))
  const selectedAssetPaths =
    includedPaths === null ? assetPaths : assetPaths.filter((path) => includedPaths.has(path))
  const manifest =
    includedPaths === null
      ? allManifest
      : allManifest.filter((file) =>
          includedPaths.has(file.relativePath.replace(/^project\//u, ''))
        )
  const byteSize = manifest.reduce((total, file) => total + file.byteSize, 0)
  const singleSource = manifest.length === 1 && !input.forceProjectFormat
  return {
    format: singleSource ? 'latex' : 'latex-project',
    displayName: input.displayName,
    byteSize,
    sourceHash: singleSource
      ? (manifest[0]?.sha256 ?? sha256(Buffer.from(entry.source)))
      : hashManifest(manifest),
    primaryBytes: Buffer.from(entry.source, 'utf8'),
    resourceRoot: null,
    manifest,
    latexProject: {
      entryRelativePath,
      textFiles: selectedTextFiles,
      assetPaths: selectedAssetPaths,
      files: manifest
    }
  }
}

function latexDependencyClosure(
  entryRelativePath: string,
  textFiles: StagedLatexProject['textFiles'],
  assetPaths: string[]
): Set<string> {
  const textByPath = new Map(textFiles.map((file) => [file.relativePath, file] as const))
  const assets = new Set(assetPaths)
  const selected = new Set<string>()
  const visitTex = (path: string): void => {
    if (selected.has(path)) return
    const file = textByPath.get(path)
    if (file?.kind !== 'tex') return
    selected.add(path)
    for (const match of file.source.matchAll(/\\(?:input|include)\s*\{([^}]+)\}/gu)) {
      const requested = match[1]?.trim() ?? ''
      const candidate = resolveRelativeLatexPath(path, requested, '.tex')
      if (candidate !== null) visitTex(candidate)
    }
    for (const match of file.source.matchAll(/\\(?:bibliography|addbibresource)\s*\{([^}]+)\}/gu)) {
      for (const requested of (match[1] ?? '').split(',')) {
        const candidate = resolveRelativeLatexPath(path, requested.trim(), '.bib')
        if (candidate !== null && textByPath.get(candidate)?.kind === 'bib') selected.add(candidate)
      }
    }
    for (const match of file.source.matchAll(/\\includegraphics(?:\[[^\]]*\])?\s*\{([^}]+)\}/gu)) {
      const requested = match[1]?.trim() ?? ''
      const base = resolveRelativeLatexPath(path, requested, '')
      if (base === null) continue
      const candidates =
        posix.extname(base) === ''
          ? ['.png', '.jpg', '.jpeg', '.webp'].map((extension) => `${base}${extension}`)
          : [base]
      const captured = candidates.find((candidate) => assets.has(candidate))
      if (captured !== undefined) selected.add(captured)
    }
  }
  visitTex(entryRelativePath)
  return selected
}

function resolveRelativeLatexPath(
  currentPath: string,
  requested: string,
  defaultExtension: string
): string | null {
  if (
    requested === '' ||
    requested.length > 1_024 ||
    requested.includes('\\') ||
    requested.includes('\0') ||
    requested.startsWith('/')
  ) {
    return null
  }
  const withExtension =
    defaultExtension !== '' && posix.extname(requested) === ''
      ? `${requested}${defaultExtension}`
      : requested
  const normalized = posix.normalize(posix.join(posix.dirname(currentPath), withExtension))
  return normalized.startsWith('../') || normalized === '..' || normalized.startsWith('/')
    ? null
    : normalized
}

async function captureSelectedFile(
  sourcePath: string
): Promise<{ realPath: string; bytes: Buffer }> {
  const metadata = await lstat(sourcePath)
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error('Import source must be a regular file and cannot be a symbolic link')
  }
  if (metadata.size > MAX_MANUSCRIPT_IMPORT_SOURCE_BYTES) {
    throw new Error('Import source exceeds the 8 MiB limit')
  }
  const realPath = await realpath(sourcePath)
  const canonicalMetadata = await lstat(realPath)
  if (!canonicalMetadata.isFile()) throw new Error('Import source must be a regular file')
  return { realPath, bytes: await readFile(realPath) }
}

async function captureImageResource(
  root: string,
  reference: string
): Promise<{
  bytes: Buffer
  displayName: string
  extension: '.png' | '.jpg' | '.webp'
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  sha256: string
}> {
  if (reference.length === 0 || reference.length > 1_024) throw new Error('image path is invalid')
  if (/^[a-z][a-z0-9+.-]*:/iu.test(reference) || isAbsolute(reference)) {
    throw new Error('external and absolute image paths are not allowed')
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(reference.split(/[?#]/u, 1)[0] ?? '')
  } catch (err) {
    throw new Error('image path encoding is invalid', { cause: err })
  }
  const segments = decoded.replaceAll('\\', '/').split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('image path traversal is not allowed')
  }
  await assertNoSymlinkSegments(root, segments)
  const candidate = resolve(root, ...segments)
  const fromRoot = relative(root, candidate)
  if (
    fromRoot === '' ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new Error('image path escapes the import resource root')
  }
  const metadata = await lstat(candidate)
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error('image resource must be a regular file and cannot be a link')
  }
  if (metadata.size > MAX_IMPORT_RESOURCE_BYTES) throw new Error('image exceeds the 20 MiB limit')
  const canonical = await realpath(candidate)
  const canonicalRelative = relative(await realpath(root), canonical)
  if (
    canonicalRelative === '..' ||
    canonicalRelative.startsWith(`..${sep}`) ||
    isAbsolute(canonicalRelative)
  ) {
    throw new Error('image real path escapes the import resource root')
  }
  const extension = normalizedImageExtension(candidate)
  const mimeType =
    extension === '.png' ? 'image/png' : extension === '.jpg' ? 'image/jpeg' : 'image/webp'
  const bytes = await readFile(canonical)
  return {
    bytes,
    displayName: basename(candidate).slice(0, 500),
    extension,
    mimeType,
    sha256: sha256(bytes)
  }
}

async function assertNoSymlinkSegments(root: string, segments: string[]): Promise<void> {
  let current = root
  for (const segment of segments) {
    current = resolve(current, segment)
    const metadata = await lstat(current)
    if (metadata.isSymbolicLink()) throw new Error('image path contains a symbolic link')
  }
}

function normalizedImageExtension(path: string): '.png' | '.jpg' | '.webp' {
  const extension = extname(path).toLowerCase()
  if (extension === '.png') return '.png'
  if (extension === '.jpg' || extension === '.jpeg') return '.jpg'
  if (extension === '.webp') return '.webp'
  throw new Error('image type is not supported')
}

function flattenForActiveSection(sections: ManuscriptImportPlan['sections']): BlockNoteDocument {
  if (sections.length === 1) return sections[0]?.document ?? []
  return blockNoteDocumentSchema.parse(
    sections.flatMap((section) => [
      {
        id: randomUUID(),
        type: 'heading',
        props: {
          backgroundColor: 'default',
          textColor: 'default',
          textAlignment: 'left',
          level: 1,
          isToggleable: false
        },
        content: [{ type: 'text', text: section.title, styles: {} }],
        children: []
      },
      ...section.document
    ])
  )
}

function countBlocks(document: BlockNoteDocument): number {
  let total = 0
  const visit = (blocks: BlockNoteDocument): void => {
    for (const block of blocks) {
      total += 1
      visit(block.children)
    }
  }
  visit(document)
  return total
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function hashManifest(entries: readonly StageManifestEntry[]): string {
  const hash = createHash('sha256')
  for (const entry of [...entries].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, 'en')
  )) {
    hash.update(entry.relativePath)
    hash.update('\0')
    hash.update(String(entry.byteSize))
    hash.update('\0')
    hash.update(entry.sha256)
    hash.update('\n')
  }
  return hash.digest('hex')
}

function importSourceTitle(displayName: string): string {
  const extension = extname(displayName)
  return (basename(displayName, extension).trim() || 'Imported manuscript').slice(0, 500)
}
