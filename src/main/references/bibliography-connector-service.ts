import { randomUUID } from 'node:crypto'
import { constants, watch, type FSWatcher } from 'node:fs'
import { lstat, open, realpath, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path'
import type { Logger } from 'pino'
import {
  BIBLIOGRAPHY_SOURCE_MAX_BYTES,
  type BibliographyConnector,
  type BibliographyAttachmentPreview,
  type BibliographySnapshot
} from '../../shared/contracts/references'
import type { KnowledgeImportService } from '../knowledge/knowledge-import-service'
import type {
  BibliographyConnectorAuthority,
  BibliographyConnectorRepository
} from '../app-db/repositories/bibliography-connectors'
import { parseReferenceSource, type ParsedReferenceSource } from './reference-import-parser'
import type { ReferenceLibraryService } from './reference-library-service'

type ConnectorLog = Pick<Logger, 'info' | 'warn' | 'error'>

interface ActiveSnapshot {
  readonly parsed: ParsedReferenceSource
  readonly snapshot: BibliographySnapshot
}

interface PrivateAttachmentPreview {
  readonly projectId: string
  readonly connectorId: string
  readonly candidateIds: ReadonlySet<string>
  readonly expiresAt: number
  readonly attachments: ReadonlyMap<
    string,
    { candidateId: string; upstreamKey: string; path: string }
  >
  readonly public: BibliographyAttachmentPreview
}

export class BibliographyConnectorService {
  readonly #repository: BibliographyConnectorRepository
  readonly #log: ConnectorLog
  readonly #resolveLibrary: (projectId: string) => ReferenceLibraryService | null
  readonly #resolveKnowledgeImports: (projectId: string) => KnowledgeImportService | null
  readonly #snapshots = new Map<string, ActiveSnapshot>()
  readonly #watchers = new Map<string, FSWatcher>()
  readonly #watchedPaths = new Map<string, string>()
  readonly #debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  readonly #attachmentPreviews = new Map<string, PrivateAttachmentPreview>()

  constructor(options: {
    repository: BibliographyConnectorRepository
    log: ConnectorLog
    resolveLibrary: (projectId: string) => ReferenceLibraryService | null
    resolveKnowledgeImports: (projectId: string) => KnowledgeImportService | null
  }) {
    this.#repository = options.repository
    this.#log = options.log
    this.#resolveLibrary = options.resolveLibrary
    this.#resolveKnowledgeImports = options.resolveKnowledgeImports
  }

  async connect(projectId: string, selectedPath: string): Promise<BibliographySnapshot> {
    const inspected = await inspectSelectedSource(selectedPath)
    const connector = this.#repository.connect({
      projectId,
      sourcePath: inspected.path,
      sourceFormat: inspected.format
    })
    this.#replaceWatcher(connector.connectorId, inspected.path)
    return this.refresh(connector.connectorId, projectId)
  }

  snapshot(projectId: string): BibliographySnapshot | null {
    const connector = this.#repository.findForProject(projectId)
    if (connector === null) return null
    this.#replaceWatcher(connector.connectorId, connector.sourcePath)
    const active = this.#snapshots.get(connector.connectorId)
    return active === undefined
      ? null
      : { ...active.snapshot, connector: publicConnector(connector) }
  }

  async refreshForProject(projectId: string): Promise<BibliographySnapshot | null> {
    const connector = this.#repository.findForProject(projectId)
    if (connector === null) return null
    this.#replaceWatcher(connector.connectorId, connector.sourcePath)
    return this.refresh(connector.connectorId, projectId)
  }

  async refresh(connectorId: string, projectId: string): Promise<BibliographySnapshot> {
    const connector = this.#repository.find(connectorId)
    if (connector === null || connector.projectId !== projectId) {
      throw new Error('Bibliography connector is unavailable for this project')
    }
    const library = this.#resolveLibrary(projectId)
    if (library === null) throw new Error('Bibliography project is not active')
    const startedAt = Date.now()
    try {
      const source = await readStableSource(connector.sourcePath)
      const parsed = parseReferenceSource(source, connector.sourceFormat)
      const readyConnector = this.#repository.recordSuccess(connectorId, parsed.sourceFingerprint)
      const snapshot = library.synchronizeSnapshot({
        connector: publicConnector(readyConnector),
        source: parsed,
        sourceFormat: connector.sourceFormat
      })
      this.#snapshots.set(connectorId, { parsed, snapshot })
      this.#log.info(
        {
          event: 'reference.connector_refresh.completed',
          connectorId,
          projectId,
          validItemCount: parsed.items.length,
          skippedItemCount: parsed.issues.length,
          durationMs: Date.now() - startedAt
        },
        'Bibliography connector refreshed'
      )
      return snapshot
    } catch (err) {
      const errorCode = connectorErrorCode(err)
      this.#repository.recordFailure(connectorId, errorCode)
      this.#log.error(
        {
          event: 'reference.connector_refresh.failed',
          err,
          connectorId,
          projectId,
          errorCode,
          durationMs: Date.now() - startedAt
        },
        'Bibliography connector refresh failed; retaining last-known-good snapshot'
      )
      throw new Error('Bibliography connector could not be refreshed', { cause: err })
    }
  }

  importCandidates(options: {
    projectId: string
    connectorId: string
    candidateIds: ReadonlySet<string>
  }): ReturnType<ReferenceLibraryService['importCandidates']> {
    const connector = this.#repository.find(options.connectorId)
    const active = this.#snapshots.get(options.connectorId)
    const library = this.#resolveLibrary(options.projectId)
    if (
      connector === null ||
      connector.projectId !== options.projectId ||
      active === undefined ||
      library === null
    ) {
      throw new Error('Bibliography snapshot is unavailable or stale')
    }
    return library.importCandidates({
      connectorId: options.connectorId,
      sourceFormat: connector.sourceFormat,
      source: active.parsed,
      candidateIds: options.candidateIds
    })
  }

  async previewAttachments(options: {
    projectId: string
    connectorId: string
    candidateIds: ReadonlySet<string>
  }): Promise<BibliographyAttachmentPreview> {
    const connector = this.#repository.find(options.connectorId)
    const active = this.#snapshots.get(options.connectorId)
    if (connector === null || connector.projectId !== options.projectId || active === undefined) {
      throw new Error('Bibliography snapshot is unavailable or stale')
    }
    const selected = active.parsed.items.filter((item) =>
      options.candidateIds.has(item.fingerprint)
    )
    if (selected.length !== options.candidateIds.size) {
      throw new Error('One or more attachment candidates are stale')
    }
    const previewId = randomUUID()
    const attachments = new Map<
      string,
      { candidateId: string; upstreamKey: string; path: string }
    >()
    const publicAttachments: BibliographyAttachmentPreview['attachments'] = []
    const unavailableCandidateIds: string[] = []
    for (const item of selected) {
      let rawPaths: readonly string[] = item.attachmentPaths
      if (connector.sourceFormat === 'better-csl-json') {
        try {
          rawPaths = await betterBibtexAttachmentPaths(item.upstreamKey)
        } catch (err) {
          this.#log.warn(
            {
              event: 'reference.better_bibtex_rpc.unavailable',
              err,
              connectorId: options.connectorId,
              candidateId: item.fingerprint
            },
            'Better BibTeX attachment lookup is unavailable; retaining metadata-only import'
          )
          rawPaths = []
        }
      }
      let validForItem = 0
      for (const rawPath of rawPaths.slice(0, 20)) {
        try {
          const candidatePath = isAbsolute(rawPath)
            ? rawPath
            : resolve(dirname(connector.sourcePath), rawPath)
          const inspected = await inspectPdfAttachment(candidatePath)
          const attachmentId = randomUUID()
          attachments.set(attachmentId, {
            candidateId: item.fingerprint,
            upstreamKey: item.upstreamKey,
            path: inspected.path
          })
          publicAttachments.push({
            attachmentId,
            candidateId: item.fingerprint,
            fileName: basename(inspected.path),
            byteSize: inspected.byteSize
          })
          validForItem += 1
        } catch (err) {
          this.#log.warn(
            {
              event: 'reference.attachment_candidate.rejected',
              err,
              connectorId: options.connectorId,
              candidateId: item.fingerprint
            },
            'Untrusted bibliography attachment candidate was rejected'
          )
        }
      }
      if (validForItem === 0) unavailableCandidateIds.push(item.fingerprint)
    }
    const publicPreview = {
      previewId,
      attachments: publicAttachments,
      unavailableCandidateIds
    }
    this.#attachmentPreviews.set(previewId, {
      projectId: options.projectId,
      connectorId: options.connectorId,
      candidateIds: options.candidateIds,
      expiresAt: Date.now() + 10 * 60_000,
      attachments,
      public: publicPreview
    })
    return publicPreview
  }

  async confirmAttachments(options: {
    projectId: string
    previewId: string
    attachmentIds: ReadonlySet<string>
  }): Promise<{
    references: ReturnType<ReferenceLibraryService['list']>
    importedKnowledgeItemIds: string[]
  }> {
    const preview = this.#attachmentPreviews.get(options.previewId)
    this.#attachmentPreviews.delete(options.previewId)
    if (
      preview === undefined ||
      preview.projectId !== options.projectId ||
      preview.expiresAt < Date.now()
    ) {
      throw new Error('Attachment import preview is unavailable or expired')
    }
    const library = this.#resolveLibrary(options.projectId)
    const imports = this.#resolveKnowledgeImports(options.projectId)
    if (library === null || imports === null) throw new Error('Bibliography project is not active')
    this.importCandidates({
      projectId: options.projectId,
      connectorId: preview.connectorId,
      candidateIds: preview.candidateIds
    })
    const importedKnowledgeItemIds: string[] = []
    const primaryReferenceIds = new Set<string>()
    for (const attachmentId of options.attachmentIds) {
      const attachment = preview.attachments.get(attachmentId)
      if (attachment === undefined) throw new Error('Attachment selection is stale')
      await inspectPdfAttachment(attachment.path)
      const knowledge = await imports.importPathWithIdentity(attachment.path)
      const referenceId = library.referenceIdForBinding(preview.connectorId, attachment.upstreamKey)
      if (referenceId === null) throw new Error('Imported Reference binding is unavailable')
      library.linkKnowledge(
        referenceId,
        knowledge.knowledgeItemId,
        primaryReferenceIds.has(referenceId) ? 'supplement' : 'primary'
      )
      primaryReferenceIds.add(referenceId)
      importedKnowledgeItemIds.push(knowledge.knowledgeItemId)
    }
    return { references: library.list(), importedKnowledgeItemIds }
  }

  close(): void {
    for (const watcher of this.#watchers.values()) watcher.close()
    for (const timer of this.#debounceTimers.values()) clearTimeout(timer)
    this.#watchers.clear()
    this.#watchedPaths.clear()
    this.#debounceTimers.clear()
    this.#snapshots.clear()
    this.#attachmentPreviews.clear()
  }

  #replaceWatcher(connectorId: string, sourcePath: string): void {
    if (this.#watchedPaths.get(connectorId) === sourcePath) return
    this.#watchers.get(connectorId)?.close()
    this.#watchers.delete(connectorId)
    this.#watchedPaths.delete(connectorId)
    const expectedName = basename(sourcePath)
    const watcher = watch(dirname(sourcePath), { persistent: false }, (event, filename) => {
      if (!shouldRefreshBibliographyWatch(event, filename, expectedName)) return
      const previous = this.#debounceTimers.get(connectorId)
      if (previous !== undefined) clearTimeout(previous)
      this.#debounceTimers.set(
        connectorId,
        setTimeout(() => {
          this.#debounceTimers.delete(connectorId)
          const connector = this.#repository.find(connectorId)
          if (connector === null) return
          void this.refresh(connectorId, connector.projectId).catch(() => undefined)
        }, 300)
      )
    })
    watcher.on('error', (err) => {
      this.#log.error(
        { event: 'reference.connector_watch.failed', err, connectorId },
        'Bibliography connector watcher failed'
      )
    })
    this.#watchers.set(connectorId, watcher)
    this.#watchedPaths.set(connectorId, sourcePath)
  }
}

