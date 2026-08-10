import { defineConfig } from '@playwright/test'

const requiresSerialWorkers =
  process.env['WRITELLM_E2E_WINDOW_MODE'] === 'interactive' ||
  (process.platform === 'linux' && Boolean(process.env['CI']))
const usesSlowHostedRunner =
  Boolean(process.env['CI']) && (process.platform === 'win32' || process.platform === 'linux')
const testTimeout = usesSlowHostedRunner ? 90_000 : 45_000

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: requiresSerialWorkers ? 1 : 2,
  // Windows and Linux hosted runners can spend about two seconds per native Electron
  // interaction. Keep the same assertions bounded while allowing complete scenarios
  // with many sequential settings or editor operations to finish.
  timeout: testTimeout,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  failOnFlakyTests: Boolean(process.env['CI']),
  reporter: [['list'], ['./e2e/evidence-reporter.ts']],
  use: {
    trace: process.env['CI'] ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  }
})
