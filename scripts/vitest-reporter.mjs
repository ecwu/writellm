import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

const reportPrefix = 'vitest'

export default class VerificationReporter {
  constructor() {
    this.root = process.cwd()
    this.resetRun()
  }

  onInit(vitest) {
    this.root = vitest.config.root
  }

  onTestRunStart() {
    this.resetRun()
  }

  onTestCaseReady(testCase) {
    if (!this.activeAttempts.has(testCase.id)) {
      this.activeAttempts.set(testCase.id, {
        currentRetry: 0,
        currentStartedAt: new Date(),
        currentStartedMonotonic: performance.now(),
        attempts: []
      })
    }
  }

  onTaskUpdate(packs, events) {
    const now = performance.now()
    const wallNow = new Date()
    const results = new Map(packs.map(([id, result]) => [id, result]))
    for (const [id, event] of events) {
      if (event === 'test-prepare' && !this.activeAttempts.has(id)) {
        const startTime = results.get(id)?.startTime
        this.activeAttempts.set(id, {
          currentRetry: 0,
          currentStartedAt: finiteDate(startTime) ?? wallNow,
          currentStartedMonotonic: now,
          attempts: []
        })
        continue
      }
      if (event !== 'test-retried') continue
      const active = this.activeAttempts.get(id)
      if (active === undefined) continue
      // Vitest exposes only the aggregate duration on the final TestCase. The
      // retry event has no per-attempt duration and updates are throttled, so
      // event spans are useful diagnostics but must remain explicitly marked
      // as estimates.
      active.attempts.push({
        retry: active.currentRetry,
        durationMs: durationMs(now - active.currentStartedMonotonic),
        startedAt: active.currentStartedAt.toISOString(),
        timing: 'estimated'
      })
      active.currentRetry += 1
      active.currentStartedAt = wallNow
      active.currentStartedMonotonic = now
    }
  }

  recordTestCaseResult(testCase) {
    const result = testCase.result()
    const diagnostic = testCase.diagnostic()
    const active = this.activeAttempts.get(testCase.id)
    const totalDurationMs = durationMs(diagnostic?.duration ?? 0)
    const attempts = active?.attempts ?? []
    const wasNotExecuted =
      (result.state === 'skipped' || result.state === 'pending') &&
      diagnostic?.startTime === undefined
    if (wasNotExecuted) {
      attempts.length = 0
      this.activeAttempts.delete(testCase.id)
    } else if (active !== undefined) {
      const previousDurationMs = attempts.reduce((total, attempt) => total + attempt.durationMs, 0)
      attempts.push({
        retry: active.currentRetry,
        durationMs: Math.max(0, totalDurationMs - previousDurationMs),
        startedAt: attemptStart(active, diagnostic?.startTime),
        timing: active.currentRetry === 0 ? 'measured' : 'estimated'
      })
      this.activeAttempts.delete(testCase.id)
    } else {
      attempts.push({
        retry: 0,
        durationMs: totalDurationMs,
        startedAt: diagnosticStart(diagnostic?.startTime),
        timing: (diagnostic?.retryCount ?? 0) === 0 ? 'measured' : 'estimated'
      })
    }
    this.tests.set(testCase.id, {
      id: testCase.id,
      name: testCase.fullName,
      file: relativeModuleId(this.root, testCase.module.moduleId),
      state: result.state,
      durationMs: totalDurationMs,
      startedAt: diagnosticStart(diagnostic?.startTime),
      retryCount: diagnostic?.retryCount ?? 0,
      repeatCount: diagnostic?.repeatCount ?? 0,
      flaky: diagnostic?.flaky ?? false,
      attemptCount: attempts.length,
      attempts
    })
  }

  async onTestRunEnd(testModules, unhandledErrors, reason) {
    for (const testModule of testModules) {
      for (const testCase of testModule.children.allTests()) {
        // Vitest dispatches modern test-result hooks before the corresponding
        // legacy task-update batch, which contains retry events. Finalize only
        // after those batches have all arrived.
        this.recordTestCaseResult(testCase)
      }
    }
    const tests = [...this.tests.values()].sort((left, right) => left.id.localeCompare(right.id))
    const files = testModules
      .map((testModule) => ({
        file: relativeModuleId(this.root, testModule.moduleId),
        durationMs: durationMs(testModule.diagnostic().duration),
        testCount: [...testModule.children.allTests()].length
      }))
      .sort((left, right) => left.file.localeCompare(right.file))
    const counts = {
      tests: tests.length,
      attempts: tests.reduce((total, test) => total + test.attemptCount, 0),
      retries: tests.reduce((total, test) => total + test.retryCount, 0),
      passed: tests.filter((test) => test.state === 'passed').length,
      failed: tests.filter((test) => test.state === 'failed').length,
      skipped: tests.filter((test) => test.state === 'skipped').length,
      pending: tests.filter((test) => test.state === 'pending').length,
      flaky: tests.filter((test) => test.flaky).length
    }
    const wallTimeMs = durationMs(performance.now() - this.startedMonotonic)
    const report = {
      format: 'writellm-vitest-report',
      version: 1,
      reason,
      startedAt: this.startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: wallTimeMs,
      wallTimeMs,
      unhandledErrorCount: unhandledErrors.length,
      counts,
      files,
      tests
    }
    await this.writeReport(report)
  }

  resetRun() {
    this.runId = `${Date.now()}-${process.pid}-${randomUUID().slice(0, 8)}`
    const configured = process.env['WRITELLM_VERIFICATION_DIRECTORY']
    this.reportDirectory =
      configured === undefined || configured === ''
        ? resolve('.cache', 'verification', this.runId)
        : resolve(configured)
    this.reportFileName =
      configured === undefined || configured === ''
        ? `${reportPrefix}.json`
        : `${reportPrefix}-${this.runId}.json`
    this.startedAt = new Date()
    this.startedMonotonic = performance.now()
    this.activeAttempts = new Map()
    this.tests = new Map()
  }

  async writeReport(report) {
    try {
      await mkdir(this.reportDirectory, { recursive: true })
      await writeFile(
        resolve(this.reportDirectory, this.reportFileName),
        `${JSON.stringify(report, null, 2)}\n`
      )
    } catch (error) {
      const code =
        error !== null && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : 'unknown'
      process.stderr.write(`[writellm-vitest] report write failed (${code})\n`)
      throw error
    }
  }
}

function durationMs(value) {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0))
}

function diagnosticStart(startTime) {
  return Number.isFinite(startTime) && startTime > 0 ? new Date(startTime).toISOString() : null
}

function finiteDate(startTime) {
  return Number.isFinite(startTime) && startTime > 0 ? new Date(startTime) : null
}

function attemptStart(active, diagnosticStartTime) {
  if (active.currentRetry === 0) return diagnosticStart(diagnosticStartTime)
  return active.currentStartedAt.toISOString()
}

function relativeModuleId(root, moduleId) {
  const normalized = String(moduleId).replaceAll('\\', '/')
  const rootPath = resolve(root).replaceAll('\\', '/')
  if (normalized.startsWith(`${rootPath}/`)) return normalized.slice(rootPath.length + 1)
  if (normalized.startsWith('/')) return basename(normalized)
  return normalized
}
