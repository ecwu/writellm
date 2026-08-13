import { describe, expect, it } from 'vitest'
import { manuscriptAssemblySchema } from './contracts/manuscript'
import { manuscriptSectionToMarkdown, manuscriptToMarkdown } from './manuscript-markdown'

const createdAt = '2026-07-30T12:00:00.000Z'

describe('whole-manuscript Markdown conversion', () => {
  it('renders canonical outline order, GFM, rich media, assets, and explicit losses', () => {
    const manuscript = manuscriptAssemblySchema.parse({
      manuscriptId: 'manuscript-1',
      outlineVersion: 3,
      brief: {
        manuscriptBriefId: 'brief-1',
        manuscriptId: 'manuscript-1',
        version: 1,
        schemaVersion: 1,
        title: 'Export fixture',
        description: '',
        topic: '',
        targetAudience: '',
        language: 'en',
        styleTone: '',
        scopeExclusions: '',
        targetLength: '',
        citationRequirements: '',
        additionalInstructions: '',
        extensible: {},
        createdAt
      },
      sections: [
        section('section-1', null, 1, 'Opening', [
          textBlock('paragraph', 'p1', [
            { type: 'text', text: 'Bold', styles: { bold: true } },
            { type: 'text', text: ' and highlighted', styles: { backgroundColor: 'yellow' } },
            {
              type: 'link',
              href: 'https://example.com',
              content: [{ type: 'text', text: ' source', styles: { italic: true } }]
            }
          ]),
          {
            id: 'table-1',
            type: 'table',
            props: { textColor: 'default' },
            content: {
              type: 'tableContent',
              columnWidths: [null, null],
              rows: [
                {
                  cells: [
                    [{ type: 'text', text: 'A', styles: {} }],
                    [{ type: 'text', text: 'B', styles: {} }]
                  ]
                },
                {
                  cells: [
                    [{ type: 'text', text: '1', styles: {} }],
                    [{ type: 'text', text: '2', styles: {} }]
                  ]
                }
              ]
            },
            children: []
          },
          {
            id: 'image-1',
            type: 'image',
            props: {
              backgroundColor: 'default',
              textAlignment: 'center',
              name: 'Chart',
              url: 'writellm-asset:019c6a5c-8d34-4a8e-a602-3d37a52dc901',
              caption: 'Measured results',
              showPreview: true,
              previewWidth: 720
            },
            children: []
          },
          {
            id: 'mermaid-1',
            type: 'mermaid',
            props: {
              source: 'graph TD\nA-->B',
              caption: '',
              textAlignment: 'center',
              previewWidth: 720
            },
            children: []
          },
          {
            id: 'math-1',
            type: 'math',
            props: {
              source: 'E = mc^2',
              caption: '',
              textAlignment: 'center',
              previewWidth: 720
            },
            children: []
          }
        ]),
        section('section-2', 'section-1', 2, 'Details', [
          textBlock('heading', 'body-heading', [{ type: 'text', text: 'Evidence', styles: {} }], {
            level: 3
          }),
          textBlock('checkListItem', 'check', [{ type: 'text', text: 'Verified', styles: {} }], {
            checked: true
          })
        ])
      ],
      wordCount: 8,
      characterCount: 50
    })

    const result = manuscriptToMarkdown(manuscript, () => 'assets/hash.png')

    expect(result.markdown).toBe(`# Opening

**Bold** and highlighted[* source*](https://example.com)

| A | B |
| --- | --- |
| 1 | 2 |

![Chart](assets/hash.png)

_Measured results_

\`\`\`mermaid
graph TD
A-->B
\`\`\`

$$
E = mc^2
$$

## Details

### Evidence

- [x] Verified
`)
    expect(result.lossReport.losses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'background_color', blockId: 'p1' }),
        expect.objectContaining({ code: 'text_alignment', blockId: 'image-1' }),
        expect.objectContaining({ code: 'preview_width', blockId: 'image-1' })
      ])
    )
  })

  it('reports table spans and preserves nested list indentation', () => {
    const manuscript = manuscriptAssemblySchema.parse({
      manuscriptId: 'manuscript-1',
      outlineVersion: 1,
      brief: {
        manuscriptBriefId: 'brief-1',
        manuscriptId: 'manuscript-1',
        version: 1,
        schemaVersion: 1,
        title: 'Export fixture',
        description: '',
        topic: '',
        targetAudience: '',
        language: 'en',
        styleTone: '',
        scopeExclusions: '',
        targetLength: '',
        citationRequirements: '',
        additionalInstructions: '',
        extensible: {},
        createdAt
      },
      sections: [
        section('section-1', null, 1, 'List', [
          {
            ...textBlock('bulletListItem', 'parent', [
              { type: 'text', text: 'Parent', styles: {} }
            ]),
            children: [
              textBlock('numberedListItem', 'child', [{ type: 'text', text: 'Child', styles: {} }])
            ]
          },
          {
            id: 'table-span',
            type: 'table',
            props: { textColor: 'default' },
            content: {
              type: 'tableContent',
              columnWidths: [null],
              headerRows: 2,
              headerCols: 1,
              rows: [
                {
                  cells: [
                    {
                      type: 'tableCell',
                      props: {
                        backgroundColor: 'default',
                        textColor: 'default',
                        textAlignment: 'left',
                        colspan: 2,
                        rowspan: 1
                      },
                      content: [{ type: 'text', text: 'Wide', styles: {} }]
                    }
                  ]
                }
              ]
            },
            children: []
          }
        ])
      ],
      wordCount: 3,
      characterCount: 15
    })
    const result = manuscriptToMarkdown(manuscript, () => {
      throw new Error('No asset expected')
    })
    expect(result.markdown).toContain('- Parent\n\n  1. Child')
    expect(result.lossReport.losses.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['table_span', 'table_header_columns', 'table_multiple_header_rows'])
    )
  })

  it('uses one manuscript-wide citation index for whole and single-section exports', () => {
    const manuscript = manuscriptAssemblySchema.parse({
      manuscriptId: 'manuscript-1',
      outlineVersion: 4,
      brief: {
        manuscriptBriefId: 'brief-1',
        manuscriptId: 'manuscript-1',
        version: 1,
        schemaVersion: 1,
        title: 'Citation export',
        description: '',
        topic: '',
        targetAudience: '',
        language: 'en',
        styleTone: '',
        scopeExclusions: '',
        targetLength: '',
        citationRequirements: '',
        additionalInstructions: '',
        extensible: {},
        createdAt
      },
      sections: [
        section('section-1', null, 1, 'First', [
          textBlock('paragraph', 'citation-1', [
            { type: 'text', text: '[Source: Alpha, p. 1]', styles: {} }
          ])
        ]),
        section('section-2', null, 1, 'Second', [
          textBlock('paragraph', 'citation-2', [
            { type: 'text', text: '[Source: Be', styles: { bold: true } },
            { type: 'text', text: 'ta] and ', styles: {} },
            { type: 'text', text: '【来源：Alpha，第 9 页】', styles: { italic: true } }
          ])
        ])
      ],
      wordCount: 0,
      characterCount: 0
    })
    const whole = manuscriptToMarkdown(manuscript, (value) => value)
    const single = manuscriptSectionToMarkdown(manuscript, 'section-2', (value) => value)

    expect(whole.markdown).toContain('# First\n\n[1]')
    expect(whole.markdown).toContain('# Second\n\n**[2]** and *[1]*')
    expect(single.markdown).toBe('**[2]** and *[1]*\n')
    expect(single.markdown).not.toContain('References')
    expect(single.lossReport.losses).toEqual([
      expect.objectContaining({ code: 'citation_numbering', blockId: 'citation-2' })
    ])
  })
})

