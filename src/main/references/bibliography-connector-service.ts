import { randomUUID } from 'node:crypto'
import { constants, watch, type FSWatcher } from 'node:fs'
import { lstat, open, realpath, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path'
import type { Logger } from 'pino'
import {
  BIBLIOGRAPHY_ATTACHMENT_PAGE_SIZE,
  BIBLIOGRAPHY_SOURCE_MAX_BYTES,
  bibliographyImportAttachmentsPageSchema,
  bibliographyImportPlanSchema,
  type BibliographyConnector,
  type BibliographyConfirmImportSelection,
  type BibliographyImportOutcome,
  type BibliographyImportAttachmentsPage,
  type BibliographyImportPlan,
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
const MAX_SELECTED_ATTACHMENT_BYTES = 1024 * 1024 * 1024

interface ActiveSnapshot {
  readonly parsed: ParsedReferenceSource
  readonly snapshot: BibliographySnapshot
}

interface PrivateImportPlan {
  readonly projectId: string
  readonly projectSessionId: string
  readonly connectorId: string
  readonly candidateIds: ReadonlySet<string>
  readonly sourceFingerprint: string
  readonly expiresAt: number
  readonly attachments: Map<
    string,
    { candidateId: string; upstreamKey: string; path: string; byteSize: number }
  >
  readonly attachmentSources: Map<
    string,
    { upstreamKey: string; baseDirectory: string; rawPaths: readonly string[] }
  >
  readonly attachmentCursors: Map<
    string,
    {
      candidateId: string
      offset: number
      page?: BibliographyImportAttachmentsPage
      pagePromise?: Promise<BibliographyImportAttachmentsPage>
    }
  >
}

export class BibliographyConnectorService {
  readonly #repository: BibliographyConnectorRepository
  readonly #log: ConnectorLog
  readonly #resolveLibrary: (projectId: string) => ReferenceLibraryService | null
  readonly #resolveKnowledgeImports: (projectId: string) => KnowledgeImportService | null
  readonly #resolveAttachmentPaths: (citationKey: string) => Promise<string[]>
  readonly #snapshots = new Map<string, ActiveSnapshot>()
  readonly #watchers = new Map<string, FSWatcher>()
  readonly #watchedPaths = new Map<string, string>()
  readonly #debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  readonly #importPlans = new Map<string, PrivateImportPlan>()

  constructor(options: {
    repository: BibliographyConnectorRepository
    log: ConnectorLog
    resolveLibrary: (projectId: string) => ReferenceLibraryService | null
    resolveKnowledgeImports: (projectId: string) => KnowledgeImportService | null
    resolveAttachmentPaths?: (citationKey: string) => Promise<string[]>
  }) {
    this.#repository = options.repository
    this.#log = options.log
    this.#resolveLibrary = options.resolveLibrary
    this.#resolveKnowledgeImports = options.resolveKnowledgeImports
    this.#resolveAttachmentPaths = options.resolveAttachmentPaths ?? betterBibtexAttachmentPaths
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

  async prepareImport(options: {
    projectId: string
    projectSessionId: string
    connectorId: string
    candidateIds: ReadonlySet<string>
    includePdf: boolean
  }): Promise<BibliographyImportPlan> {
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
    const selected = active.parsed.items.filter((item) =>
      options.candidateIds.has(item.fingerprint)
    )
    if (selected.length !== options.candidateIds.size) {
      throw new Error('One or more bibliography candidates are stale')
    }
    const previewId = randomUUID()
    const expiresAt = Date.now() + 10 * 60_000
    const privatePreview: PrivateImportPlan = {
      projectId: options.projectId,
      projectSessionId: options.projectSessionId,
      connectorId: options.connectorId,
      candidateIds: options.candidateIds,
      sourceFingerprint: active.parsed.sourceFingerprint,
      expiresAt,
      attachments: new Map(),
      attachmentSources: new Map(),
      attachmentCursors: new Map()
    }
    const candidates = new Map(
      active.snapshot.candidates.map((candidate) => [candidate.candidateId, candidate])
    )
    const items: BibliographyImportPlan['items'] = []
    for (const item of selected) {
      const candidate = candidates.get(item.fingerprint)
      if (candidate === undefined || candidate.alreadyImportedReferenceId !== null) {
        throw new Error('Bibliography candidate is already imported or unavailable')
      }
      let rawPaths: readonly string[] = options.includePdf ? item.attachmentPaths : []
      if (options.includePdf && connector.sourceFormat === 'better-csl-json') {
        try {
          rawPaths = await this.#resolveAttachmentPaths(item.upstreamKey)
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
      privatePreview.attachmentSources.set(item.fingerprint, {
        upstreamKey: item.upstreamKey,
        baseDirectory: dirname(connector.sourcePath),
        rawPaths
      })
      const firstPage = await this.#readAttachmentPage(privatePreview, item.fingerprint, 0)
      const publicAttachments = firstPage.attachments
      items.push({
        ...candidate,
        pdfStatus: options.includePdf
          ? publicAttachments.length > 0
            ? 'available'
            : 'unavailable'
          : 'not_requested',
        attachments: publicAttachments,
        nextAttachmentCursor: firstPage.nextAttachmentCursor
      })
    }
    const publicPreview = bibliographyImportPlanSchema.parse({
      previewId,
      includePdf: options.includePdf,
      items,
      eligibleTargets: library.eligibleImportTargets(),
      expiresAt: new Date(expiresAt).toISOString()
    })
    this.#importPlans.set(previewId, privatePreview)
    return publicPreview
  }

  async importAttachmentsPage(options: {
    projectId: string
    projectSessionId: string
    previewId: string
    candidateId: string
    cursor: string
  }): Promise<BibliographyImportAttachmentsPage> {
    const preview = this.#importPlans.get(options.previewId)
    const cursor = preview?.attachmentCursors.get(options.cursor)
    if (
      preview === undefined ||
      preview.projectId !== options.projectId ||
      preview.projectSessionId !== options.projectSessionId ||
      preview.expiresAt < Date.now() ||
      !preview.candidateIds.has(options.candidateId) ||
      cursor === undefined ||
      cursor.candidateId !== options.candidateId
    ) {
      throw new Error('Attachment page cursor is unavailable, expired, or invalid')
    }
    if (cursor.page !== undefined) return cursor.page
    cursor.pagePromise ??= this.#readAttachmentPage(preview, options.candidateId, cursor.offset)
    cursor.page = await cursor.pagePromise
    return cursor.page
  }

  async confirmImport(options: {
    projectId: string
    previewId: string
    selections: readonly BibliographyConfirmImportSelection[]
  }): Promise<{
    references: ReturnType<ReferenceLibraryService['list']>
    outcomes: BibliographyImportOutcome[]
  }> {
    const preview = this.#importPlans.get(options.previewId)
    this.#importPlans.delete(options.previewId)
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
    const connector = this.#repository.find(preview.connectorId)
    const active = this.#snapshots.get(preview.connectorId)
    if (
      connector === null ||
      connector.projectId !== options.projectId ||
      active === undefined ||
      active.parsed.sourceFingerprint !== preview.sourceFingerprint
    ) {
      throw new Error('Bibliography snapshot changed; review the import again')
    }
    if (options.selections.length !== preview.candidateIds.size) {
      throw new Error('Every prepared Reference must be confirmed exactly once')
    }
    const sourceItems = new Map(
      active.parsed.items.map((item) => [item.fingerprint, item] as const)
    )
    const eligibleTargets = new Set(
      library.eligibleImportTargets().map((target) => target.referenceId)
    )
    const selectedAttachmentIds = new Set<string>()
    let selectedAttachmentBytes = 0
    for (const selection of options.selections) {
      if (!preview.candidateIds.has(selection.candidateId)) {
        throw new Error('Confirmed Reference is not part of this import plan')
      }
      if (
        selection.targetReferenceId !== null &&
        !eligibleTargets.has(selection.targetReferenceId)
      ) {
        throw new Error('Selected Reference target is no longer eligible')
      }
      for (const attachmentId of [
        selection.primaryAttachmentId,
        ...selection.supplementAttachmentIds
      ]) {
        if (attachmentId === null) continue
        const attachment = preview.attachments.get(attachmentId)
        if (
          attachment === undefined ||
          attachment.candidateId !== selection.candidateId ||
          selectedAttachmentIds.has(attachmentId)
        ) {
          throw new Error('Attachment selection is stale or belongs to another Reference')
        }
        selectedAttachmentIds.add(attachmentId)
        const inspected = await inspectPdfAttachment(attachment.path)
        selectedAttachmentBytes += inspected.byteSize
        if (selectedAttachmentBytes > MAX_SELECTED_ATTACHMENT_BYTES) {
          throw new Error('Selected PDF attachments exceed the 1 GiB import capacity')
        }
      }
    }

    const outcomes: BibliographyImportOutcome[] = []
    for (const selection of options.selections) {
      const sourceItem = sourceItems.get(selection.candidateId)
      if (sourceItem === undefined) {
        outcomes.push(failedOutcome(selection.candidateId, 'candidate_stale'))
        continue
      }
      let primaryKnowledgeId: string | null = null
      let attachmentError: BibliographyImportOutcome['errorCode'] = null
      if (selection.primaryAttachmentId !== null) {
        const primary = preview.attachments.get(selection.primaryAttachmentId)
        if (primary === undefined) {
          outcomes.push(failedOutcome(selection.candidateId, 'attachment_unavailable'))
          continue
        }
        try {
          await inspectPdfAttachment(primary.path)
          const knowledge = await imports.importPathWithIdentity(primary.path, {
            ensureIncompleteReference: false
          })
          const owner = library.referenceIdForKnowledge(knowledge.knowledgeItemId)
          if (owner !== null && owner !== selection.targetReferenceId) {
            outcomes.push(failedOutcome(selection.candidateId, 'pdf_already_linked'))
            continue
          }
          primaryKnowledgeId = knowledge.knowledgeItemId
        } catch (err) {
          this.#log.error(
            {
              event: 'reference.import.primary_pdf_failed',
              err,
              connectorId: preview.connectorId,
              candidateId: selection.candidateId
            },
            'Primary bibliography PDF import failed'
          )
          attachmentError = 'attachment_unavailable'
        }
      }

      let referenceId: string
      try {
        referenceId = library.materializeCandidate({
          connectorId: preview.connectorId,
          sourceFormat: connector.sourceFormat,
          sourceItem,
          targetReferenceId: selection.targetReferenceId
        })
      } catch (err) {
        this.#log.error(
          {
            event: 'reference.import.metadata_failed',
            err,
            connectorId: preview.connectorId,
            candidateId: selection.candidateId,
            targetReferenceId: selection.targetReferenceId
          },
          'Bibliography Reference materialization failed'
        )
        if (
          primaryKnowledgeId !== null &&
          library.referenceIdForKnowledge(primaryKnowledgeId) === null
        ) {
          const knowledge = imports
            .list()
            .find((item) => item.knowledgeItemId === primaryKnowledgeId)
          if (knowledge !== undefined) {
            try {
              library.ensureIncompleteForKnowledge(knowledge)
            } catch (recoveryErr) {
              this.#log.error(
                {
                  event: 'reference.import.incomplete_recovery_failed',
                  err: recoveryErr,
                  connectorId: preview.connectorId,
                  candidateId: selection.candidateId,
                  knowledgeItemId: primaryKnowledgeId
                },
                'Failed to recover an incomplete Reference after metadata import failure'
              )
            }
          }
        }
        outcomes.push(failedOutcome(selection.candidateId, 'target_unavailable'))
        continue
      }

      const importedKnowledgeItemIds: string[] = []
      if (primaryKnowledgeId !== null) {
        const linked = library.attachKnowledgeFailClosed(referenceId, primaryKnowledgeId, 'primary')
        if (linked.state === 'conflict') {
          outcomes.push(failedOutcome(selection.candidateId, 'pdf_already_linked'))
          continue
        }
        importedKnowledgeItemIds.push(primaryKnowledgeId)
      }
      for (const attachmentId of selection.supplementAttachmentIds) {
        const supplement = preview.attachments.get(attachmentId)
        if (supplement === undefined) continue
        let supplementKnowledgeId: string | null = null
        try {
          await inspectPdfAttachment(supplement.path)
          const knowledge = await imports.importPathWithIdentity(supplement.path, {
            ensureIncompleteReference: false
          })
          supplementKnowledgeId = knowledge.knowledgeItemId
          const linked = library.attachKnowledgeFailClosed(
            referenceId,
            knowledge.knowledgeItemId,
            'supplement'
          )
          if (linked.state === 'conflict') {
            attachmentError = 'pdf_already_linked'
            continue
          }
          importedKnowledgeItemIds.push(knowledge.knowledgeItemId)
        } catch (err) {
          this.#log.error(
            {
              event: 'reference.import.supplement_pdf_failed',
              err,
              connectorId: preview.connectorId,
              candidateId: selection.candidateId
            },
            'Supplemental bibliography PDF import failed'
          )
          if (
            supplementKnowledgeId !== null &&
            library.referenceIdForKnowledge(supplementKnowledgeId) === null
          ) {
            const knowledge = imports
              .list()
              .find((item) => item.knowledgeItemId === supplementKnowledgeId)
            if (knowledge !== undefined) {
              try {
                library.ensureIncompleteForKnowledge(knowledge)
              } catch (recoveryErr) {
                this.#log.error(
                  {
                    event: 'reference.import.supplement_recovery_failed',
                    err: recoveryErr,
                    connectorId: preview.connectorId,
                    candidateId: selection.candidateId,
                    knowledgeItemId: supplementKnowledgeId
                  },
                  'Failed to recover an incomplete Reference for a supplemental PDF'
                )
              }
            }
          }
          attachmentError = 'attachment_unavailable'
        }
      }
      outcomes.push({
        candidateId: selection.candidateId,
        referenceId,
        state:
          attachmentError !== null
            ? 'partial'
            : importedKnowledgeItemIds.length > 0
              ? 'complete'
              : 'citation_only',
        errorCode: attachmentError,
        importedKnowledgeItemIds
      })
    }
    return { references: library.list(), outcomes }
  }

  async #readAttachmentPage(
    preview: PrivateImportPlan,
    candidateId: string,
    startOffset: number
  ): Promise<BibliographyImportAttachmentsPage> {
    const source = preview.attachmentSources.get(candidateId)
    if (source === undefined) throw new Error('Attachment source is unavailable')
    const attachments: BibliographyImportAttachmentsPage['attachments'] = []
    let offset = startOffset
    while (
      offset < source.rawPaths.length &&
      attachments.length < BIBLIOGRAPHY_ATTACHMENT_PAGE_SIZE
    ) {
      const rawPath = source.rawPaths[offset]
      offset += 1
      if (rawPath === undefined || rawPath.length === 0 || rawPath.length > 32_768) continue
      try {
        const candidatePath = isAbsolute(rawPath) ? rawPath : resolve(source.baseDirectory, rawPath)
        const inspected = await inspectPdfAttachment(candidatePath)
        const attachmentId = randomUUID()
        preview.attachments.set(attachmentId, {
          candidateId,
          upstreamKey: source.upstreamKey,
          path: inspected.path,
          byteSize: inspected.byteSize
        })
        attachments.push({
          attachmentId,
          candidateId,
          fileName: basename(inspected.path),
          byteSize: inspected.byteSize
        })
      } catch (err) {
        this.#log.warn(
          {
            event: 'reference.attachment_candidate.rejected',
            err,
            connectorId: preview.connectorId,
            candidateId
          },
          'Untrusted bibliography attachment candidate was rejected'
        )
      }
    }
    let nextAttachmentCursor: string | null = null
    if (offset < source.rawPaths.length) {
      nextAttachmentCursor = randomUUID()
      preview.attachmentCursors.set(nextAttachmentCursor, { candidateId, offset })
    }
    return bibliographyImportAttachmentsPageSchema.parse({
      attachments,
      nextAttachmentCursor
    })
  }

  close(): void {
    for (const watcher of this.#watchers.values()) watcher.close()
    for (const timer of this.#debounceTimers.values()) clearTimeout(timer)
    this.#watchers.clear()
    this.#watchedPaths.clear()
    this.#debounceTimers.clear()
    this.#snapshots.clear()
    this.#importPlans.clear()
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

function failedOutcome(
  candidateId: string,
  errorCode: NonNullable<BibliographyImportOutcome['errorCode']>
): BibliographyImportOutcome {
  return {
    candidateId,
    referenceId: null,
    state: 'failed',
    errorCode,
    importedKnowledgeItemIds: []
  }
}

export async function betterBibtexAttachmentPaths(citationKey: string): Promise<string[]> {
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
    const payload = JSON.parse(await readBoundedResponseText(response, 4 * 1024 * 1024)) as {
      result?: unknown
      error?: unknown
    }
    if (payload.error !== undefined) throw new Error('Better BibTeX RPC returned an error')
    if (!Array.isArray(payload.result)) return []
    return payload.result.flatMap((value) => {
      if (typeof value === 'string') {
        return value.length > 0 && value.length <= 32_768 ? [value] : []
      }
      if (value === null || typeof value !== 'object') return []
      const record = value as Record<string, unknown>
      const path = record.path ?? record.localPath
      return typeof path === 'string' && path.length > 0 && path.length <= 32_768 ? [path] : []
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('Better BibTeX RPC response exceeds the 4 MiB limit')
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('Better BibTeX RPC response exceeds the 4 MiB limit')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
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
