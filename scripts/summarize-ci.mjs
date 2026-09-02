import { appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function summarizeJobs(startedAt, jobs) {
  const builds = jobs.filter((job) => job.name !== 'Build timing summary')
  const completed = builds.filter(
    (job) => job.started_at && job.completed_at && job.conclusion !== 'skipped'
  )
  const duration = (job) => Math.max(0, Date.parse(job.completed_at) - Date.parse(job.started_at))
  return {
    wallMs: completed.length
      ? Math.max(...completed.map((job) => Date.parse(job.completed_at))) - Date.parse(startedAt)
      : null,
    runnerMs: completed.reduce((total, job) => total + duration(job), 0),
    jobs: builds.map((job) => ({
      name: job.name,
      status: job.conclusion ?? job.status,
      durationMs: completed.includes(job) ? duration(job) : null
    }))
  }
}

async function main() {
  const {
    GITHUB_API_URL = 'https://api.github.com',
    GITHUB_REPOSITORY,
    GITHUB_RUN_ID,
    GITHUB_RUN_ATTEMPT,
    GITHUB_TOKEN,
    GITHUB_STEP_SUMMARY
  } = process.env
  if (
    !GITHUB_REPOSITORY ||
    !GITHUB_RUN_ID ||
    !GITHUB_RUN_ATTEMPT ||
    !GITHUB_TOKEN ||
    !GITHUB_STEP_SUMMARY
  ) {
    throw new Error('CI summary requires the GitHub run environment')
  }
  const base = `${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/attempts/${GITHUB_RUN_ATTEMPT}`
  async function get(url) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(30_000)
    })
    if (!response.ok) throw new Error(`GitHub timing request failed with HTTP ${response.status}`)
    return response.json()
  }
  const run = await get(base)
  const jobs = []
  for (let page = 1; ; page++) {
    const result = await get(`${base}/jobs?per_page=100&page=${page}`)
    jobs.push(...result.jobs)
    if (jobs.length >= result.total_count || result.jobs.length === 0) break
  }
  const summary = summarizeJobs(run.run_started_at, jobs)
  const format = (ms) => {
    if (ms === null) return 'Not run'
    const seconds = Math.round(ms / 1_000)
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  }
  const lines = [
    '## Build timing',
    '',
    `Elapsed wait through completion of build jobs: **${format(summary.wallMs)}**.`,
    `Cumulative completed job runtime: **${format(summary.runnerMs)}** (parallel jobs overlap; not billed minutes).`,
    '',
    '| Job | Result | Runtime |',
    '| --- | --- | --- |',
    ...summary.jobs.map((job) => `| ${job.name} | ${job.status} | ${format(job.durationMs)} |`),
    '',
    'Stage and test-attempt JSON reports are attached to each verification artifact. The timing-summary job itself is excluded.',
    ''
  ]
  await appendFile(GITHUB_STEP_SUMMARY, lines.join('\n'))
  process.stdout.write(`${JSON.stringify(summary)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
