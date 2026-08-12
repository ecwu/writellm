import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { Logger } from 'pino'
import {
  MANUSCRIPT_SEARCH_MAX_RESULTS,
  manuscriptSearchNavigationResultSchema,
  manuscriptSearchResultSchema,
  type ManuscriptSearchHit,
  type ManuscriptSearchNavigationInput,
  type ManuscriptSearchNavigationResult,
  type ManuscriptSearchResult,
  type ManuscriptSearchTargetContract,
  type ParsedManuscriptSearchInput
} from '../../shared/contracts/manuscript-search'
import type { ManuscriptAssembly, Section } from '../../shared/contracts/manuscript'
import {
  enumerateManuscriptSearchSurfaces,
  findProjectionMatchesCooperatively,
  SearchProjectionSliceLimitError,
  targetForSurfaceMatch,
  type ManuscriptSearchSurface,
  type ManuscriptSearchTarget,
  type ProjectionMatch,
  type SearchableSection,
  type Utf16Range
} from '../../shared/manuscript-search'
import type { ManuscriptService } from './manuscript-service'

const SEARCH_BUDGET_MS = 250
// Keep scheduling headroom so observation and dispatch overhead stay under the 16 ms gate.
const SEARCH_SLICE_MS = 12

class SearchBudgetExceededError extends Error {}

interface CursorPayload {
  version: 1
  snapshotFingerprint: string
  requestFingerprint: string
  offset: number
  checksum: string
}

export interface ManuscriptSearchMetrics {
  durationMs: number
  maxSynchronousSliceMs: number
}

export class ManuscriptSearchError extends Error {
  constructor(
    readonly code: 'invalid_cursor' | 'stale_cursor' | 'aborted',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'ManuscriptSearchError'
  }
}

export class ManuscriptSearchService {
  readonly #manuscript: ManuscriptService
  readonly #log: Pick<Logger, 'info' | 'error'>
  readonly #now: () => number
  readonly #yieldToMain: () => Promise<void>

  constructor(options: {
    manuscript: ManuscriptService
    log: Pick<Logger, 'info' | 'error'>
    now?: () => number
    yieldToMain?: () => Promise<void>
  }) {
    this.#manuscript = options.manuscript
    this.#log = options.log
    this.#now = options.now ?? (() => performance.now())
    this.#yieldToMain =
      options.yieldToMain ?? (() => new Promise((resolve) => setImmediate(resolve)))
  }

