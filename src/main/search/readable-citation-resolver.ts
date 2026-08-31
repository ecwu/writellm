import {
  persistedMutationProposalPayloadSchema,
  type PersistedMutationProposalPayload
} from '../../shared/contracts/agent-mutations'
import type { BlockNoteDocument } from '../../shared/contracts/manuscript'
import {
  readableCitationResolutionResultSchema,
  type ExpandedCitation,
  type ReadableCitationResolutionInput,
  type ReadableCitationResolutionResult
} from '../../shared/contracts/search'
import type { ProjectDatabase } from '../project/project-database'
import type { RetrievalService } from './retrieval-service'
import { decodeStoredSectionContent } from '../manuscript/content'

const MAX_LINEAGE_REVISIONS = 1_000
const MAX_CITATION_IDS = 200
const EXPANSION_BATCH_SIZE = 20

interface LineageRow {
  section_revision_id: string
  section_id: string
  prior_revision_id: string | null
  content_json: string
  content_schema_version: number
  content_body_retained: number
  agent_proposal_id: string | null
  depth: number
  proposal_status: string | null
  applied_revision_id: string | null
  payload_json: string | null
}

interface ProvenanceCollection {
  groups: string[][]
  limited: boolean
  referenceKnowledgeItemIds: ReadonlySet<string>
}

export async function resolveReadableCitation(options: {
  database: ProjectDatabase
  retrieval: RetrievalService | null
  retrievalAvailable: boolean
  input: ReadableCitationResolutionInput
  signal: AbortSignal
}): Promise<ReadableCitationResolutionResult> {
  const provenance = options.database.immediate((database) => {
    const rows = database
      .prepare(
        `WITH RECURSIVE lineage AS (
           SELECT section_revision_id, section_id, prior_revision_id, content_json,
                  content_schema_version, content_body_retained, agent_proposal_id, 0 AS depth
             FROM section_revisions
            WHERE section_revision_id = ?
           UNION ALL
           SELECT prior.section_revision_id, prior.section_id, prior.prior_revision_id,
                  prior.content_json, prior.content_schema_version, prior.content_body_retained,
                  prior.agent_proposal_id,
                  lineage.depth + 1
             FROM section_revisions AS prior
             JOIN lineage ON prior.section_revision_id = lineage.prior_revision_id
            WHERE lineage.depth < ?
         )
         SELECT lineage.*,
                proposal.status AS proposal_status,
                proposal.applied_revision_id,
                proposal.payload_json
           FROM lineage
           LEFT JOIN mutation_proposals AS proposal
             ON proposal.mutation_proposal_id = lineage.agent_proposal_id
          ORDER BY lineage.depth
          LIMIT ?`
      )
      .all(
        options.input.sectionRevisionId,
        MAX_LINEAGE_REVISIONS,
        MAX_LINEAGE_REVISIONS + 1
      ) as LineageRow[]

    const current = rows[0]
    if (current === undefined || Number(current.content_body_retained) !== 1) {
      return {
        groups: [],
        limited: false,
        referenceKnowledgeItemIds: new Set<string>()
      } satisfies ProvenanceCollection
    }
    const document = decodeStoredSectionContent(
      current.content_json,
      current.content_schema_version,
      current.section_id
    )
    if (!documentContainsBlock(document, options.input.blockId)) {
      return {
        groups: [],
        limited: false,
        referenceKnowledgeItemIds: new Set<string>()
      } satisfies ProvenanceCollection
    }
    const referenceKnowledgeItemIds = new Set(
      (
        database
          .prepare(
            `SELECT link.knowledge_item_id AS knowledgeItemId
               FROM reference_items item
               JOIN knowledge_reference_links link USING (reference_id)
              WHERE item.citation_key = ?`
          )
          .all(options.input.title) as Array<{ knowledgeItemId?: unknown }>
      ).flatMap((row) => (typeof row.knowledgeItemId === 'string' ? [row.knowledgeItemId] : []))
    )
    return {
      ...collectProvenance(rows, options.input.blockId),
      referenceKnowledgeItemIds
    }
  })

  if (provenance.groups.length === 0) {
    return readableCitationResolutionResultSchema.parse({
      status: 'unavailable',
      reason: provenance.limited ? 'resolution_limit' : 'unlinked'
    })
  }
  if (options.retrieval === null || !options.retrievalAvailable) {
    return readableCitationResolutionResultSchema.parse({
      status: 'unavailable',
      reason: 'index_unavailable'
    })
  }

  let expandedAny = false
  for (const group of provenance.groups) {
    options.signal.throwIfAborted()
    const expanded: ExpandedCitation[] = []
    for (let offset = 0; offset < group.length; offset += EXPANSION_BATCH_SIZE) {
      const batch = group.slice(offset, offset + EXPANSION_BATCH_SIZE)
      expanded.push(...(await options.retrieval.expand(batch, options.signal)))
    }
    if (expanded.length > 0) expandedAny = true
    const matches = dedupeCitations(
      expanded.filter((citation) =>
        citationMatches(citation, options.input, provenance.referenceKnowledgeItemIds)
      )
    )
    if (matches.length === 1) {
      return readableCitationResolutionResultSchema.parse({
        status: 'resolved',
        citation: matches[0]
      })
    }
    if (matches.length > 1) {
      return readableCitationResolutionResultSchema.parse({
        status: 'ambiguous',
        citations: matches
      })
    }
  }

  return readableCitationResolutionResultSchema.parse({
    status: 'unavailable',
    reason: provenance.limited ? 'resolution_limit' : expandedAny ? 'unlinked' : 'source_missing'
  })
}

