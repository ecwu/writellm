import { describe, expect, it, vi } from 'vitest'
import type { ProjectDatabase } from '../project/project-database'
import { resolveReadableCitation } from './readable-citation-resolver'

const sectionId = '11111111-1111-4111-8111-111111111111'
const currentRevisionId = '22222222-2222-4222-8222-222222222222'
const agentRevisionId = '33333333-3333-4333-8333-333333333333'
const proposalId = '44444444-4444-4444-8444-444444444444'
const modelRequestId = '55555555-5555-4555-8555-555555555555'
const knowledgeItemId = '66666666-6666-4666-8666-666666666666'
const parseRevisionId = '77777777-7777-4777-8777-777777777777'
const blockId = 'grounded-paragraph'
const citationA = `citation-${'a'.repeat(40)}`
const citationB = `citation-${'b'.repeat(40)}`

describe('readable citation resolver', () => {
  it('resolves an exact source through a prior accepted proposal after manual edits', async () => {
    const retrieval = retrievalWith([expanded(citationA)])
    const result = await resolveReadableCitation({
      database: databaseWith(lineage([citationA])),
      retrieval: retrieval as never,
      retrievalAvailable: true,
      input: input(),
      signal: new AbortController().signal
    })

    expect(result).toMatchObject({ status: 'resolved', citation: { citationId: citationA } })
    expect(retrieval.expand).toHaveBeenCalledWith([citationA], expect.any(AbortSignal))
  })

  it('returns only provenance-linked ambiguity and never performs a title search', async () => {
    const retrieval = retrievalWith([expanded(citationA), expanded(citationB)])
    const result = await resolveReadableCitation({
      database: databaseWith(lineage([citationA, citationB])),
      retrieval: retrieval as never,
      retrievalAvailable: true,
      input: input(),
      signal: new AbortController().signal
    })

    expect(result).toMatchObject({
      status: 'ambiguous',
      citations: [{ citationId: citationA }, { citationId: citationB }]
    })
    expect(retrieval).not.toHaveProperty('search')
  })

  it('normalizes exact titles with NFC and treats an omitted page as title-only matching', async () => {
    const citation = { ...expanded(citationA), title: 'Cafe\u0301.pdf', page: 8 }
    const { pageIndex: _pageIndex, ...titleOnlyInput } = input()
    const result = await resolveReadableCitation({
      database: databaseWith(lineage([citationA])),
      retrieval: retrievalWith([citation]) as never,
      retrievalAvailable: true,
      input: { ...titleOnlyInput, title: 'Caf\u00e9.pdf' },
      signal: new AbortController().signal
    })

    expect(result).toMatchObject({ status: 'resolved', citation: { citationId: citationA } })
  })

  it('resolves an earlier doc fallback key through its exact linked Knowledge item', async () => {
    const fallbackKey = `doc-${knowledgeItemId.replaceAll('-', '')}`
    const result = await resolveReadableCitation({
      database: databaseWith(lineage([citationA]), blockId, [knowledgeItemId]),
      retrieval: retrievalWith([expanded(citationA)]) as never,
      retrievalAvailable: true,
      input: { ...input(), title: fallbackKey },
      signal: new AbortController().signal
    })

    expect(result).toMatchObject({ status: 'resolved', citation: { citationId: citationA } })
  })

  it('resolves a unique legacy Reference title before considering the attachment filename', async () => {
    const result = await resolveReadableCitation({
      database: databaseWith(
        lineage([citationA]),
        blockId,
        [],
        [
          {
            referenceId: '99999999-9999-4999-8999-999999999999',
            title: 'Authoritative Evidence',
            knowledgeItemId
          }
        ]
      ),
      retrieval: retrievalWith([expanded(citationA)]) as never,
      retrievalAvailable: true,
      input: { ...input(), title: 'Authoritative Evidence' },
      signal: new AbortController().signal
    })

    expect(result).toMatchObject({ status: 'resolved', citation: { citationId: citationA } })
  })

  it('does not resolve the right title at the wrong page', async () => {
    const result = await resolveReadableCitation({
      database: databaseWith(lineage([citationA])),
      retrieval: retrievalWith([expanded(citationA)]) as never,
      retrievalAvailable: true,
      input: { ...input(), pageIndex: 9 },
      signal: new AbortController().signal
    })

    expect(result).toEqual({ status: 'unavailable', reason: 'unlinked' })
  })

  it.each([
    {
      name: 'manual block without proposal provenance',
      rows: lineage([citationA]),
      requestedBlockId: 'copied-manual-block',
      available: true,
      expanded: [expanded(citationA)],
      reason: 'unlinked'
    },
    {
      name: 'active index unavailable',
      rows: lineage([citationA]),
      requestedBlockId: blockId,
      available: false,
      expanded: [expanded(citationA)],
      reason: 'index_unavailable'
    },
    {
      name: 'provenance source removed from the active index',
      rows: lineage([citationA]),
      requestedBlockId: blockId,
      available: true,
      expanded: [],
      reason: 'source_missing'
    }
  ])('reports $name without guessing', async (fixture) => {
    const result = await resolveReadableCitation({
      database: databaseWith(fixture.rows, fixture.requestedBlockId),
      retrieval: retrievalWith(fixture.expanded) as never,
      retrievalAvailable: fixture.available,
      input: input(fixture.requestedBlockId),
      signal: new AbortController().signal
    })
    expect(result).toEqual({ status: 'unavailable', reason: fixture.reason })
  })

  it('fails closed when the bounded revision lineage is exhausted', async () => {
    const rows = Array.from({ length: 1_001 }, (_, depth) => ({
      ...manualRow(depth === 0 ? currentRevisionId : crypto.randomUUID(), depth),
      prior_revision_id: depth === 1_000 ? 'older-revision' : crypto.randomUUID()
    }))
    const result = await resolveReadableCitation({
      database: databaseWith(rows),
      retrieval: retrievalWith([]) as never,
      retrievalAvailable: true,
      input: input(),
      signal: new AbortController().signal
    })
    expect(result).toEqual({ status: 'unavailable', reason: 'resolution_limit' })
  })
})

