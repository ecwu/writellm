import { fileURLToPath } from 'node:url'
import electron from 'electron'
import { VerificationRun } from './verification-run.mjs'

const vitestEntry = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))
const args = process.argv.slice(2)
const run = new VerificationRun(args.length ? 'tests-focused' : 'tests-full', { selection: args })
let failure
try {
  await run.command(
    'vitest',
    electron,
    [
      vitestEntry,
      'run',
      ...args,
      ...(!args.some((arg) => arg.startsWith('--reporter')) ? ['--reporter=default'] : []),
      '--reporter=./scripts/vitest-reporter.mjs'
    ],
    { env: { ELECTRON_RUN_AS_NODE: '1' } }
  )
} catch (error) {
  failure = error
} finally {
  await run.finish(failure)
}
