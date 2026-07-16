import { describe, expect, it } from 'vitest'
import { jobStatusSchema, listJobsInputSchema } from './jobs'

describe('job IPC contracts', () => {
  it('bounds pagination and exposes no lease, worker, or payload fields', () => {
    expect(() =>
      listJobsInputSchema.parse({
        projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc800',
        limit: 101
      })
    ).toThrow()
    expect(() =>
      jobStatusSchema.parse({
        jobId: 'job',
        type: 'build_index_generation',
        state: 'queued',
        priority: 0,
        attempts: 0,
        maxAttempts: 3,
        runAfter: '2026-07-15T00:00:00.000Z',
        progress: null,
        cancellationRequested: false,
        error: null,
        createdAt: '2026-07-15T00:00:00.000Z',
        updatedAt: '2026-07-15T00:00:00.000Z',
        startedAt: null,
        completedAt: null,
        leaseToken: 'secret-capability'
      })
    ).toThrow()
  })
})
