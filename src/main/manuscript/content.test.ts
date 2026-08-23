import { describe, expect, it } from 'vitest'
import {
  countSectionText,
  extractSectionAgentText,
  extractSectionText,
  prepareSectionContent
} from './content'

describe('section content processing', () => {
  it('canonicalizes object keys without normalizing native string content', () => {
    const decomposed = 'e\u0301'
    const first = prepareSectionContent([
      { type: 'paragraph', props: { z: 1, a: 2 }, content: [{ text: decomposed }] }
    ])
    const second = prepareSectionContent([
      { content: [{ text: decomposed }], props: { a: 2, z: 1 }, type: 'paragraph' }
    ])

    expect(first.contentJson).toBe(second.contentJson)
    expect(first.contentHash).toBe(second.contentHash)
    expect(
      (JSON.parse(first.contentJson) as Array<{ content: Array<{ text: string }> }>)[0]?.content[0]
        ?.text
    ).toBe(decomposed)
    expect(first.contentJson).not.toContain('é')
    expect(first.characterCount).toBe(1)
  })

  it('traverses links, custom inline content, tables, and nested children in document order', () => {
    const content = [
      {
        id: 'ignored-id',
        type: 'paragraph',
        props: { label: 'ignored prop' },
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'link', href: 'https://secret.example', content: [{ text: 'world' }] },
          { type: 'mention', content: '@Ada' }
        ],
        children: [{ type: 'paragraph', content: [{ text: '子' }], children: [] }]
      },
      {
        type: 'table',
        content: {
          type: 'tableContent',
          rows: [
            {
              cells: [
                [{ type: 'text', text: 'Cell', styles: {} }],
                [{ type: 'paragraph', content: [{ text: '格' }], children: [] }]
              ]
            }
          ]
        },
        children: []
      }
    ]

    const text = extractSectionText(content)
    expect(text).toBe('Hello world@Ada\n子\nCell\n格')
    expect(text).not.toContain('secret')
    expect(text).not.toContain('ignored')
    expect(countSectionText(text)).toEqual({ wordCount: 6, characterCount: 20 })
  })

  it('uses fixed Unicode word and character rules for CJK, combining marks, and emoji', () => {
    expect(countSectionText('Cafe\u0301 中文 한국어 123 🙂')).toEqual({
      wordCount: 7,
      characterCount: 13
    })
  })

  it('excludes canonical citations without joining the surrounding words', () => {
    const prepared = prepareSectionContent([
      {
        type: 'paragraph',
        content: [
          { text: 'alpha[Source: Research, p. 4]beta ' },
          { text: '中文【来源：报告，第 2 页】结束' }
        ]
      }
    ])
    expect(prepared.countAlgorithmVersion).toBe(2)
    expect(prepared.wordCount).toBe(6)
    expect(prepared.characterCount).toBe(13)
  })

  it('counts only rich-block captions while exposing bounded source and descriptions to Agent reads', () => {
    const content = [
      { type: 'image', props: { name: 'Alt description', caption: 'Image caption' }, children: [] },
      {
        type: 'mermaid',
        props: { caption: 'Diagram caption', source: 'flowchart LR\nSecret --> Source' },
        children: []
      },
      {
        type: 'math',
        props: { caption: 'Formula caption', source: 'E = mc^2' },
        children: []
      }
    ]
    const visible = extractSectionText(content)
    expect(visible).toBe('Image caption\nDiagram caption\nFormula caption')
    expect(visible).not.toContain('Secret')
    expect(visible).not.toContain('mc')
    const agent = extractSectionAgentText(content)
    expect(agent).toContain('Alt description')
    expect(agent).toContain('flowchart LR')
    expect(agent).toContain('E = mc^2')
  })

  it('treats inline math as structured content for counts and bounded Agent text', () => {
    const content = [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'alpha' },
          { type: 'math', content: 'E = mc^2' },
          { type: 'text', text: 'beta' }
        ],
        children: []
      },
      {
        type: 'table',
        content: {
          type: 'tableContent',
          rows: [
            {
              cells: [
                [
                  { type: 'math', content: 'x+y' },
                  { type: 'text', text: 'cell' }
                ]
              ]
            }
          ]
        },
        children: []
      }
    ]
    expect(extractSectionText(content)).toBe('alpha\nbeta\n\ncell')
    expect(countSectionText(extractSectionText(content))).toEqual({
      wordCount: 3,
      characterCount: 13
    })
    expect(extractSectionAgentText(content)).toBe('alpha$E = mc^2$beta\n$x+y$cell')
  })

  it('does not recognize or remove readable-citation syntax across inline math', () => {
    const content = [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '[Source: Re' },
          { type: 'math', content: 'x' },
          { type: 'text', text: 'search]' }
        ],
        children: []
      }
    ]
    const prepared = prepareSectionContent(content)
    expect(prepared.wordCount).toBe(3)
    expect(prepared.characterCount).toBe(17)
  })

  it('rejects values that cannot be losslessly represented as JSON', () => {
    expect(() => prepareSectionContent([{ content: [{ text: undefined }] }])).toThrow(
      'not JSON serializable'
    )
  })

  it.each([
    [
      'schema v1 text',
      [
        {
          id: 'v1-paragraph',
          type: 'paragraph',
          props: {
            backgroundColor: 'default',
            textColor: 'default',
            textAlignment: 'left'
          },
          content: [{ type: 'text', text: 'Legacy text', styles: {} }],
          children: []
        }
      ]
    ],
    [
      'schema v2 rich media',
      [
        {
          id: 'v2-mermaid',
          type: 'mermaid',
          props: {
            textAlignment: 'center',
            source: 'flowchart LR\nA --> B',
            caption: 'Legacy flow',
            previewWidth: 720
          },
          children: []
        },
        {
          id: 'v2-math',
          type: 'math',
          props: {
            textAlignment: 'center',
            source: 'E = mc^2',
            caption: 'Legacy equation',
            previewWidth: 720
          },
          children: []
        }
      ]
    ],
    [
      'schema v3 figure metadata',
      [
        {
          id: 'v3-image',
          type: 'image',
          props: {
            backgroundColor: 'default',
            textAlignment: 'center',
            name: 'Current image',
            url: 'writellm-asset:019d0000-0000-4000-8000-000000000454',
            caption: 'Current caption',
            figureId: 'figure:section:v3-image',
            altText: 'Current alternative',
            showPreview: true,
            previewWidth: 512
          },
          children: []
        }
      ]
    ]
  ] as const)('keeps %s JSON and content hashes stable across a no-op save', (_name, content) => {
    const first = prepareSectionContent(structuredClone(content) as unknown as unknown[])
    const reopened = JSON.parse(first.contentJson) as unknown[]
    const second = prepareSectionContent(reopened)

    expect(second.content).toEqual(first.content)
    expect(second.contentJson).toBe(first.contentJson)
    expect(second.contentHash).toBe(first.contentHash)
  })
})
