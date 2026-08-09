import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const script = fileURLToPath(new URL('./smoke-packaged-hybrid.mjs', import.meta.url))
const args = process.argv.slice(2)
if (args.length === 0) {
  const defaultResources = join('dist', 'mac-arm64', 'writellm.app', 'Contents', 'Resources')
  if (existsSync(defaultResources)) args.push(defaultResources)
}
const result = spawnSync(electron, [script, ...args], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit'
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
