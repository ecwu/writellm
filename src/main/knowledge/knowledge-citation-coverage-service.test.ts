import { describe, expect, it, vi } from 'vitest'
import { KnowledgeCitationCoverageService } from './knowledge-citation-coverage-service'

const generationId = 'generation-current'

describe('KnowledgeCitationCoverageService', () => {
  it('matches canonical titles at article granularity and reports ambiguous and unmatched citations', async () => {
    const service = createService({
      sources: [
        source('11111111-1111-4111-8111-111111111111', 'Café', 'pdf'),
        source('22222222-2222-4222-8222-222222222222', 'Duplicate', 'docx'),
        source('33333333-3333-4333-8333-333333333333', 'Duplicate', 'pdf'),
        source('44444444-4444-4444-8444-444444444444', 'Case', 'pdf'),
        source('55555555-5555-4555-8555-555555555555', 'Unused', null)
      ],
      text: [
        '[Source: Cafe\u0301, p. 3]',
        '[Source: Café]',
        '【来源：Duplicate，第 8 页】',
        '[Source: case]'
      ].join(' ')
    })

    const result = await service.page(
      { filter: 'all', query: '', limit: 100 },
      new AbortController().signal
    )

    expect(result.state).toBe('ready')
    if (result.state !== 'ready') return
    expect(result.summary).toEqual({
      indexedSourceCount: 5,
      citedSourceCount: 1,
      uncitedSourceCount: 2,
      ambiguousSourceCount: 2,
      unmatchedCitationTitleCount: 1,
      unmatchedCitationOccurrenceCount: 1,
      attentionCount: 3,
      coverageRatio: 0.2
    })
    expect(result.items).toEqual([
      expect.objectContaining({ displayName: 'Café', status: 'cited', citationCount: 2 }),
      expect.objectContaining({ displayName: 'Case', status: 'uncited', citationCount: 0 }),
      expect.objectContaining({ displayName: 'Duplicate', status: 'ambiguous', citationCount: 1 }),
      expect.objectContaining({ displayName: 'Duplicate', status: 'ambiguous', citationCount: 1 }),
      expect.objectContaining({ displayName: 'Unused', status: 'uncited', citationCount: 0 })
    ])

    const attention = await service.page(
      { filter: 'attention', query: '', limit: 100 },
      new AbortController().signal
    )
    expect(attention.state).toBe('ready')
    if (attention.state !== 'ready') return
    expect(attention.items).toEqual([
      expect.objectContaining({ kind: 'source', status: 'ambiguous' }),
      expect.objectContaining({ kind: 'source', status: 'ambiguous' }),
      { kind: 'unmatched_citation', title: 'case', citationCount: 1 }
    ])

    const searched = await service.page(
      { filter: 'uncited', query: 'UNUSED', limit: 100 },
      new AbortController().signal
    )
    expect(searched).toMatchObject({
      state: 'ready',
      filteredTotal: 1,
      items: [expect.objectContaining({ displayName: 'Unused', status: 'uncited' })]
    })
  })

  it('returns an uncomputable ratio for a current empty generation', async () => {
    const result = await createService({ sources: [], text: '[Source: Missing]' }).page(
      { filter: 'attention', query: '', limit: 100 },
      new AbortController().signal
    )

    expect(result).toMatchObject({
      state: 'ready',
      summary: {
        indexedSourceCount: 0,
        citedSourceCount: 0,
        coverageRatio: null,
        unmatchedCitationTitleCount: 1
      },
      items: [{ kind: 'unmatched_citation', title: 'Missing', citationCount: 1 }]
    })
  })

  it('binds cursors to the manuscript snapshot, filter, and query', async () => {
    let revision = manuscript('[Source: First]', 'a'.repeat(64))
    const currentIndexedSources = vi.fn(async () => ({
      state: 'ready' as const,
      generationId,
      sources: [
        source('11111111-1111-4111-8111-111111111111', 'First', 'pdf'),
        source('22222222-2222-4222-8222-222222222222', 'Second', 'pdf')
      ]
    }))
    const service = new KnowledgeCitationCoverageService({
      manuscript: { assemble: () => revision } as never,
      projectIndex: { currentIndexedSources } as never
    })
    const first = await service.page(
      { filter: 'all', query: '', limit: 1 },
      new AbortController().signal
    )
    expect(first.state).toBe('ready')
    if (first.state !== 'ready' || first.nextCursor === null) return

    revision = manuscript('[Source: Second]', 'b'.repeat(64))
    await expect(
      service.page(
        { filter: 'all', query: '', cursor: first.nextCursor, limit: 1 },
        new AbortController().signal
      )
    ).resolves.toEqual({ state: 'stale', reason: 'snapshot_changed' })
  })

  it('does not expose a stale generation while the index changes', async () => {
    const currentIndexedSources = vi
      .fn()
      .mockResolvedValueOnce({ state: 'ready', generationId, sources: [] })
      .mockResolvedValueOnce({ state: 'ready', generationId: 'generation-new', sources: [] })
    const service = new KnowledgeCitationCoverageService({
      manuscript: { assemble: () => manuscript('', 'a'.repeat(64)) } as never,
      projectIndex: { currentIndexedSources } as never
    })

    await expect(
      service.page({ filter: 'all', query: '', limit: 100 }, new AbortController().signal)
    ).resolves.toEqual({ state: 'preparing', reason: 'index_preparing' })
  })

  it.each([
    ['preparing', 'index_preparing'],
    ['unavailable', 'index_unavailable']
  ] as const)('returns an explicit %s index state', async (state, reason) => {
    const service = new KnowledgeCitationCoverageService({
      manuscript: { assemble: () => manuscript('', 'a'.repeat(64)) } as never,
      projectIndex: { currentIndexedSources: vi.fn(async () => ({ state })) } as never
    })

    await expect(
      service.page({ filter: 'all', query: '', limit: 100 }, new AbortController().signal)
    ).resolves.toEqual({ state, reason })
  })

  it('honors project-operation cancellation before reading either snapshot', async () => {
    const currentIndexedSources = vi.fn()
    const service = new KnowledgeCitationCoverageService({
      manuscript: { assemble: () => manuscript('', 'a'.repeat(64)) } as never,
      projectIndex: { currentIndexedSources } as never
    })
    const controller = new AbortController()
    controller.abort()

    await expect(
      service.page({ filter: 'all', query: '', limit: 100 }, controller.signal)
    ).rejects.toThrow()
    expect(currentIndexedSources).not.toHaveBeenCalled()
  })
})

function createService(input: {
  sources: Array<{ knowledgeItemId: string; displayName: string; extension: string | null }>
  text: string
}): KnowledgeCitationCoverageService {
  return new KnowledgeCitationCoverageService({
    manuscript: { assemble: () => manuscript(input.text, 'a'.repeat(64)) } as never,
    projectIndex: {
      currentIndexedSources: vi.fn(async () => ({
        state: 'ready' as const,
        generationId,
        sources: input.sources
      }))
    } as never
  })
}

function source(knowledgeItemId: string, displayName: string, extension: string | null) {
  return { knowledgeItemId, displayName, extension }
}

function manuscript(text: string, contentHash: string) {
  return {
    manuscriptId: '66666666-6666-4666-8666-666666666666',
    outlineVersion: 1,
    brief: {},
    sections: [
      {
        section: { sectionId: '77777777-7777-4777-8777-777777777777' },
        revision: {
          sectionRevisionId: '88888888-8888-4888-8888-888888888888',
          contentHash,
          content: [
            {
              id: 'block-1',
              type: 'paragraph',
              props: {},
              content: [{ type: 'text', text, styles: {} }],
              children: []
            }
          ]
        }
      }
    ],
    wordCount: 0,
    characterCount: text.length
  }
}
