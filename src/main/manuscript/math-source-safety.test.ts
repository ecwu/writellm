import { describe, expect, it } from 'vitest'
import { isMathSourceStructurallySafe } from './math-source-safety'

describe('math source safety', () => {
  it.each([
    String.raw`\href{https://evil.example}{click}`,
    String.raw`\includegraphics{https://evil.example/pixel.png}`,
    String.raw`\htmlClass{danger}{x}`,
    String.raw`\input{/private/secret}`,
    String.raw`\rule{9999em}{1em}`
  ])('rejects capability-bearing or extreme source %s', (source) => {
    expect(isMathSourceStructurallySafe(source)).toBe(false)
  })

  it('allows ordinary bounded mathematics', () => {
    expect(isMathSourceStructurallySafe(String.raw`\frac{x^2}{y} + \text{evidence}`)).toBe(true)
  })
})