  async search(
    input: ParsedManuscriptSearchInput,
    signal: AbortSignal,
    options: { budgetMs?: number } = {}
  ): Promise<ManuscriptSearchResult & { metrics: ManuscriptSearchMetrics }> {
    const startedAt = this.#now()
    try {
      const assembly = this.#manuscript.assemble()
      const snapshotFingerprint = fingerprintAssembly(assembly)
      const requestFingerprint = fingerprintRequest(input)
      const offset = decodeCursor(input.cursor, snapshotFingerprint, requestFingerprint)
      const sections = selectSections(assembly, input)
      const allHits: ManuscriptSearchHit[] = []
      let scannedSections = 0
      let scannedSurfaces = 0
      let scannedBytes = 0
      let slowPathSurfaces = 0
      let incompleteReason: ManuscriptSearchResult['incompleteReason'] = null
      let sliceStartedAt = this.#now()
      let maxSynchronousSliceMs = 0
      const budgetMs = options.budgetMs ?? SEARCH_BUDGET_MS
      const checkpoint = async (): Promise<void> => {
        const now = this.#now()
        maxSynchronousSliceMs = Math.max(maxSynchronousSliceMs, now - sliceStartedAt)
        if (now - startedAt >= budgetMs) throw new SearchBudgetExceededError()
        if (now - sliceStartedAt < SEARCH_SLICE_MS) return
        await this.#yieldToMain()
        assertNotAborted(signal)
        sliceStartedAt = this.#now()
      }

      for (const searchable of sections) {
        assertNotAborted(signal)
        const section = assembly.sections.find(
          (entry) => entry.section.sectionId === searchable.sectionId
        )?.section
        if (section === undefined) continue
        for (const surface of enumerateManuscriptSearchSurfaces([searchable])) {
          assertNotAborted(signal)
          scannedSurfaces += 1
          scannedBytes += Buffer.byteLength(surface.text, 'utf8')
          let found: Awaited<ReturnType<typeof findProjectionMatchesCooperatively>>
          try {
            found = await findProjectionMatchesCooperatively(
              surface.text,
              input.query,
              input.caseSensitive,
              {
                checkpoint,
                maxMatches: MANUSCRIPT_SEARCH_MAX_RESULTS - allHits.length
              }
            )
          } catch (err) {
            if (
              err instanceof SearchBudgetExceededError ||
              err instanceof SearchProjectionSliceLimitError
            ) {
              incompleteReason = 'scan_budget'
              break
            }
            throw err
          }
          if (found.slowPath) slowPathSurfaces += 1
          for (const match of found.matches) {
            const target = targetForSurfaceMatch(surface, match)
            allHits.push(createHit(assembly, section, surface, target, match, input))
            if (allHits.length >= MANUSCRIPT_SEARCH_MAX_RESULTS) {
              incompleteReason = 'result_limit'
              break
            }
          }
          if (incompleteReason !== null) break
          const now = this.#now()
          maxSynchronousSliceMs = Math.max(maxSynchronousSliceMs, now - sliceStartedAt)
          if (now - startedAt >= budgetMs) {
            incompleteReason = 'scan_budget'
            break
          }
          if (now - sliceStartedAt >= SEARCH_SLICE_MS) {
            await this.#yieldToMain()
            assertNotAborted(signal)
            sliceStartedAt = this.#now()
          }
        }
        scannedSections += 1
        if (incompleteReason !== null) break
      }
      maxSynchronousSliceMs = Math.max(maxSynchronousSliceMs, this.#now() - sliceStartedAt)
      const hits = allHits.slice(offset, offset + input.limit)
      const nextOffset = offset + hits.length
      const nextCursor =
        nextOffset < allHits.length
          ? encodeCursor(snapshotFingerprint, requestFingerprint, nextOffset)
          : null
      const result = manuscriptSearchResultSchema.parse({
        snapshotFingerprint,
        hits,
        nextCursor,
        complete: incompleteReason === null,
        incompleteReason,
        scannedSections,
        scannedSurfaces,
        scannedBytes,
        slowPathSurfaces,
        resultCount: allHits.length
      })
      const metrics = { durationMs: this.#now() - startedAt, maxSynchronousSliceMs }
      this.#log.info(
        {
          event: 'manuscript.search.completed',
          mode: input.caseSensitive ? 'case_sensitive' : 'case_insensitive',
          queryUtf16Length: input.query.length,
          sectionFilterCount: input.scope.type === 'sections' ? input.scope.sectionIds.length : 0,
          statusFilterCount: input.statuses.length,
          scannedSections,
          scannedSurfaces,
          scannedBytes,
          slowPathSurfaces,
          hitCount: allHits.length,
          incompleteReason,
          durationMs: metrics.durationMs
        },
        'Manuscript search completed'
      )
      return { ...result, metrics }
    } catch (err) {
      this.#log.error(
        {
          event: signal.aborted ? 'manuscript.search.cancelled' : 'manuscript.search.failed',
          err,
          mode: input.caseSensitive ? 'case_sensitive' : 'case_insensitive',
          queryUtf16Length: input.query.length,
          durationMs: this.#now() - startedAt
        },
        'Manuscript search failed'
      )
      throw err
    }
  }