function textBlock(
  type: 'paragraph' | 'heading' | 'bulletListItem' | 'numberedListItem' | 'checkListItem',
  id: string,
  content: unknown[],
  extraProps: Record<string, unknown> = {}
) {
  return {
    id,
    type,
    props: {
      backgroundColor: 'default',
      textColor: 'default',
      textAlignment: 'left',
      ...extraProps
    },
    content,
    children: []
  }
}

function section(
  sectionId: string,
  parentSectionId: string | null,
  level: number,
  title: string,
  content: unknown[]
) {
  return {
    section: {
      sectionId,
      manuscriptId: 'manuscript-1',
      parentSectionId,
      position: 0,
      level,
      title,
      objective: null,
      status: 'drafting',
      currentRevisionId: `revision-${sectionId}`,
      createdAt,
      updatedAt: createdAt
    },
    revision: {
      sectionRevisionId: `revision-${sectionId}`,
      sectionId,
      revisionNumber: 1,
      source: 'manual',
      sourceClass: 'manual_checkpoint',
      content,
      contentSchemaVersion: 3,
      contentHash: 'a'.repeat(64),
      priorRevisionId: null,
      wordCount: 1,
      characterCount: 1,
      countAlgorithmVersion: 2,
      agentRunId: null,
      agentToolCallId: null,
      agentProposalId: null,
      createdAt
    }
  }
}
