import { describe, expect, it } from 'vitest'
import type { BlockNoteInlineContent } from './contracts/manuscript'
import { blockNoteInlinePlainText } from './blocknote-inline-text'

describe('BlockNote inline plain-text projection', () => {
  it('shares exact text, link, and math semantics', () => {
    const content: BlockNoteInlineContent[] = [
      { type: 'text', text: 'A', styles: {} },
      {
        type: 'link',
        href: 'https://example.com',
        content: [{ type: 'text', text: 'link', styles: {} }]
      },
      { type: 'math', source: 'x' }
    ]
    expect(blockNoteInlinePlainText(content)).toBe('Alink\uFFFC')
  })
})