function collectProvenance(rows: LineageRow[], blockId: string): ProvenanceCollection {
  const limitedByLineage = rows.length > MAX_LINEAGE_REVISIONS
  const groups: string[][] = []
  const seen = new Set<string>()
  let limitedByCitations = false

  for (const row of rows.slice(0, MAX_LINEAGE_REVISIONS)) {
    if (
      row.agent_proposal_id === null ||
      row.proposal_status !== 'applied' ||
      row.applied_revision_id !== row.section_revision_id ||
      row.payload_json === null
    ) {
      continue
    }
    const payload = persistedMutationProposalPayloadSchema.parse(JSON.parse(row.payload_json))
    if (!proposalTouchesBlock(payload, blockId)) continue
    const group: string[] = []
    for (const source of payload.provenance.citedSources) {
      if (seen.has(source.citationId)) continue
      if (seen.size >= MAX_CITATION_IDS) {
        limitedByCitations = true
        break
      }
      seen.add(source.citationId)
      group.push(source.citationId)
    }
    if (group.length > 0) groups.push(group)
    if (limitedByCitations) break
  }

  return {
    groups,
    limited: limitedByLineage || limitedByCitations,
    referenceKnowledgeItemIds: new Set<string>()
  }
}

export function proposalTouchesBlock(
  payload: PersistedMutationProposalPayload,
  blockId: string
): boolean {
  if (payload.kind !== 'section_patch') return false
  return payload.mutation.operations.some((operation) => {
    switch (operation.type) {
      case 'insertBlocks':
        return operation.blocks.some((block) => block.id === blockId)
      case 'updateBlock':
        return operation.blockId === blockId
      case 'replaceBlocks':
        return (
          operation.blockIds.includes(blockId) ||
          operation.blocks.some((block) => block.id === blockId)
        )
      case 'removeBlocks':
      case 'moveBlocks':
        return false
    }
    return false
  })
}

function documentContainsBlock(document: BlockNoteDocument, blockId: string): boolean {
  for (const block of document) {
    if (block.id === blockId || documentContainsBlock(block.children, blockId)) return true
  }
  return false
}

function citationMatches(
  citation: ExpandedCitation,
  input: ReadableCitationResolutionInput,
  referenceKnowledgeItemIds: ReadonlySet<string>
): boolean {
  if (
    referenceKnowledgeItemIds.size > 0
      ? !referenceKnowledgeItemIds.has(citation.knowledgeItemId)
      : normalizeTitle(citation.title) !== normalizeTitle(input.title)
  ) {
    return false
  }
  return input.pageIndex === undefined || citation.page === input.pageIndex
}

function normalizeTitle(title: string): string {
  return title.normalize('NFC').trim()
}

function dedupeCitations(citations: ExpandedCitation[]): ExpandedCitation[] {
  const result = new Map<string, ExpandedCitation>()
  for (const citation of citations) result.set(citation.citationId, citation)
  return [...result.values()]
}
