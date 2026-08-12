import { describe, expect, it } from 'vitest'
import {
  buildSessionTitleContext,
  fallbackSessionTitle,
  isGenericSessionTitle,
  sanitizeGeneratedSessionTitle,
  SESSION_TITLE_CONTEXT_MAX_BYTES
} from './session-title'

describe('Agent session titles', () => {
  it('recognizes only application-owned placeholder titles', () => {
    expect(isGenericSessionTitle('New conversation')).toBe(true)
    expect(isGenericSessionTitle('Conversation 12')).toBe(true)
    expect(isGenericSessionTitle('Conversation design')).toBe(false)
  })

  it('creates a readable Unicode-safe fallback from the first prompt', () => {
    expect(fallbackSessionTitle('  帮我  写一篇关于气候变化的文章  ')).toBe(
      '帮我 写一篇关于气候变化的文章'
    )
    expect(Array.from(fallbackSessionTitle('界'.repeat(100)))).toHaveLength(48)
  })

  it('removes common model wrappers and bounds the generated title', () => {
    expect(sanitizeGeneratedSessionTitle('## 标题：“气候变化研究。”\nMore')).toBe('气候变化研究')
    expect(Array.from(sanitizeGeneratedSessionTitle(`Title: ${'x'.repeat(100)}`))).toHaveLength(80)
  })

  it('keeps the first request, latest summary, and bounded recent conversation', () => {
    const context = buildSessionTitleContext([
      { sequence: 1, role: 'user', content: 'Initial research question' },
      { sequence: 3, role: 'summary', content: 'Earlier decisions' },
      ...Array.from({ length: 30 }, (_, index) => ({
        sequence: index + 4,
        role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `${index}:${'界'.repeat(1_000)}`
      }))
    ])

    expect(context).toContain('USER: Initial research question')
    expect(context).toContain('SUMMARY: Earlier decisions')
    expect(context).not.toContain('USER: 0:')
    expect(Buffer.byteLength(context)).toBeLessThanOrEqual(SESSION_TITLE_CONTEXT_MAX_BYTES)
  })
})
