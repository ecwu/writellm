import { spawnSync } from 'node:child_process'
import electron from 'electron'

const script = new URL('./smoke-packaged-hybrid.mjs', import.meta.url)
const result = spawnSync(electron, [script.pathname, ...process.argv.slice(2)], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit'
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
