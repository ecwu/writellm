import { describe, expect, it } from 'vitest'
import {
  getMermaidRenderConfig,
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