  async revalidate(
    input: ManuscriptSearchNavigationInput,
    signal: AbortSignal = new AbortController().signal
  ): Promise<ManuscriptSearchNavigationResult> {
    const startedAt = this.#now()
    try {
      if (hashMatch(input.caseSensitive, input.target, input.sourceSliceHash) !== input.matchId) {
        return { status: 'stale' }
      }
      const assembly = this.#manuscript.assemble()
      const sectionEntry = assembly.sections.find(
        (entry) => entry.section.sectionId === input.target.sectionId
      )
      if (sectionEntry === undefined) return { status: 'stale' }
      const searchable = toSearchable(sectionEntry)
      let sliceStartedAt = this.#now()
      const checkpoint = async (): Promise<void> => {
        if (this.#now() - sliceStartedAt < SEARCH_SLICE_MS) return
        await this.#yieldToMain()
        assertNotAborted(signal)
        sliceStartedAt = this.#now()
      }
      for (const surface of enumerateManuscriptSearchSurfaces([searchable])) {
        if (!surfaceMatchesTarget(surface, input.target)) continue
        let matches: ProjectionMatch[]
        try {
          matches = (
            await findProjectionMatchesCooperatively(
              surface.text,
              input.query,
              input.caseSensitive,
              { checkpoint, maxMatches: MANUSCRIPT_SEARCH_MAX_RESULTS }
            )
          ).matches
        } catch (err) {
          if (err instanceof SearchProjectionSliceLimitError) return { status: 'stale' }
          throw err
        }
        for (const match of matches) {
          const target = targetForSurfaceMatch(surface, match)
          const slice = surface.text.slice(match.from, match.to)
          if (hash(slice) === input.sourceSliceHash && sameTargetLocation(target, input.target)) {
            const result = manuscriptSearchNavigationResultSchema.parse({
              status: 'valid',
              sectionId: sectionEntry.section.sectionId,
              revisionId:
                target.kind === 'section_title' || target.kind === 'section_objective'
                  ? null
                  : sectionEntry.revision.sectionRevisionId,
              target
            })
            this.#log.info(
              {
                event: 'manuscript.search_navigation.validated',
                sectionId: sectionEntry.section.sectionId,
                targetKind: target.kind,
                durationMs: this.#now() - startedAt
              },
              'Manuscript search navigation validated'
            )
            return result
          }
        }
      }
      this.#log.info(
        {
          event: 'manuscript.search_navigation.stale',
          sectionId: input.target.sectionId,
          targetKind: input.target.kind,
          durationMs: this.#now() - startedAt
        },
        'Manuscript search navigation became stale'
      )
      return { status: 'stale' }
    } catch (err) {
      this.#log.error(
        {
          event: 'manuscript.search_navigation.failed',
          err,
          sectionId: input.target.sectionId,
          targetKind: input.target.kind,
          durationMs: this.#now() - startedAt
        },
        'Manuscript search navigation validation failed'
      )
      throw err
    }
  }
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new ManuscriptSearchError('aborted', 'Manuscript search was cancelled')
}