export function shouldRefreshBibliographyWatch(
  event: string,
  filename: string | Buffer | null,
  expectedName: string
): boolean {
  return (event === 'change' || event === 'rename') && filename?.toString() === expectedName
}

async function betterBibtexAttachmentPaths(citationKey: string): Promise<string[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5_000)
  try {
    const response = await fetch('http://127.0.0.1:23119/better-bibtex/json-rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: randomUUID(),
        method: 'item.attachments',
        params: [citationKey, '*']
      }),
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`Better BibTeX RPC returned ${response.status}`)
    const payload = (await response.json()) as { result?: unknown; error?: unknown }
    if (payload.error !== undefined) throw new Error('Better BibTeX RPC returned an error')
    if (!Array.isArray(payload.result)) return []
    return payload.result.flatMap((value) => {
      if (typeof value === 'string') return [value]
      if (value === null || typeof value !== 'object') return []
      const record = value as Record<string, unknown>
      const path = record.path ?? record.localPath
      return typeof path === 'string' ? [path] : []
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function inspectPdfAttachment(path: string): Promise<{ path: string; byteSize: number }> {
  const entry = await lstat(path)
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new Error('Attachment must be a regular non-symbolic-link file')
  }
  if (entry.size <= 0 || entry.size > 200 * 1024 * 1024) {
    throw new Error('Attachment size is outside the allowed range')
  }
  if (extname(path).toLocaleLowerCase() !== '.pdf') {
    throw new Error('Only PDF bibliography attachments are supported')
  }
  const canonicalPath = await realpath(path)
  const handle = await open(canonicalPath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const header = Buffer.alloc(5)
    await handle.read(header, 0, 5, 0)
    if (header.toString('ascii') !== '%PDF-') throw new Error('Attachment is not a PDF file')
  } finally {
    await handle.close()
  }
  return { path: canonicalPath, byteSize: entry.size }
}

export async function inspectSelectedSource(selectedPath: string): Promise<{
  path: string
  format: 'better-csl-json' | 'bibtex'
}> {
  if (!isAbsolute(selectedPath)) throw new Error('Bibliography source must be an absolute path')
  const selectedStat = await lstat(selectedPath)
  if (selectedStat.isSymbolicLink() || !selectedStat.isFile()) {
    throw new Error('Bibliography source must be a regular non-symbolic-link file')
  }
  if (selectedStat.size <= 0 || selectedStat.size > BIBLIOGRAPHY_SOURCE_MAX_BYTES) {
    throw new Error('Bibliography source size is outside the allowed range')
  }
  const canonicalPath = await realpath(selectedPath)
  const extension = extname(selectedPath).toLocaleLowerCase()
  const format = extension === '.json' ? 'better-csl-json' : extension === '.bib' ? 'bibtex' : null
  if (format === null) throw new Error('Bibliography source extension is unsupported')
  return { path: canonicalPath, format }
}

export async function readStableSource(sourcePath: string): Promise<string> {
  const first = await stat(sourcePath)
  await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 75))
  const second = await stat(sourcePath)
  if (first.size !== second.size || first.mtimeMs !== second.mtimeMs) {
    throw new Error('Bibliography source is still changing')
  }
  if (second.size <= 0 || second.size > BIBLIOGRAPHY_SOURCE_MAX_BYTES) {
    throw new Error('Bibliography source size is outside the allowed range')
  }
  const handle = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.size !== second.size) {
      throw new Error('Bibliography source identity changed before reading')
    }
    const source = await handle.readFile('utf8')
    const after = await handle.stat()
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error('Bibliography source changed while reading')
    }
    return source
  } finally {
    await handle.close()
  }
}

function publicConnector(connector: BibliographyConnectorAuthority): BibliographyConnector {
  return {
    connectorId: connector.connectorId,
    sourceName: connector.sourceName,
    sourceFormat: connector.sourceFormat,
    state: connector.state,
    lastSnapshotSha256: connector.lastSnapshotSha256,
    lastErrorCode: connector.lastErrorCode,
    lastRefreshedAt: connector.lastRefreshedAt,
    updatedAt: connector.updatedAt
  }
}

function connectorErrorCode(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'ENOENT') return 'source_missing'
  if (code === 'ELOOP') return 'source_symlink_rejected'
  if (err instanceof SyntaxError) return 'source_json_invalid'
  return 'source_refresh_failed'
}
