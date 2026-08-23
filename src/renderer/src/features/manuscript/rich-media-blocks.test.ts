import { describe, expect, it } from 'vitest'
import {
  getMermaidRenderConfig,
  isUnsafeMermaidAttribute,
  isUnsafeMermaidCss,
  renderDisplayMathToString
} from './rich-media-blocks'

describe('rich media block safety', () => {
  it('keeps Mermaid in strict SVG-only mode for both themes', () => {
    expect(getMermaidRenderConfig(false)).toMatchObject({
      securityLevel: 'strict',
      theme: 'default',
      htmlLabels: false,
      flowchart: { htmlLabels: false }
    })
    expect(getMermaidRenderConfig(true)).toMatchObject({
      securityLevel: 'strict',
      theme: 'dark',
      htmlLabels: false,
      flowchart: { htmlLabels: false }
    })
  })

  it('classifies remote CSS, imports, and expressions as unsafe while allowing local fragments', () => {
    expect(isUnsafeMermaidCss('@import url(https://example.com/evil.css)')).toBe(true)
    expect(isUnsafeMermaidCss('width: expression(alert(1))')).toBe(true)
    expect(isUnsafeMermaidCss('fill: url(https://example.com/a.svg)')).toBe(true)
    expect(isUnsafeMermaidCss('fill: url(#local-gradient)')).toBe(false)
  })

  it('drops executable and remote SVG attributes while retaining local fragment references', () => {
    expect(isUnsafeMermaidAttribute('onload', 'alert(1)')).toBe(true)
    expect(isUnsafeMermaidAttribute('SRC', 'data:text/html,unsafe')).toBe(true)
    expect(isUnsafeMermaidAttribute('href', 'javascript:alert(1)')).toBe(true)
    expect(isUnsafeMermaidAttribute('xlink:href', 'https://example.com/remote.svg')).toBe(true)
    expect(isUnsafeMermaidAttribute('style', 'fill: url(https://example.com/a.svg)')).toBe(true)
    expect(isUnsafeMermaidAttribute('href', '#local-node')).toBe(false)
    expect(isUnsafeMermaidAttribute('style', 'fill: url(#local-gradient)')).toBe(false)
  })

  it('renders display math without enabling trusted HTML or remote resources', () => {
    const formula = renderDisplayMathToString('x^2 + y^2')
    expect(formula).toContain('katex-display')

    const link = renderDisplayMathToString(String.raw`\href{javascript:alert(1)}{x}`)
    expect(link).not.toMatch(/<a(?:\s|>)/)
    expect(link).not.toContain('href=')

    const image = renderDisplayMathToString(
      String.raw`\includegraphics{https://example.com/image.png}`
    )
    expect(image).not.toMatch(/<img(?:\s|>)/)
    expect(image).not.toContain('src=')
  })

  it('rejects invalid and strict-mode HTML-extension formulas', () => {
    expect(() => renderDisplayMathToString(String.raw`\notARealCommand{x}`)).toThrow()
    expect(() => renderDisplayMathToString(String.raw`\htmlClass{unsafe}{x}`)).toThrow()
  })
})
