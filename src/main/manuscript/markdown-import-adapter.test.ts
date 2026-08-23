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
      'mathBlock',
      'diagram',
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

  it('maps bounded inline mathematics to native atomic content without a loss', async () => {
    const mapped = await parseMarkdownImport({
      bytes: Buffer.from('# Formula\n\nEnergy is $E = mc^2$.'),
      displayName: 'formula.md',
      createId: sequentialIds(),
      resolveImage: vi.fn()
    })
    expect(mapped.sections[0]?.document[0]?.content).toEqual([
      { type: 'text', text: 'Energy is ', styles: {} },
      { type: 'math', content: 'E = mc^2' },
      { type: 'text', text: '.', styles: {} }
    ])
    expect(mapped.losses.map((finding) => finding.code)).not.toContain('inline_math_text_fallback')
  })

  it('retains oversized inline mathematics as code-styled literal text with an exact loss', async () => {
    const source = '界'.repeat(2_731)
    const mapped = await parseMarkdownImport({
      bytes: Buffer.from(`# Formula\n\n$${source}$`),
      displayName: 'oversized-formula.md',
      createId: sequentialIds(),
      resolveImage: vi.fn()
    })
    expect(mapped.sections[0]?.document[0]?.content).toEqual([
      { type: 'text', text: `$${source}$`, styles: { code: true } }
    ])
    expect(mapped.losses.map((finding) => finding.code)).toContain('inline_math_size_fallback')
  })

  it('keeps unsafe block math and oversized diagrams as inert source instead of failing import', async () => {
    const oversizedDiagram = 'A'.repeat(64_001)
    const mapped = await parseMarkdownImport({
      bytes: Buffer.from(`# Structured source

$$
\\href{https://evil.example}{click}
$$

\`\`\`mermaid
${oversizedDiagram}
\`\`\`
`),
      displayName: 'bounded-rich-media.md',
      createId: sequentialIds(),
      resolveImage: vi.fn()
    })

    expect(mapped.sections[0]?.document.map((block) => block.type)).toEqual([
      'codeBlock',
      'codeBlock'
    ])
    expect(mapped.losses.map((finding) => finding.code)).toEqual([
      'block_math_source_fallback',
      'diagram_source_fallback'
    ])
    expect(mapped.losses.every((finding) => finding.sourceLocation !== null)).toBe(true)
  })

  it('logs parse lifecycle and omitted-image failures through the injected logger', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const failure = new Error('capture failed')
    const result = await parseMarkdownImport({
      bytes: Buffer.from('# Title\n\n![broken](missing.png)'),
      displayName: 'logged.md',
      createId: sequentialIds(),
      resolveImage: vi.fn(async () => {
        throw failure
      }),
      log
    })
    expect(result.losses.map((finding) => finding.code)).toContain('image_not_imported')
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'manuscript.import.markdown.parse_started',
        displayName: 'logged.md'
      }),
      expect.any(String)
    )
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'manuscript.import.markdown.parse_completed',
        sectionCount: 1,
        lossCount: 1
      }),
      expect.any(String)
    )
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'manuscript.import.markdown.image_omitted',
        err: failure,
        reference: 'missing.png'
      }),
      expect.any(String)
    )
    expect(log.error).not.toHaveBeenCalled()
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
