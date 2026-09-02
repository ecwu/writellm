import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'
import { VerificationRun } from './verification-run.mjs'

const script = fileURLToPath(new URL('./smoke-packaged-hybrid.mjs', import.meta.url))
const args = process.argv.slice(2)
if (args.length === 0) {
  const defaultResources = join('dist', 'mac-arm64', 'writellm.app', 'Contents', 'Resources')
  if (existsSync(defaultResources)) args.push(defaultResources)
}
const run = new VerificationRun('packaged-runtime-smoke')
let failure
try {
  await run.command('runtime-smoke', electron, [script, ...args], {
    env: { ELECTRON_RUN_AS_NODE: '1' }
  })
} catch (error) {
  failure = error
} finally {
  await run.finish(failure)
}
