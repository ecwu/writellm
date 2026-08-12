import { describe, expect, it, vi } from 'vitest'
import { manuscriptSearchInputSchema } from '../../shared/contracts/manuscript-search'
import type { ManuscriptAssembly } from '../../shared/contracts/manuscript'
import { ManuscriptSearchError, ManuscriptSearchService } from './manuscript-search-service'
import type { ManuscriptService } from './manuscript-service'

function assembly(title = 'Alpha Alpha Alpha'): ManuscriptAssembly {
  return {
    manuscriptId: 'manuscript-1',
    outlineVersion: 1,
    brief: {
      manuscriptBriefId: 'brief-1',
      manuscriptId: 'manuscript-1',
      version: 1,
      schemaVersion: 1,
      title: 'Book',
      description: '',
      topic: '',
      targetAudience: '',
      language: '',
      styleTone: '',
      scopeExclusions: '',
      targetLength: '',
      citationRequirements: '',
      additionalInstructions: '',
      extensible: {},
      createdAt: '2026-08-12T00:00:00.000Z'
    },
    sections: [
      {
        section: {
          sectionId: 'section-1',
          manuscriptId: 'manuscript-1',
          parentSectionId: null,
          position: 0,
          level: 1,
          title,
          objective: 'Objective',
          status: 'drafting',
          currentRevisionId: 'revision-1',
          createdAt: '2026-08-12T00:00:00.000Z',
          updatedAt: '2026-08-12T00:00:00.000Z'
        },
        revision: {
          sectionRevisionId: 'revision-1',
          sectionId: 'section-1',
          revisionNumber: 1,
          source: 'manual',
          sourceClass: 'manual_autosave',
          content: [
            {
              id: 'paragraph-1',
              type: 'paragraph',
              props: {
                backgroundColor: 'default',
                textColor: 'default',
                textAlignment: 'left'
              },
              content: [{ type: 'text', text: 'Body alpha', styles: {} }],
              children: []
            }
          ],
          contentSchemaVersion: 2,
          contentHash: 'a'.repeat(64),
          priorRevisionId: null,
          wordCount: 2,
          characterCount: 9,
          countAlgorithmVersion: 2,
          agentRunId: null,
          agentToolCallId: null,
          agentProposalId: null,
          createdAt: '2026-08-12T00:00:00.000Z'
        }
      }
    ],
    wordCount: 2,
    characterCount: 9
  }
}

function harness(initial = assembly()) {
  let current = initial
  const manuscript = { assemble: () => current } as ManuscriptService
  const log = { info: vi.fn(), error: vi.fn() }
  const service = new ManuscriptSearchService({ manuscript, log })
  return { service, log, setAssembly: (next: ManuscriptAssembly) => (current = next) }
}

const input = (overrides: Record<string, unknown> = {}) =>
  manuscriptSearchInputSchema.parse({
    projectSessionId: 'session-1',
    query: 'alpha',
    caseSensitive: false,
    scope: { type: 'manuscript' },
    statuses: [],
    limit: 2,
    ...overrides
  })

describe('ManuscriptSearchService', () => {
  it('orders occurrences, paginates with a bound cursor, and reports original targets', async () => {
    const { service } = harness()
    const first = await service.search(input(), new AbortController().signal)
    expect(first.hits).toHaveLength(2)
    expect(first.hits.map((hit) => hit.target.kind)).toEqual(['section_title', 'section_title'])
    expect(first.nextCursor).not.toBeNull()
    const second = await service.search(
      input({ cursor: first.nextCursor }),
      new AbortController().signal
    )
    expect(second.hits.map((hit) => hit.target.kind)).toEqual(['section_title', 'block_inline'])
  })

  it('rejects cursor tampering and stale snapshots', async () => {
    const { service, setAssembly } = harness()
    const first = await service.search(input(), new AbortController().signal)
    await expect(
      service.search(input({ cursor: `${first.nextCursor}x` }), new AbortController().signal)
    ).rejects.toMatchObject({ code: 'invalid_cursor' })
    setAssembly(assembly('Changed Alpha Alpha Alpha'))
    await expect(
      service.search(input({ cursor: first.nextCursor }), new AbortController().signal)
    ).rejects.toMatchObject({ code: 'stale_cursor' })
  })

  it('revalidates only the exact semantic path and original slice', async () => {
    const { service, setAssembly } = harness()
    const result = await service.search(input({ limit: 10 }), new AbortController().signal)
    const hit = result.hits.find((candidate) => candidate.target.kind === 'block_inline')
    expect(hit).toBeDefined()
    if (hit === undefined) return
    expect(
      await service.revalidate({
        projectSessionId: 'session-1',
        query: 'alpha',
        caseSensitive: false,
        matchId: hit.matchId,
        sourceSliceHash: hit.sourceSliceHash,
        target: hit.target
      })
    ).toMatchObject({ status: 'valid', revisionId: 'revision-1' })
    expect(
      await service.revalidate({
        projectSessionId: 'session-1',
        query: 'alpha',
        caseSensitive: false,
        matchId: 'f'.repeat(64),
        sourceSliceHash: hit.sourceSliceHash,
        target: hit.target
      })
    ).toEqual({ status: 'stale' })

    const unrelatedSave = assembly()
    unrelatedSave.sections[0].revision.content.push({
      id: 'paragraph-2',
      type: 'paragraph',
      props: {
        backgroundColor: 'default',
        textColor: 'default',
        textAlignment: 'left'
      },
      content: [{ type: 'text', text: 'Unrelated edit', styles: {} }],
      children: []
    })
    unrelatedSave.sections[0].revision.contentHash = 'b'.repeat(64)
    unrelatedSave.sections[0].revision.sectionRevisionId = 'revision-2'
    unrelatedSave.sections[0].section.currentRevisionId = 'revision-2'
    setAssembly(unrelatedSave)
    expect(
      await service.revalidate({
        projectSessionId: 'session-1',
        query: 'alpha',
        caseSensitive: false,
        matchId: hit.matchId,
        sourceSliceHash: hit.sourceSliceHash,
        target: hit.target
      })
    ).toMatchObject({ status: 'valid', revisionId: 'revision-2' })

    const changedTarget = assembly()
    changedTarget.sections[0].revision.content[0].content = [
      { type: 'text', text: 'Body beta', styles: {} }
    ]
    changedTarget.sections[0].revision.contentHash = 'c'.repeat(64)
    changedTarget.sections[0].revision.sectionRevisionId = 'revision-3'
    changedTarget.sections[0].section.currentRevisionId = 'revision-3'
    setAssembly(changedTarget)
    expect(
      await service.revalidate({
        projectSessionId: 'session-1',
        query: 'alpha',
        caseSensitive: false,
        matchId: hit.matchId,
        sourceSliceHash: hit.sourceSliceHash,
        target: hit.target
      })
    ).toEqual({ status: 'stale' })
  })

  it('honors status filters, explicit budget exits, and aborts', async () => {
    const { service } = harness()
    const filtered = await service.search(
      input({ statuses: ['completed'] }),
      new AbortController().signal
    )
    expect(filtered.hits).toEqual([])
    const budgeted = await service.search(input(), new AbortController().signal, { budgetMs: 0 })
    expect(budgeted).toMatchObject({ complete: false, incompleteReason: 'scan_budget' })
    const controller = new AbortController()
    controller.abort()
    await expect(service.search(input(), controller.signal)).rejects.toBeInstanceOf(
      ManuscriptSearchError
    )
  })
})
