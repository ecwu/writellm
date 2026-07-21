import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AgentMarkdown } from './agent-markdown'

describe('AgentMarkdown', () => {
  it('renders GFM structure instead of exposing Markdown syntax', () => {
    const html = renderToStaticMarkup(
      <AgentMarkdown
        content={
          '**Grounded** response\n\n- first\n- second\n\n| Source | Page |\n| --- | --- |\n| Paper | 1 |'
        }
      />
    )

    expect(html).toContain('<strong>Grounded</strong>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<table>')
    expect(html).not.toContain('**Grounded**')
  })

  it('drops raw HTML, blocks image loads, and keeps only approved external links', () => {
    const html = renderToStaticMarkup(
      <AgentMarkdown
        content={
          '<script>alert("unsafe")</script>\n\n![remote](https://example.com/image.png)\n\n[Safe](https://example.com/paper) [Unsafe](http://127.0.0.1/private)'
        }
      />
    )

    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).toContain('[Image: remote]')
    expect(html).toContain('href="https://example.com/paper"')
    expect(html).not.toContain('href="http://127.0.0.1/private"')
    expect(html).not.toContain('href=""')
  })
})
