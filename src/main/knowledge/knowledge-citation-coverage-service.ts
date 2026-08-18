import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  knowledgeCitationCoveragePageResultSchema,
  type KnowledgeCitationCoverageFilter,
  type KnowledgeCitationCoverageItem,
  type KnowledgeCitationCoveragePageResult
} from '../../shared/contracts/knowledge'
import {
  buildManuscriptReferenceIndex,
  normalizeCitationTitle
} from '../../shared/readable-citation'
import type { ManuscriptService } from '../manuscript/manuscript-service'
import type { ProjectIndexService } from '../search/index-service'

const cursorSchema = z
  .object({
    snapshotId: z.string().regex(/^[a-f0-9]{64}$/),
    filter: z.enum(['all', 'cited', 'uncited', 'attention']),
    query: z.string().max(512),
    offset: z.number().int().nonnegative().max(55_000)
  })
  .strict()

export class KnowledgeCitationCoverageService {
  constructor(
    private readonly options: {
      manuscript: Pick<ManuscriptService, 'assemble'>
      projectIndex: Pick<ProjectIndexService, 'currentIndexedSources'>
    }
  ) {}

  async page(
    input: {
      filter: KnowledgeCitationCoverageFilter
      query: string
      cursor?: string
      limit: number
    },
    signal: AbortSignal
  ): Promise<KnowledgeCitationCoveragePageResult> {
    signal.throwIfAborted()
    const indexed = await this.options.projectIndex.currentIndexedSources(signal)
    if (indexed.state === 'preparing') {
      return knowledgeCitationCoveragePageResultSchema.parse({
        state: 'preparing',
        reason: 'index_preparing'
      })
    }
    if (indexed.state === 'unavailable') {
      return knowledgeCitationCoveragePageResultSchema.parse({
        state: 'unavailable',
        reason: 'index_unavailable'
      })
    }

    signal.throwIfAborted()
    const assembly = this.options.manuscript.assemble()
    const references = buildManuscriptReferenceIndex(
      assembly.sections.map(({ section, revision }) => ({
        sectionId: section.sectionId,
        sectionRevisionId: revision.sectionRevisionId,
        content: revision.content
      }))
    )
    const snapshotId = fingerprint(indexed.generationId, assembly)
    const coverage = matchCoverage(indexed.sources, references.entries)
    const summary = {
      indexedSourceCount: coverage.sources.length,
      citedSourceCount: coverage.sources.filter((item) => item.status === 'cited').length,
      uncitedSourceCount: coverage.sources.filter((item) => item.status === 'uncited').length,
      ambiguousSourceCount: coverage.sources.filter((item) => item.status === 'ambiguous').length,
      unmatchedCitationTitleCount: coverage.unmatched.length,
      unmatchedCitationOccurrenceCount: coverage.unmatched.reduce(
        (total, item) => total + item.citationCount,
        0
      ),
      attentionCount:
        coverage.sources.filter((item) => item.status === 'ambiguous').length +
        coverage.unmatched.length,
      coverageRatio:
        coverage.sources.length === 0
          ? null
          : coverage.sources.filter((item) => item.status === 'cited').length /
            coverage.sources.length
    }

    const confirmed = await this.options.projectIndex.currentIndexedSources(signal)
    if (confirmed.state === 'unavailable') {
      return knowledgeCitationCoveragePageResultSchema.parse({
        state: 'unavailable',
        reason: 'index_unavailable'
      })
    }
    if (confirmed.state !== 'ready' || confirmed.generationId !== indexed.generationId) {
      return knowledgeCitationCoveragePageResultSchema.parse({
        state: 'preparing',
        reason: 'index_preparing'
      })
    }
    if (fingerprint(indexed.generationId, this.options.manuscript.assemble()) !== snapshotId) {
      return knowledgeCitationCoveragePageResultSchema.parse({
        state: 'stale',
        reason: 'snapshot_changed'
      })
    }

    const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor)
    if (
      cursor !== undefined &&
      (cursor.snapshotId !== snapshotId ||
        cursor.filter !== input.filter ||
        cursor.query !== input.query)
    ) {
      return knowledgeCitationCoveragePageResultSchema.parse({
        state: 'stale',
        reason: 'snapshot_changed'
      })
    }
    const offset = cursor?.offset ?? 0
    const items = filterItems(coverage.sources, coverage.unmatched, input.filter, input.query)
    const pageItems = items.slice(offset, offset + input.limit)
    return knowledgeCitationCoveragePageResultSchema.parse({
      state: 'ready',
      snapshotId,
      indexGenerationId: indexed.generationId,
      outlineVersion: assembly.outlineVersion,
      summary,
      items: pageItems,
      filteredTotal: items.length,
      nextCursor:
        offset + pageItems.length < items.length
          ? encodeCursor({
              snapshotId,
              filter: input.filter,
              query: input.query,
              offset: offset + pageItems.length
            })
          : null
    })
  }
}