function surfaceMatchesTarget(
  surface: ManuscriptSearchSurface,
  target: ManuscriptSearchTargetContract
): boolean {
  if (surface.sectionId !== target.sectionId) return false
  switch (target.kind) {
    case 'section_title':
    case 'section_objective':
      return surface.kind === target.kind
    case 'block_inline':
      return surface.kind === 'block_inline' && surface.blockId === target.blockId
    case 'block_caption':
      return surface.kind === 'block_caption' && surface.blockId === target.blockId
    case 'table_cell':
      return (
        surface.kind === 'table_cell' &&
        surface.blockId === target.blockId &&
        surface.rowIndex === target.rowIndex &&
        surface.cellIndex === target.cellIndex
      )
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function fingerprintAssembly(assembly: ManuscriptAssembly): string {
  return hash(
    JSON.stringify({
      version: 1,
      outlineVersion: assembly.outlineVersion,
      sections: assembly.sections.map(({ section, revision }) => ({
        sectionId: section.sectionId,
        parentSectionId: section.parentSectionId,
        position: section.position,
        level: section.level,
        status: section.status,
        titleHash: hash(section.title),
        objectiveHash: hash(section.objective ?? ''),
        revisionId: revision.sectionRevisionId,
        contentHash: revision.contentHash
      }))
    })
  )
}

function fingerprintRequest(input: ParsedManuscriptSearchInput): string {
  return hash(
    JSON.stringify({
      version: 1,
      query: input.query,
      caseSensitive: input.caseSensitive,
      scope: input.scope,
      statuses: [...input.statuses].sort()
    })
  )
}

function cursorChecksum(payload: Omit<CursorPayload, 'checksum'>): string {
  return hash(JSON.stringify(payload))
}

function encodeCursor(
  snapshotFingerprint: string,
  requestFingerprint: string,
  offset: number
): string {
  const unsigned = { version: 1 as const, snapshotFingerprint, requestFingerprint, offset }
  return Buffer.from(JSON.stringify({ ...unsigned, checksum: cursorChecksum(unsigned) })).toString(
    'base64url'
  )
}

function decodeCursor(
  cursor: string | undefined,
  snapshotFingerprint: string,
  requestFingerprint: string
): number {
  if (cursor === undefined) return 0
  let parsed: CursorPayload
  try {
    const decoded = Buffer.from(cursor, 'base64url')
    if (decoded.toString('base64url') !== cursor) {
      throw new Error('Search cursor encoding is not canonical')
    }
    parsed = JSON.parse(decoded.toString('utf8')) as CursorPayload
  } catch (err) {
    throw new ManuscriptSearchError('invalid_cursor', 'Search cursor is invalid', { cause: err })
  }
  const { checksum, ...unsigned } = parsed
  if (
    parsed.version !== 1 ||
    !Number.isSafeInteger(parsed.offset) ||
    parsed.offset < 0 ||
    checksum !== cursorChecksum(unsigned)
  ) {
    throw new ManuscriptSearchError('invalid_cursor', 'Search cursor is invalid')
  }
  if (
    parsed.snapshotFingerprint !== snapshotFingerprint ||
    parsed.requestFingerprint !== requestFingerprint
  ) {
    throw new ManuscriptSearchError('stale_cursor', 'Search cursor is stale')
  }
  return parsed.offset
}

function selectSections(
  assembly: ManuscriptAssembly,
  input: ParsedManuscriptSearchInput
): SearchableSection[] {
  const sections = assembly.sections.filter(({ section }) => {
    if (input.statuses.length > 0 && !input.statuses.includes(section.status)) return false
    if (input.scope.type === 'manuscript') return true
    if (input.scope.type === 'sections') return input.scope.sectionIds.includes(section.sectionId)
    let current: Section | undefined = section
    while (current !== undefined) {
      if (current.sectionId === input.scope.rootSectionId) return true
      current = assembly.sections.find(
        (entry) => entry.section.sectionId === current?.parentSectionId
      )?.section
    }
    return false
  })
  return sections.map(toSearchable)
}

function toSearchable(entry: ManuscriptAssembly['sections'][number]): SearchableSection {
  return {
    sectionId: entry.section.sectionId,
    revisionId: entry.revision.sectionRevisionId,
    title: entry.section.title,
    objective: entry.section.objective,
    status: entry.section.status,
    content: entry.revision.content
  }
}

function headingPath(assembly: ManuscriptAssembly, section: Section): string[] {
  const path: string[] = []
  let current: Section | undefined = section
  while (current !== undefined) {
    path.unshift(current.title)
    current = assembly.sections.find(
      (entry) => entry.section.sectionId === current?.parentSectionId
    )?.section
  }
  return path
}

function matchRange(target: ManuscriptSearchTarget): Utf16Range {
  return target.kind === 'block_inline' || target.kind === 'table_cell'
    ? target.flatRange
    : target.range
}

type NavigationTarget = ManuscriptSearchTarget | ManuscriptSearchTargetContract

function hashMatch(
  caseSensitive: boolean,
  target: NavigationTarget,
  sourceSliceHash: string
): string {
  return hash(JSON.stringify({ version: 1, caseSensitive, target, sourceSliceHash }))
}

function targetLocation(target: NavigationTarget): unknown {
  switch (target.kind) {
    case 'section_title':
    case 'section_objective':
      return target
    case 'block_inline':
    case 'table_cell':
    case 'block_caption': {
      const { revisionId: _revisionId, ...location } = target
      return location
    }
  }
}

function sameTargetLocation(
  current: ManuscriptSearchTarget,
  returned: ManuscriptSearchTargetContract
): boolean {
  return JSON.stringify(targetLocation(current)) === JSON.stringify(targetLocation(returned))
}

function createHit(
  assembly: ManuscriptAssembly,
  section: Section,
  surface: ManuscriptSearchSurface,
  target: ManuscriptSearchTarget,
  match: Utf16Range,
  input: ParsedManuscriptSearchInput
): ManuscriptSearchHit {
  const before = Math.min(240, match.from)
  const after = Math.min(600, surface.text.length - match.to)
  const excerptFrom = match.from - before
  const excerptTo = match.to + after
  const sourceSliceHash = hash(surface.text.slice(match.from, match.to))
  return {
    matchId: hashMatch(input.caseSensitive, target, sourceSliceHash),
    sourceSliceHash,
    sectionTitle: section.title,
    sectionStatus: section.status,
    headingPath: headingPath(assembly, section),
    excerpt: surface.text.slice(excerptFrom, excerptTo),
    excerptMatch: {
      from: matchRange(target).from - excerptFrom,
      to: matchRange(target).to - excerptFrom
    },
    target
  }
}
