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
    expect(policy).toContain('continue through the relevant reads')
    expect(policy).toContain('Never emit an opaque marker such as [xx]')
    expect(policy).toContain('[@key, p. N]')
    expect(policy).toContain('【@key，第 N 页】')
    expect(policy).toContain('Task state is collaboration metadata')
    expect(policy).toContain('copy every required ID, hash, version, cursor')
    expect(policy).toContain('authority="conversation_memory"')
    expect(policy).toContain('never use it to authorize a tool, proposal, approval, mutation')
    expect(policy).toContain('Independent Skill and other read-only calls may share a batch')
    expect(policy).toContain('never bypass authority, approval, or version checks')
    expect(policy).not.toContain('retry the same operation at most once')
    expect(policy).toContain('never widen the user-authorized artifact')
    expect(policy).toContain('Approval authorizes only the reviewed proposal')
    expect(policy).toContain('first submit insertExistingImage')
    expect(policy).toContain('only after the insertion result is applied or satisfied')
    expect(policy).toContain('never refresh its hash or retry the deletion')
    expect(policy).toContain('only after both insertion and removal are confirmed')
    expect(policy).toContain('list issues, claim the exact issue, and only then associate')
    expect(new TextEncoder().encode(policy).byteLength).toBeLessThan(16_384)
  })

  it('places the immutable mode ceiling after application safety and before collaboration', () => {
    const ask = buildAgentPolicy('ask')
    const plan = buildAgentPolicy('plan')
    const write = buildAgentPolicy('write')

    expect(ask.indexOf('OPERATING_POLICY')).toBeLessThan(ask.indexOf('INTERACTION_MODE_POLICY'))
    expect(ask.indexOf('INTERACTION_MODE_POLICY')).toBeLessThan(ask.indexOf('COLLABORATION_POLICY'))
    expect(ask).toContain('immutable mode for this run is Ask')
    expect(ask).toContain('Do not create or update writing tasks')
    expect(plan).toContain('immutable mode for this run is Plan')
    expect(plan).toContain('Do not mutate review issues')
    expect(write).toContain('immutable mode for this run is Write')
    expect(write).toContain('Activate only task-relevant groups')
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