function matchCoverage(
  sources: Array<{ knowledgeItemId: string; displayName: string; extension: string | null }>,
  references: Array<{ title: string; count: number }>
): {
  sources: Array<Extract<KnowledgeCitationCoverageItem, { kind: 'source' }>>
  unmatched: Array<Extract<KnowledgeCitationCoverageItem, { kind: 'unmatched_citation' }>>
} {
  const sourceRows = sources.map((source) => ({
    kind: 'source' as const,
    ...source,
    status: 'uncited' as 'cited' | 'uncited' | 'ambiguous',
    citationCount: 0
  }))
  const byTitle = new Map<string, typeof sourceRows>()
  for (const source of sourceRows) {
    const key = normalizeCitationTitle(source.displayName)
    const matches = byTitle.get(key) ?? []
    matches.push(source)
    byTitle.set(key, matches)
  }
  const unmatched: Array<Extract<KnowledgeCitationCoverageItem, { kind: 'unmatched_citation' }>> =
    []
  for (const reference of references) {
    const matches = byTitle.get(normalizeCitationTitle(reference.title)) ?? []
    if (matches.length === 0) {
      unmatched.push({
        kind: 'unmatched_citation',
        title: reference.title,
        citationCount: reference.count
      })
      continue
    }
    for (const source of matches) {
      source.status = matches.length === 1 ? 'cited' : 'ambiguous'
      source.citationCount += reference.count
    }
  }
  sourceRows.sort(
    (left, right) =>
      compareLabels(left.displayName, right.displayName) ||
      left.knowledgeItemId.localeCompare(right.knowledgeItemId)
  )
  unmatched.sort((left, right) => compareLabels(left.title, right.title))
  return { sources: sourceRows, unmatched }
}

function filterItems(
  sources: Array<Extract<KnowledgeCitationCoverageItem, { kind: 'source' }>>,
  unmatched: Array<Extract<KnowledgeCitationCoverageItem, { kind: 'unmatched_citation' }>>,
  filter: KnowledgeCitationCoverageFilter,
  query: string
): KnowledgeCitationCoverageItem[] {
  const selected =
    filter === 'all'
      ? sources
      : filter === 'cited'
        ? sources.filter((item) => item.status === 'cited')
        : filter === 'uncited'
          ? sources.filter((item) => item.status === 'uncited')
          : [...sources.filter((item) => item.status === 'ambiguous'), ...unmatched]
  const needle = query.normalize('NFC').toLowerCase()
  if (needle === '') return selected
  return selected.filter((item) =>
    (item.kind === 'source' ? item.displayName : item.title)
      .normalize('NFC')
      .toLowerCase()
      .includes(needle)
  )
}

function fingerprint(
  generationId: string,
  assembly: ReturnType<ManuscriptService['assemble']>
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        generationId,
        outlineVersion: assembly.outlineVersion,
        revisions: assembly.sections.map(({ section, revision }) => ({
          sectionId: section.sectionId,
          revisionId: revision.sectionRevisionId,
          contentHash: revision.contentHash
        }))
      })
    )
    .digest('hex')
}

function compareLabels(left: string, right: string): number {
  const first = left.normalize('NFC')
  const second = right.normalize('NFC')
  return first < second ? -1 : first > second ? 1 : 0
}

function encodeCursor(cursor: z.infer<typeof cursorSchema>): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

function decodeCursor(cursor: string): z.infer<typeof cursorSchema> {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')))
  } catch (err) {
    throw new Error('Knowledge citation coverage cursor is invalid', { cause: err })
  }
}
