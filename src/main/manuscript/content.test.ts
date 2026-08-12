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

  it('rejects values that cannot be losslessly represented as JSON', () => {
    expect(() => prepareSectionContent([{ content: [{ text: undefined }] }])).toThrow(
      'not JSON serializable'
    )
  })
})
