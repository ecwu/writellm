import { describe, expect, it } from 'vitest'
import {
  buildAgentPolicy,
  findOpaqueCitationMarker,
  usesReadableSourceFallback
} from './writing-policy'

describe('Agent writing policy', () => {
  it('keeps academic-writing and citation requirements explicit and bounded', () => {
    const policy = buildAgentPolicy()

    expect(policy).toContain('ACADEMIC_WRITING_POLICY')
    expect(policy).toContain('CITATION_POLICY')
    expect(policy).toContain('Never invent evidence, references, novelty')
    expect(policy).toContain('Never emit an opaque marker such as [xx]')
    expect(policy).toContain('[Source: exact source title, p. N]')
    expect(policy).toContain('【来源：准确来源标题，第 N 页】')
    expect(new TextEncoder().encode(policy).byteLength).toBeLessThan(16_384)
  })

  it.each([
    ['internal citation ID', `citation-${'a'.repeat(40)}`],
    ['xx placeholder', 'A claim [xx].'],
    ['question placeholder', 'A claim [?].'],
    ['generic placeholder', 'A claim [citation].']
  ])('detects %s in proposed manuscript text', (_label, text) => {
    expect(findOpaqueCitationMarker(text)).not.toBeNull()
  })

  it('allows verified numeric mappings and recognizes the readable fallback', () => {
    expect(findOpaqueCitationMarker('Prior work established this result [12].')).toBeNull()
    expect(usesReadableSourceFallback('[Source: Exact paper title, p. 3]')).toBe(true)
    expect(usesReadableSourceFallback('【来源：Exact paper title，第 3 页】')).toBe(true)
  })
})
