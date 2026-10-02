import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { resolveE2eSettings, resolveVitestTestTimeout } from './test-timeouts.mjs'

describe('test reporting and timeout policy', () => {
  it('preserves hosted, packaged, headless and interactive policies', () => {
    expect(resolveE2eSettings({ env: {}, platform: 'darwin' })).toMatchObject({
      workers: 2,
      testTimeoutMs: 45_000,
      expectTimeoutMs: 10_000,
      retries: 0,
      failOnFlakyTests: false
    })
    expect(resolveE2eSettings({ env: { CI: 'true' }, platform: 'darwin' })).toMatchObject({
      workers: 2,
      testTimeoutMs: 90_000,
      retries: 1,
      failOnFlakyTests: true
    })
    expect(resolveE2eSettings({ env: { CI: 'true' }, platform: 'win32' }).testTimeoutMs).toBe(
      180_000
    )
    expect(
      resolveE2eSettings({ env: { WRITELLM_E2E_SUITE: 'packaged' }, platform: 'win32' })
    ).toMatchObject({ workers: 1, testTimeoutMs: 180_000, retries: 0 })
    expect(
      resolveE2eSettings({ env: { WRITELLM_E2E_WINDOW_MODE: 'silent' }, platform: 'linux' })
    ).toMatchObject({ workers: 1, testTimeoutMs: 90_000 })
    expect(
      resolveE2eSettings({ env: { WRITELLM_E2E_WINDOW_MODE: 'interactive' }, platform: 'darwin' })
        .workers
    ).toBe(1)
    expect(resolveVitestTestTimeout({ env: {}, platform: 'darwin' })).toBe(5_000)
    expect(resolveVitestTestTimeout({ env: { CI: 'true' }, platform: 'win32' })).toBe(30_000)
  })

  it('records real retry attempts and skips through the canonical Electron runner', async () => {
    await mkdir('.cache', { recursive: true })
    const directory = await mkdtemp(resolve('.cache', 'reporter-fixture-'))
    const reports = join(directory, 'reports')
    const fixture = join(directory, 'retry.test.mjs')
    const config = join(directory, 'vitest.config.mjs')
    try {
      await writeFile(
        fixture,
        `import { it, expect } from 'vitest';
let attempts = 0;
it('retries once', { retry: 1 }, () => expect(++attempts).toBe(2));
it('exhausts two retries', { retry: 2 }, () => expect(false).toBe(true));
it('fails without retry', () => expect(false).toBe(true));
it.skip('not executed', () => {});
`
      )
      await writeFile(
        config,
        `export default { test: { include: [${JSON.stringify(fixture)}], exclude: [] } }\n`
      )
      await expect(
        promisify(execFile)('node', ['scripts/run-tests.mjs', fixture, '--config', config], {
          env: { ...process.env, WRITELLM_VERIFICATION_DIRECTORY: reports },
          maxBuffer: 1024 * 1024
        })
      ).rejects.toMatchObject({ code: 1 })
      const reportFile = (await readdir(reports)).find((file) => file.startsWith('vitest-'))
      expect(reportFile).toBeDefined()
      const report = JSON.parse(await readFile(join(reports, reportFile as string), 'utf8'))
      expect(report.counts).toMatchObject({
        tests: 4,
        attempts: 6,
        retries: 3,
        passed: 1,
        failed: 2,
        flaky: 1,
        skipped: 1
      })
      const retried = report.tests.find((test) => test.name === 'retries once')
      expect(retried.attempts).toHaveLength(2)
      expect(retried.attempts.map((attempt) => attempt.retry)).toEqual([0, 1])
      expect(retried.attempts.every((attempt) => attempt.timing === 'estimated')).toBe(true)
      const exhausted = report.tests.find((test) => test.name === 'exhausts two retries')
      expect(exhausted.attempts.map((attempt) => attempt.retry)).toEqual([0, 1, 2])
      expect(exhausted.attemptCount).toBe(exhausted.retryCount + 1)
      expect(report.tests.find((test) => test.name === 'fails without retry').attemptCount).toBe(1)
      expect(report.tests.find((test) => test.state === 'skipped').attempts).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
