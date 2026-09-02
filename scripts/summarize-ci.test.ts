import { expect, it } from 'vitest'
import { summarizeJobs } from './summarize-ci.mjs'

it('distinguishes parallel wall time from accumulated runtime and excludes skipped and summary jobs', () => {
  const job = (name: string, start: number, end: number, conclusion = 'success') => ({
    name,
    started_at: new Date(start).toISOString(),
    completed_at: new Date(end).toISOString(),
    conclusion
  })
  expect(
    summarizeJobs(new Date(0).toISOString(), [
      job('static', 1_000, 10_000),
      job('macOS', 11_000, 40_000),
      job('Windows', 11_000, 30_000, 'failure'),
      job('Linux', 10_000, 10_000, 'skipped'),
      job('Build timing summary', 41_000, 50_000)
    ])
  ).toEqual({
    wallMs: 40_000,
    runnerMs: 57_000,
    jobs: [
      { name: 'static', status: 'success', durationMs: 9_000 },
      { name: 'macOS', status: 'success', durationMs: 29_000 },
      { name: 'Windows', status: 'failure', durationMs: 19_000 },
      { name: 'Linux', status: 'skipped', durationMs: null }
    ]
  })
})
