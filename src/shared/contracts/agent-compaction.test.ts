import { describe, expect, it } from 'vitest'
import { agentCompactionCheckpointV4PayloadSchema } from './agent-compaction'

const ids = {
  compactionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc401',
  previousCheckpointEventId: null
}

describe('Agent compaction v4 contract', () => {
  it('records one lossy, non-authoritative checkpoint with explicit omissions', () => {
    const payload = agentCompactionCheckpointV4PayloadSchema.parse({
      schemaVersion: 4,
      ...ids,
      trigger: 'auto_threshold',
      coveredFromSequence: 1,
      coveredThroughSequence: 101,
      summary: 'Keep the latest user requirements.',
      omittedEventCount: 37,
      estimatedTokensBefore: 80_000,
      estimatedTokensAfter: 2_000,
      timestamp: 1
    })
    expect(payload).toMatchObject({
      schemaVersion: 4,
      omittedEventCount: 37,
      coveredThroughSequence: 101
    })
  })

  it('rejects inverted coverage while accepting zero omitted events', () => {
    const valid = {
      schemaVersion: 4 as const,
      ...ids,
      trigger: 'manual' as const,
      coveredFromSequence: 4,
      coveredThroughSequence: 4,
      summary: 'Summary',
      omittedEventCount: 0,
      estimatedTokensBefore: 10,
      estimatedTokensAfter: 4,
      timestamp: 1
    }
    expect(agentCompactionCheckpointV4PayloadSchema.parse(valid).omittedEventCount).toBe(0)
    expect(() =>
      agentCompactionCheckpointV4PayloadSchema.parse({
        ...valid,
        coveredFromSequence: 5,
        coveredThroughSequence: 4
      })
    ).toThrow('coverage is invalid')
  })
})
