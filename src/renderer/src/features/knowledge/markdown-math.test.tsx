import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { describe, expect, it } from 'vitest'
import { markdownSanitizeSchema, rehypeRenderHtmlMath } from './markdown-math'

const rehypePlugins = [
  rehypeRaw,
  [rehypeSanitize, markdownSanitizeSchema],
  rehypeRenderHtmlMath,
  rehypeKatex
] as React.ComponentProps<typeof ReactMarkdown>['rehypePlugins']

function render(markdown: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={rehypePlugins}>
      {markdown}
    </ReactMarkdown>
  )
}

describe('parsed Markdown math', () => {
  it('renders formulas inside a GFM table', () => {
    const html = render('| Complexity |\n| --- |\n| $O(n^2 \\cdot d)$ |')

    expect(html).toContain('<td><span class="katex">')
    expect(html).toContain('O(n^2 \\cdot d)')
    expect(html).not.toContain('&lt;span class="katex"')
  })

  it('renders formulas inside a raw HTML table', () => {
    const html = render(
      '<table><tbody><tr><td>$O(n^2 \\cdot d)$</td><td>$O(1)$</td></tr></tbody></table>'
    )

    expect(html.match(/<td><span class="katex">/g)).toHaveLength(2)
    expect(html).toContain('O(n^2 \\cdot d)')
    expect(html).not.toContain('&lt;span class="katex"')
  })
})
