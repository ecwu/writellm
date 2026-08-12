import { spawnSync } from 'node:child_process'

const result = spawnSync(
  process.execPath,
  ['scripts/run-tests.mjs', 'src/main/manuscript/manuscript-search-benchmark.test.ts'],
  {
    cwd: process.cwd(),
    env: { ...process.env, WRITELLM_MANUSCRIPT_SEARCH_BENCHMARK: '1' },
    stdio: 'inherit'
  }
)

if (result.error) throw result.error
process.exitCode = result.status ?? 1
