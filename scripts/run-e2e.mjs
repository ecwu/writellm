import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'

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

try {
  await verifyLoopbackListen()
} catch (error) {
  const code =
    error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : null
  if (code === 'EPERM' || code === 'EACCES') {
    process.stderr.write(
      'Electron E2E cannot listen on 127.0.0.1 in this sandbox. Run the same built suite outside the sandbox with approval.\n'
    )
    process.exit(1)
  }
  throw error
}

const result = spawnSync(process.execPath, [playwrightCli, 'test', ...forwardedArgs], {
  env: {
    ...process.env,
    WRITELLM_E2E_SUITE: evidenceSuite,
    WRITELLM_E2E_WINDOW_MODE: configuredMode
  },
  stdio: 'inherit'
})

if (result.error) throw result.error
if (result.signal !== null) process.exit(1)
process.exit(result.status ?? 1)

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
