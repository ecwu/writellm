import { defineConfig } from '@playwright/test'

const requiresSerialWorkers =
  process.env['WRITELLM_E2E_WINDOW_MODE'] === 'interactive' ||
  (process.platform === 'linux' && Boolean(process.env['CI']))

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: requiresSerialWorkers ? 1 : 2,
  timeout: 45_000,
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
