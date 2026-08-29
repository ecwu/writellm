import { defineConfig } from '@playwright/test'

const usesPackagedSuite = process.env['WRITELLM_E2E_SUITE'] === 'packaged'
const usesPackagedExecutable = Boolean(process.env['WRITELLM_E2E_EXECUTABLE_PATH'])
const usesPackagedValidation = usesPackagedSuite || usesPackagedExecutable
const usesWindowsPackagedRunner = process.platform === 'win32' && usesPackagedValidation
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
  usesPackagedValidation || (process.platform === 'win32' && usesHostedRunner)
    ? 180_000
    : usesHostedRunner || usesLinuxHeadlessRunner
      ? 90_000
      : 45_000

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: requiresSerialWorkers ? 1 : 2,
  // Windows packaged runs can spend about two seconds per native Electron interaction, while
  // hosted runners and headless Linux need more time for complete settings and Agent scenarios.
  // Keep local development bounded without making runner speed a functional test failure.
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
