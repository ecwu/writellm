import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { VerificationRun } from './verification-run.mjs'

const require = createRequire(import.meta.url)
const playwrightCli = require.resolve('@playwright/test/cli')
const args = process.argv.slice(2)
const visible = args.includes('--visible')
const suiteArgument = args.find((argument) => argument.startsWith('--suite='))
const requestedSuite = suiteArgument?.slice('--suite='.length)
if (
  requestedSuite !== undefined &&
  requestedSuite !== 'critical' &&
  requestedSuite !== 'full' &&
  requestedSuite !== 'packaged'
) {
  throw new Error(`Unknown Electron E2E suite ${JSON.stringify(requestedSuite)}`)
}
const forwardedArgs = args.filter(
  (argument) => argument !== '--visible' && argument !== suiteArgument
)
if (requestedSuite === 'critical' || requestedSuite === 'packaged') {
  forwardedArgs.push('--grep', `@${requestedSuite}`)
}
const debugMode =
  visible ||
  process.env['PWDEBUG'] === '1' ||
  forwardedArgs.includes('--debug') ||
  forwardedArgs.includes('--headed') ||
  forwardedArgs.includes('--ui')
const configuredMode = debugMode
  ? 'interactive'
  : (process.env['WRITELLM_E2E_WINDOW_MODE'] ?? 'silent')
const evidenceSuite =
  requestedSuite ??
  process.env['WRITELLM_E2E_SUITE'] ??
  (forwardedArgs.length === 0 ? 'full' : 'focused')

const run = new VerificationRun(`e2e-${evidenceSuite}`, { selection: forwardedArgs })
let failure
try {
  await run.stage('loopback-preflight', async () => {
    try {
      await verifyLoopbackListen()
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        process.stderr.write(
          'Electron E2E cannot listen on 127.0.0.1 in this sandbox. Run the same built suite outside the sandbox with approval.\n'
        )
      }
      throw error
    }
  })
  await run.command('playwright', process.execPath, [playwrightCli, 'test', ...forwardedArgs], {
    env: {
      WRITELLM_E2E_SUITE: evidenceSuite,
      WRITELLM_E2E_WINDOW_MODE: configuredMode
    }
  })
} catch (error) {
  failure = error
} finally {
  await run.finish(failure)
}

function verifyLoopbackListen() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
  })
}
