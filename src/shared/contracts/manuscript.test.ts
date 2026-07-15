import { describe, expect, it } from 'vitest'
import { blockNoteDocumentSchema, MAX_SECTION_NESTING_DEPTH } from './manuscript'

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
})
