import { describe, expect, it } from 'vitest'
import type { BlockNoteDocument } from './contracts/manuscript'
import {
  enumerateManuscriptSearchSurfaces,
  findProjectionMatches,
  findProjectionMatchesCooperatively,
  projectSearchText,
  SearchProjectionSliceLimitError,
  targetForSurfaceMatch
} from './manuscript-search'

describe('findProjectionMatches', () => {
  it.each([
    ['Cafe\u0301 noir', 'Café', false, [0, 5]],
    ['İstanbul', 'i\u0307s', false, [0, 2]],
    ['ΟΣ ος', 'ος', false, [3, 5]],
    ['Straße', 'straße', false, [0, 6]],
    ['汉字🙂', '字🙂', true, [1, 4]]
  ])('maps %s / %s back to the original UTF-16 slice', (source, query, caseSensitive, range) => {
    const result = findProjectionMatches(source, query, caseSensitive)
    expect(result.matches.map(({ from, to }) => [from, to])).toContainEqual(range)
  })

  it('rejects a candidate ending inside a length-expanded atomic run', () => {
    expect(findProjectionMatches('İ', 'i', false).matches).toEqual([])
    expect(findProjectionMatches('İ', 'i\u0307', false).matches).toEqual([
      { from: 0, to: 1, searchFrom: 0, searchTo: 2 }
    ])
  })

  it('returns left-to-right non-overlapping original ranges', () => {
    expect(findProjectionMatches('aaaa', 'aa', true).matches).toEqual([
      { from: 0, to: 2, searchFrom: 0, searchTo: 2 },
      { from: 2, to: 4, searchFrom: 2, searchTo: 4 }
    ])
  })

  it('round-trips every accepted slow-path match to the same projection', () => {
    const sources = [
      'Cafe\u0301 and A\u030A',
      'İstanbul I ı i',
      'Σ σ ς ΟΣ',
      '中文🙂e\u0301',
      'a\u0323\u0301 reordered marks'
    ]
    const queries = ['café', 'å', 'i\u0307', 'σ', 'ς', '中文', '🙂', 'é', 'ạ\u0301']
    for (const source of sources) {
      for (const query of queries) {
        for (const match of findProjectionMatches(source, query, false).matches) {
          expect(projectSearchText(source, false).slice(match.searchFrom, match.searchTo)).toBe(
            projectSearchText(query, false)
          )
        }
      }
    }
  })

  it('keeps compatibility and full-fold forms deliberately distinct', () => {
    expect(findProjectionMatches('Straße', 'STRASSE', false).matches).toEqual([])
    expect(findProjectionMatches('Ａ', 'A', false).matches).toEqual([])
  })

  it('cooperatively maps a large slow-path surface without changing original offsets', async () => {
    const source = `${'Cafe\u0301 '.repeat(4_000)}needle`
    let checkpoints = 0
    const result = await findProjectionMatchesCooperatively(source, 'needle', false, {
      checkpoint: async () => {
        checkpoints += 1
      },
      maxMatches: 10
    })
    expect(checkpoints).toBeGreaterThan(1)
    expect(result.slowPath).toBe(true)
    expect(result.matches).toEqual([
      {
        from: source.length - 6,
        to: source.length,
        searchFrom: projectSearchText(source, false).length - 6,
        searchTo: projectSearchText(source, false).length
      }
    ])
  })

  it('fails closed before processing one oversized grapheme atom', async () => {
    await expect(
      findProjectionMatchesCooperatively(`e${'\u0301'.repeat(20_000)}`, 'é', false, {
        checkpoint: async () => undefined,
        maxMatches: 10
      })
    ).rejects.toBeInstanceOf(SearchProjectionSliceLimitError)
  })
})

describe('manuscript search surfaces', () => {
  it('crosses styled and link text nodes while preserving exact semantic segments', () => {
    const content = [
      {
        id: 'paragraph-1',
        type: 'paragraph',
        props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
        content: [
          { type: 'text', text: 'cross ', styles: { bold: true } },
          {
            type: 'link',
            href: 'https://example.com',
            content: [
              { type: 'text', text: 'style', styles: {} },
              { type: 'text', text: ' link', styles: { italic: true } }
            ]
          }
        ],
        children: []
      }
    ] as BlockNoteDocument
    const surfaces = enumerateManuscriptSearchSurfaces([
      {
        sectionId: 'section-1',
        revisionId: 'revision-1',
        title: 'Title',
        objective: null,
        status: 'drafting',
        content
      }
    ])
    const surface = surfaces.find((candidate) => candidate.kind === 'block_inline')
    expect(surface).toBeDefined()
    if (surface === undefined) return
    const match = findProjectionMatches(surface.text, 's style l', true).matches[0]
    expect(match).toBeDefined()
    if (match === undefined) return
    expect(targetForSurfaceMatch(surface, match)).toEqual({
      kind: 'block_inline',
      sectionId: 'section-1',
      revisionId: 'revision-1',
      blockId: 'paragraph-1',
      flatRange: { from: 4, to: 13 },
      segments: [
        { inlineIndex: 0, range: { from: 4, to: 6 } },
        { inlineIndex: 1, linkTextIndex: 0, range: { from: 0, to: 5 } },
        { inlineIndex: 1, linkTextIndex: 1, range: { from: 0, to: 2 } }
      ]
    })
  })

  it('keeps table cells, captions, and child blocks as separate ordered surfaces', () => {
    const content = [
      {
        id: 'table-1',
        type: 'table',
        props: { textColor: 'default' },
        content: {
          type: 'tableContent',
          columnWidths: [null, null],
          rows: [{ cells: [[{ type: 'text', text: 'A', styles: {} }], []] }]
        },
        children: []
      },
      {
        id: 'image-1',
        type: 'image',
        props: {
          backgroundColor: 'default',
          textAlignment: 'left',
          name: 'hidden',
          url: 'writellm-asset:00000000-0000-4000-8000-000000000000',
          caption: 'Visible caption',
          showPreview: true
        },
        children: []
      }
    ] as BlockNoteDocument
    expect(
      enumerateManuscriptSearchSurfaces([
        {
          sectionId: 'section-1',
          revisionId: 'revision-1',
          title: 'Title',
          objective: 'Objective',
          status: 'planned',
          content
        }
      ]).map(({ kind, text }) => [kind, text])
    ).toEqual([
      ['section_title', 'Title'],
      ['section_objective', 'Objective'],
      ['table_cell', 'A'],
      ['table_cell', ''],
      ['block_caption', 'Visible caption']
    ])
  })
})
