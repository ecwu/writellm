import { spawnSync } from 'node:child_process'
import electron from 'electron'

const vitestEntry = new URL('../node_modules/vitest/vitest.mjs', import.meta.url)
const result = spawnSync(electron, [vitestEntry.pathname, 'run'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit'
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
