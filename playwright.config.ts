import { defineConfig } from '@playwright/test'

const usesPackagedSuite = process.env['WRITELLM_E2E_SUITE'] === 'packaged'
const usesWindowsPackagedRunner = process.platform === 'win32' && usesPackagedSuite
const requiresSerialWorkers =
  process.env['WRITELLM_E2E_WINDOW_MODE'] === 'interactive' ||
  usesWindowsPackagedRunner ||
  (process.platform === 'linux' &&
    (Boolean(process.env['CI']) || process.env['WRITELLM_E2E_WINDOW_MODE'] === 'silent'))
const usesHostedRunner = Boolean(process.env['CI'])
const usesLinuxHeadlessRunner =
  process.platform === 'linux' &&
  (Boolean(process.env['CI']) || process.env['WRITELLM_E2E_WINDOW_MODE'] === 'silent')
const testTimeout =
  process.platform === 'win32' && (usesHostedRunner || usesPackagedSuite)
    ? 180_000
    : usesLinuxHeadlessRunner
      ? 90_000
      : 45_000

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: requiresSerialWorkers ? 1 : 2,
  // Windows packaged runs can spend about two seconds per native Electron interaction,
  // while headless Linux runs serially. Keep assertions bounded while allowing the longest
  // complete settings and editor scenarios to finish on slower package-validation hosts.
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
