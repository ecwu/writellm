import { fileURLToPath } from 'node:url'
import { VerificationRun } from './verification-run.mjs'

const run = new VerificationRun('benchmark-trace-80-histories-12-requests')
let failure
try {
  await run.command(
    'trace-benchmark',
    process.execPath,
    [
      fileURLToPath(new URL('./run-tests.mjs', import.meta.url)),
      'src/main/agent/trace-repository.test.ts',
      '-t',
      'deduplicates long repeated histories and rebuilds every request through SQL',
      ...process.argv.slice(2)
    ],
    { env: { WRITELLM_TRACE_BENCHMARK: '1' } }
  )
} catch (error) {
  failure = error
} finally {
  await run.finish(failure)
}
