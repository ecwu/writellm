import { describe, expect, it } from 'vitest'
import {
  blockNoteDocumentSchema,
  normalizePlainBlockContent,
  projectLegacyBlockNoteDocument,
  manuscriptBriefFieldsSchema,
  manuscriptWorkspaceSchema,
  MAX_BRIEF_EXTENSIBLE_BYTES,
  MAX_BRIEF_EXTENSIBLE_DEPTH,
  MAX_SECTION_NESTING_DEPTH,
  sectionRevisionSummarySchema
} from './manuscript'

const paragraph = (id: string, text = '正文') => ({
  id,
  type: 'paragraph' as const,
  props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' as const },
  content: [{ type: 'text' as const, text, styles: { bold: true } }],
  children: [] as ReturnType<typeof paragraph>[]
})

describe('approved BlockNote document contract', () => {
  it('accepts rich Unicode, links, nested blocks, and tables without rewriting them', () => {
    const document = [
      {
        ...paragraph('root', '你好, café'),
        content: [
          { type: 'text' as const, text: '你好 ', styles: { bold: true } },
          {
            type: 'link' as const,
            href: 'https://example.com/路径',
            content: [{ type: 'text' as const, text: 'source', styles: { italic: true } }]
          }
        ],
        children: [paragraph('nested', 'Nested')]
      },
      {
        id: 'table',
        type: 'table' as const,
        props: { textColor: 'default' },
        content: {
          type: 'tableContent' as const,
          columnWidths: [null, 180],
          rows: [
            {
              cells: [
                {
                  type: 'tableCell' as const,
                  props: {
                    backgroundColor: 'default',
                    textColor: 'default',
                    textAlignment: 'left' as const,
                    colspan: 1,
                    rowspan: 1
                  },
                  content: [{ type: 'text' as const, text: '格', styles: {} }]
                }
              ]
            }
          ]
        },
        children: []
      }
    ]
    expect(blockNoteDocumentSchema.parse(document)).toEqual(document)
  })

  it('accepts bounded project images, Mermaid, and block math while rejecting external images', () => {
    const logicalUrl = 'writellm-asset:019c6a5c-8d34-4a8e-a602-3d37a52dc901'
    const document = [
      {
        id: 'image',
        type: 'image' as const,
        props: {
          backgroundColor: 'default',
          textAlignment: 'center' as const,
          name: 'Architecture illustration',
          url: logicalUrl,
          caption: 'A visible caption',
          figureId: 'figure:section:image',
          altText: 'Architecture illustration',
          showPreview: true,
          previewWidth: 720
        },
        children: []
      },
      {
        id: 'diagram',
        type: 'diagram' as const,
        props: {
          engine: 'mermaid' as const,
          caption: 'Process',
          altText: 'A flows to B'
        },
        content: [{ type: 'text' as const, text: 'flowchart LR\nA --> B', styles: {} }],
        children: []
      },
      {
        id: 'formula',
        type: 'mathBlock' as const,
        props: {},
        content: [{ type: 'text' as const, text: 'E = mc^2', styles: {} }],
        children: []
      }
    ]
    expect(blockNoteDocumentSchema.parse(document)).toEqual(document)
    expect(
      blockNoteDocumentSchema.safeParse([
        { ...document[0], props: { ...document[0]?.props, url: 'https://example.test/a.png' } }
      ]).success
    ).toBe(false)
  })

  it('normalizes adjacent plain source and projects legacy media without rewriting existing IDs', () => {
    const normalized = normalizePlainBlockContent([
      {
        id: 'math',
        type: 'mathBlock',
        props: {},
        content: [
          { type: 'text', text: 'E = ', styles: {} },
          { type: 'text', text: 'mc^2', styles: {} }
        ],
        children: []
      }
    ])
    expect(normalized[0]?.content).toEqual([{ type: 'text', text: 'E = mc^2', styles: {} }])

    const projected = projectLegacyBlockNoteDocument([
      {
        id: 'legacy-math',
        type: 'math',
        props: {
          textAlignment: 'center',
          source: 'x+y',
          caption: 'Legacy caption',
          previewWidth: 720
        },
        children: []
      },
      {
        id: 'legacy-diagram',
        type: 'mermaid',
        props: {
          textAlignment: 'center',
          source: 'graph TD; A-->B',
          caption: 'Flow',
          previewWidth: 720
        },
        children: []
      }
    ])
    expect(projected.map((block) => block.type)).toEqual(['mathBlock', 'paragraph', 'diagram'])
    expect(projected[0]?.id).toBe('legacy-math')
    expect(projected[2]?.id).toBe('legacy-diagram')
    expect(projected[1]?.content).toEqual([
      { type: 'text', text: 'Legacy caption', styles: { italic: true } }
    ])
  })

  it('accepts bounded atomic inline math and rejects props, line breaks, and oversized UTF-8', () => {
    const document = [
      {
        ...paragraph('inline-math'),
        content: [
          { type: 'text' as const, text: 'Energy ', styles: {} },
          { type: 'math' as const, content: 'E = mc^2' },
          { type: 'text' as const, text: ' is conserved.', styles: {} }
        ]
      }
    ]
    expect(blockNoteDocumentSchema.parse(document)).toEqual(document)
    expect(
      blockNoteDocumentSchema.safeParse([
        { ...document[0], content: [{ type: 'math', content: 'x', props: {} }] }
      ]).success
    ).toBe(false)
    expect(
      blockNoteDocumentSchema.safeParse([
        { ...document[0], content: [{ type: 'math', content: 'x\ny' }] }
      ]).success
    ).toBe(false)
    expect(
      blockNoteDocumentSchema.safeParse([
        { ...document[0], content: [{ type: 'math', content: '界'.repeat(2_731) }] }
      ]).success
    ).toBe(false)
  })

  it.each([
    ['missing ID', [{ ...paragraph('remove'), id: undefined }]],
    ['duplicate ID', [paragraph('same'), paragraph('same')]],
    ['unknown prop', [{ ...paragraph('prop'), props: { ...paragraph('x').props, unsafe: true } }]],
    [
      'dangerous URL',
      [
        {
          ...paragraph('url'),
          content: [
            {
              type: 'link',
              href: 'javascript:alert(1)',
              content: [{ type: 'text', text: 'bad', styles: {} }]
            }
          ]
        }
      ]
    ],
    ['disallowed media', [{ ...paragraph('image'), type: 'image' }]]
  ])('rejects %s', (_label, document) => {
    expect(blockNoteDocumentSchema.safeParse(document).success).toBe(false)
  })

  it('rejects nesting beyond the approved depth', () => {
    const document = [paragraph('depth-0')]
    let current = document[0]
    for (let depth = 1; depth <= MAX_SECTION_NESTING_DEPTH; depth += 1) {
      const child = paragraph(`depth-${depth}`)
      current.children = [child]
      current = child
    }
    expect(blockNoteDocumentSchema.safeParse(document).success).toBe(false)
  })

  it('bounds extensible brief data and workspace section identity/count', () => {
    const brief = {
      title: 'Bounded brief',
      description: '',
      topic: '',
      targetAudience: '',
      language: 'en',
      styleTone: '',
      scopeExclusions: '',
      targetLength: '',
      citationRequirements: '',
      additionalInstructions: '',
      extensible: {}
    }
    let nested: Record<string, unknown> = {}
    for (let depth = 0; depth <= MAX_BRIEF_EXTENSIBLE_DEPTH; depth += 1) {
      nested = { child: nested }
    }
    expect(manuscriptBriefFieldsSchema.safeParse({ ...brief, extensible: nested }).success).toBe(
      false
    )
    expect(
      manuscriptBriefFieldsSchema.safeParse({
        ...brief,
        extensible: { payload: 'x'.repeat(MAX_BRIEF_EXTENSIBLE_BYTES) }
      }).success
    ).toBe(false)

    const section = {
      sectionId: 'section-1',
      manuscriptId: 'manuscript-1',
      parentSectionId: null,
      position: 0,
      level: 1,
      title: 'Section',
      objective: null,
      status: 'planned' as const,
      currentRevisionId: 'revision-1',
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z'
    }
    const revision = {
      sectionRevisionId: 'revision-1',
      sectionId: 'section-1',
      revisionNumber: 1,
      source: 'bootstrap' as const,
      contentSchemaVersion: 1 as const,
      contentHash: 'a'.repeat(64),
      priorRevisionId: null,
      wordCount: 0,
      characterCount: 0,
      countAlgorithmVersion: 2 as const,
      agentRunId: null,
      agentToolCallId: null,
      agentProposalId: null,
      createdAt: '2026-07-16T00:00:00.000Z'
    }
    const workspace = {
      manuscriptId: 'manuscript-1',
      outlineVersion: 1,
      brief: {
        ...brief,
        manuscriptBriefId: 'brief-1',
        manuscriptId: 'manuscript-1',
        version: 1,
        schemaVersion: 1 as const,
        createdAt: '2026-07-16T00:00:00.000Z'
      },
      sections: [
        { section, revision },
        { section: { ...section }, revision: { ...revision } }
      ],
      wordCount: 0,
      characterCount: 0
    }
    expect(
      sectionRevisionSummarySchema.safeParse({ ...revision, countAlgorithmVersion: 1 }).success
    ).toBe(true)
    expect(manuscriptWorkspaceSchema.safeParse(workspace).success).toBe(false)
  })
})
