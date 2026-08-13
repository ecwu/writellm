import { describe, expect, it } from 'vitest'
import {
  buildAgentPolicy,
  findOpaqueCitationMarker,
  usesReadableSourceFallback
} from './agent-policy'

describe('Agent writing policy', () => {
  it('keeps collaboration, academic-writing, and citation requirements explicit and bounded', () => {
    const policy = buildAgentPolicy()

    expect(policy).toContain('OPERATING_POLICY')
    expect(policy).toContain('COLLABORATION_POLICY')
    expect(policy).toContain('ACADEMIC_WRITING_POLICY')
    expect(policy).toContain('CITATION_POLICY')
    expect(policy).toContain('WRITING_TASK_POLICY')
    expect(policy).toContain('Never invent evidence, references, novelty')
    expect(policy).toContain('Before the first substantial tool phase')
    expect(policy).toContain('Never expose hidden reasoning or chain-of-thought')
    expect(policy).toContain('Between materially different phases')
    expect(policy).toContain('lead with the verified outcome')
    expect(policy).toContain('continue through the relevant bounded reads')
    expect(policy).toContain('Never emit an opaque marker such as [xx]')
    expect(policy).toContain('[Source: exact source title, p. N]')
    expect(policy).toContain('【来源：准确来源标题，第 N 页】')
    expect(policy).toContain('Task state is collaboration metadata')
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
