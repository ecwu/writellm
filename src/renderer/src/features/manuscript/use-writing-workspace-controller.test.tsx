import type { ManuscriptReferenceOccurrence } from '../../../../shared/contracts/manuscript'
import { describe, expect, it, vi } from 'vitest'
import { resolveReadableCitationOccurrences } from './use-writing-workspace-controller'

function occurrences(count: number): ManuscriptReferenceOccurrence[] {
  return Array.from({ length: count }, (_, ordinal) => ({
    sectionId: crypto.randomUUID(),
    sectionRevisionId: crypto.randomUUID(),
    blockId: `block-${ordinal}`,
    ordinal,
    raw: '[Source: Paper]',
    syntax: 'english',
    title: 'Paper'
  }))
}

describe('readable citation occurrence resolution', () => {
  it('continues beyond 20 occurrences with at most four requests in flight', async () => {
    let active = 0
    let maximumActive = 0
    const resolve = vi.fn(async (occurrence: ManuscriptReferenceOccurrence) => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await Promise.resolve()
      active -= 1
      return occurrence.ordinal === 20
        ? ({ status: 'ambiguous', citations: [{ marker: 'first' }, { marker: 'second' }] } as never)
        : ({ status: 'unavailable', reason: 'unlinked' } as const)
    })
    const result = await resolveReadableCitationOccurrences(occurrences(25), resolve, () => true)
    expect(result?.status).toBe('ambiguous')
    expect(resolve).toHaveBeenCalledTimes(24)
    expect(maximumActive).toBe(4)
  })

  it('does not start later groups after replacement and preserves failure priority', async () => {
    let current = true
    const resolve = vi.fn(async () => {
      current = false
      return { status: 'unavailable', reason: 'source_missing' } as const
    })
    await expect(
      resolveReadableCitationOccurrences(occurrences(12), resolve, () => current)
    ).resolves.toBeNull()
    expect(resolve).toHaveBeenCalledTimes(4)

    const reasons = ['unlinked', 'source_missing', 'resolution_limit', 'index_unavailable'] as const
    const prioritized = await resolveReadableCitationOccurrences(
      occurrences(4),
      async (occurrence) => ({ status: 'unavailable', reason: reasons[occurrence.ordinal] }),
      () => true
    )
    expect(prioritized).toEqual({ status: 'unavailable', reason: 'index_unavailable' })
  })
})
