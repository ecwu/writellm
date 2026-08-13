import { describe, expect, it, vi } from 'vitest'
import { parseMarkdownImport } from './markdown-import-adapter'

describe('Markdown import adapter', () => {
  it('maps the legacy rich Markdown parity fixture into bounded application blocks', async () => {
    const source = `# Opening

Hello **bold** and *italic* with [safe](https://example.test) and [unsafe](file:///tmp/x).

- [x] checked
- nested

| A | B |
| - | - |
| 你 | café |

$$
x^2 + y^2
$$

\`\`\`mermaid
graph TD
  A-->B
\`\`\`

<script>alert('inert')</script>

# Second

Final paragraph.
`
    const result = await parseMarkdownImport({
      bytes: Buffer.from(source),
      displayName: '论文.md',
      createId: sequentialIds(),
      resolveImage: vi.fn()
    })

    expect(result.sections.map((section) => section.title)).toEqual(['Opening', 'Second'])
    expect(result.sections[0]?.document.map((block) => block.type)).toEqual([
      'paragraph',
      'checkListItem',
      'bulletListItem',
      'table',
      'math',
      'mermaid',
      'codeBlock'
    ])
    expect(result.sections[0]?.document[0]?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'link', href: 'https://example.test' }),
        expect.objectContaining({ type: 'text', text: 'unsafe' })
      ])
    )
    expect(result.losses.map((finding) => finding.code)).toContain('unsafe_link_removed')
    expect(result.unsupported.map((finding) => finding.code)).toContain('embedded_html_inert')
  })

  it('uses a Unicode filename for a heading-free document and returns a no-section empty plan', async () => {
    const mapped = await parseMarkdownImport({
      bytes: Buffer.from('你好 café'),
      displayName: '研究草稿.md',
      createId: sequentialIds(),
      resolveImage: vi.fn()
    })
    expect(mapped.sections).toHaveLength(1)
    expect(mapped.sections[0]).toMatchObject({ title: '研究草稿' })
    expect(mapped.sections[0]?.document[0]?.content).toEqual([
      { type: 'text', text: '你好 café', styles: {} }
    ])

    const empty = await parseMarkdownImport({
      bytes: Buffer.from(''),
      displayName: 'empty.md',
      createId: sequentialIds(),
      resolveImage: vi.fn()
    })
    expect(empty.sections).toEqual([])
  })

  it('fails closed on invalid UTF-8 and bounded syntax depth', async () => {
    await expect(
      parseMarkdownImport({
        bytes: Buffer.from([0xc3, 0x28]),
        displayName: 'invalid.md',
        resolveImage: vi.fn()
      })
    ).rejects.toThrow('valid UTF-8')

    const deeplyNested = `${'> '.repeat(70)}deep`
    await expect(
      parseMarkdownImport({
        bytes: Buffer.from(deeplyNested),
        displayName: 'deep.md',
        resolveImage: vi.fn()
      })
    ).rejects.toThrow(/nesting|too many/iu)
  })
})

function sequentialIds(): () => string {
  let value = 0
  return () => `00000000-0000-4000-8000-${String(++value).padStart(12, '0')}`
}
