import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const playwrightCli = require.resolve('@playwright/test/cli')
const args = process.argv.slice(2)
const visible = args.includes('--visible')
const forwardedArgs = args.filter((argument) => argument !== '--visible')
const debugMode =
  visible ||
  process.env['PWDEBUG'] === '1' ||
  forwardedArgs.includes('--debug') ||
  forwardedArgs.includes('--headed') ||
  forwardedArgs.includes('--ui')
const configuredMode = debugMode
  ? 'interactive'
  : (process.env['WRITELLM_E2E_WINDOW_MODE'] ?? 'silent')

const result = spawnSync(process.execPath, [playwrightCli, 'test', ...forwardedArgs], {
  env: {
    ...process.env,
    WRITELLM_E2E_WINDOW_MODE: configuredMode
  },
  stdio: 'inherit'
})

if (result.error) throw result.error
if (result.signal !== null) process.exit(1)
process.exit(result.status ?? 1)
