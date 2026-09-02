import { defineConfig } from '@playwright/test'
import { resolveE2eSettings } from './scripts/test-timeouts.mjs'

const e2eSettings = resolveE2eSettings()

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: e2eSettings.workers,
  timeout: e2eSettings.testTimeoutMs,
  expect: { timeout: e2eSettings.expectTimeoutMs },
  forbidOnly: Boolean(process.env['CI']),
  retries: e2eSettings.retries,
  failOnFlakyTests: e2eSettings.failOnFlakyTests,
  reporter: [['list'], ['./e2e/evidence-reporter.ts']],
  use: {
    trace: process.env['CI'] ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  }
})
