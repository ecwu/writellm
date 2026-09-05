import { describe, expect, it } from 'vitest'
import { AGENT_MUTATION_PREVIEW_TEXT_LIMIT } from '../../shared/contracts/agent-mutations'
import { createPreview, presentationText } from './mutation-presentation'
import { truncateImagePromptUtf8 } from './mutation-storage'
import { truncateUtf8 } from './session-history'
import { buildSessionTitleContext, SESSION_TITLE_CONTEXT_MAX_BYTES } from './session-title'

describe('Agent UTF-8 truncation', () => {
  it('keeps the longest complete prefix at every byte boundary', () => {
    for (const value of ['', 'plain text', '中文🙂é text', '\ud800x\udc00']) {
      for (let limit = 0; limit <= Buffer.byteLength(value) + 1; limit += 1) {
        let expected = ''
        for (const character of value) {
          if (Buffer.byteLength(expected + character) > limit) break
          expected += character
        }
        expect(truncateUtf8(value, limit)).toBe(expected)
      }
    }
  })

  it('preserves image prompt ellipses within the byte budget', () => {
    expect(truncateImagePromptUtf8('中文🙂', 10)).toBe('中文🙂')
    expect(truncateImagePromptUtf8('中文🙂', 9)).toBe('中文…')
    expect(truncateImagePromptUtf8('🙂🙂', 6)).toBe('…')
  })

  it('keeps preview text valid and bounded when a character straddles the limit', () => {
    const prefix = 'a'.repeat(AGENT_MUTATION_PREVIEW_TEXT_LIMIT - 1)
    const preview = createPreview({
      summary: 'Unicode preview',
      affectedSectionIds: [],
      beforeText: `${prefix}界`,
      afterText: `${prefix}🙂`,
      citedSources: []
    })
    expect(preview.beforeText).toBe(prefix)
    expect(preview.afterText).toBe(prefix)
    expect(preview.beforeTextTruncated).toBe(true)
    expect(preview.afterTextTruncated).toBe(true)
    expect(presentationText(`${'a'.repeat(4_095)}🙂`)).toEqual({
      text: 'a'.repeat(4_095),
      truncated: true
    })
    expect(presentationText('中文🙂')).toEqual({ text: '中文🙂', truncated: false })
    expect(presentationText(null)).toEqual({ text: null, truncated: false })
  })

  it('preserves title-context trimming and the complete Unicode prefix', () => {
    const prefix = 'a'.repeat(SESSION_TITLE_CONTEXT_MAX_BYTES - 9)
    const context = buildSessionTitleContext([
      { sequence: 1, role: 'user', content: `${prefix} 🙂end` }
    ])
    expect(context).toBe(`USER: ${prefix}`)
  })
})