function input(requestedBlockId = blockId) {
  return {
    projectSessionId: '88888888-8888-4888-8888-888888888888',
    sectionRevisionId: currentRevisionId,
    blockId: requestedBlockId,
    title: 'Evidence.pdf',
    pageIndex: 1
  }
}

function databaseWith(
  rows: ReturnType<typeof lineage>,
  requestedBlockId = blockId,
  linkedKnowledgeItemIds: readonly string[] = [],
  linkedReferences: readonly {
    referenceId: string
    title: string
    knowledgeItemId: string
  }[] = []
): ProjectDatabase {
  const patched = rows.map((row, index) =>
    index === 0
      ? {
          ...row,
          content_json: JSON.stringify([
            {
              id: requestedBlockId,
              type: 'paragraph',
              props: {
                backgroundColor: 'default',
                textColor: 'default',
                textAlignment: 'left'
              },
              content: [{ type: 'text', text: '[Source: Evidence.pdf, p. 2]', styles: {} }],
              children: []
            }
          ])
        }
      : row
  )
  return {
    immediate: (operation) =>
      operation({
        prepare: (sql: string) => ({
          all: (...parameters: unknown[]) => {
            if (sql.includes('FROM reference_items item')) return []
            if (sql.includes('SELECT reference_id AS referenceId, title')) {
              return linkedReferences.map(({ referenceId, title }) => ({ referenceId, title }))
            }
            if (sql.includes('WHERE reference_id = ?')) {
              return linkedReferences
                .filter((reference) => reference.referenceId === parameters[0])
                .map((reference) => ({ knowledgeItemId: reference.knowledgeItemId }))
            }
            if (sql.includes('FROM knowledge_reference_links link')) {
              return linkedKnowledgeItemIds.includes(String(parameters[0]))
                ? [{ knowledgeItemId: parameters[0] }]
                : []
            }
            return patched
          }
        })
      } as never)
  } as unknown as ProjectDatabase
}

function lineage(citationIds: string[]) {
  return [
    manualRow(currentRevisionId, 0),
    {
      ...manualRow(agentRevisionId, 1),
      agent_proposal_id: proposalId,
      proposal_status: 'applied',
      applied_revision_id: agentRevisionId,
      payload_json: JSON.stringify(proposalPayload(citationIds))
    }
  ]
}

function manualRow(revisionId: string, depth: number) {
  return {
    section_revision_id: revisionId,
    section_id: sectionId,
    prior_revision_id: depth === 0 ? agentRevisionId : null,
    content_json: '[]',
    content_body_retained: 1,
    agent_proposal_id: null,
    depth,
    proposal_status: null,
    applied_revision_id: null,
    payload_json: null
  }
}

function proposalPayload(citationIds: string[]) {
  const citedSources = citationIds.map((citationId) => ({
    evidenceSchemaVersion: 2,
    citationId,
    knowledgeItemId,
    parseRevisionId,
    chunkId: `chunk-${citationId.slice('citation-'.length)}`,
    sourceBlockIds: ['source-block'],
    excerpt: 'Evidence',
    contentHash: 'c'.repeat(64),
    retrievedAt: '2026-08-11T00:00:00.000Z'
  }))
  const block = {
    id: blockId,
    type: 'paragraph',
    props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
    content: [{ type: 'text', text: '[Source: Evidence.pdf, p. 2]', styles: {} }],
    children: []
  }
  const preview = {
    summary: 'Insert grounded paragraph',
    affectedSectionIds: [sectionId],
    beforeText: '',
    afterText: '[Source: Evidence.pdf, p. 2]',
    beforeTextTruncated: false,
    afterTextTruncated: false,
    citedSources
  }
  return {
    schemaVersion: 1,
    kind: 'section_patch',
    mutation: {
      schemaVersion: 1,
      sectionId,
      baseRevisionId: currentRevisionId,
      operations: [
        { type: 'insertBlocks', anchorBlockId: null, placement: 'end', blocks: [block] }
      ],
      citationIds
    },
    preview,
    provenance: { modelRequestId, citedSources }
  }
}

function expanded(citationId: string) {
  return {
    citationId,
    knowledgeItemId,
    parseRevisionId,
    chunkId: `chunk-${citationId.slice('citation-'.length)}`,
    title: 'Evidence.pdf',
    text: 'Expanded evidence',
    page: 1,
    headingPath: ['Evidence'],
    sourceBlockIds: ['source-block'],
    assetRefs: [],
    sources: []
  }
}

function retrievalWith(citations: ReturnType<typeof expanded>[]) {
  return { expand: vi.fn(async () => citations) }
}
