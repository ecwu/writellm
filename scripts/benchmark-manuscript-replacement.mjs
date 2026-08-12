import { spawnSync } from 'node:child_process'

const result = spawnSync(
  process.execPath,
  ['scripts/run-tests.mjs', 'src/main/manuscript/manuscript-replacement-benchmark.test.ts'],
  {
    cwd: process.cwd(),
    env: { ...process.env, WRITELLM_MANUSCRIPT_REPLACEMENT_BENCHMARK: '1' },
    stdio: 'inherit'
  }
)
process.exit(result.status ?? 1)
