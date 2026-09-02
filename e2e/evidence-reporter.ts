import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult
} from '@playwright/test/reporter'

interface ScenarioManifest {
  format: 'writellm-e2e-scenarios'
  version: 1
  scenarios: Array<{
    id: string
    tiers: Array<'critical' | 'packaged'>
  }>
}

type EvidenceSuite = 'critical' | 'focused' | 'full' | 'packaged'

interface AttemptEvidence {
  attempt: number
  retry: number
  status: TestResult['status']
  durationMs: number
  startedAt: string | null
  workerIndex: number
  parallelIndex: number
}

interface ScenarioEvidence {
  id: string
  status: TestResult['status'] | 'missing'
  attemptCount: number
  retryCount: number
  attempts: AttemptEvidence[]
}

const manifestPath = join(process.cwd(), 'e2e', 'scenario-manifest.json')
const manifestBytes = readFileSync(manifestPath)
const manifest = JSON.parse(manifestBytes.toString('utf8')) as ScenarioManifest

export default class EvidenceReporter implements Reporter {
  private selectedScenarioIds: string[] = []
  private readonly results = new Map<string, TestResult[]>()
  private readonly suite = parseSuite(process.env['WRITELLM_E2E_SUITE'])
  private readonly reportId = `${Date.now()}-${process.pid}-${randomUUID().slice(0, 8)}`
  private readonly reportDirectory = reportDirectoryFor(this.reportId)
  private readonly reportFileName = process.env['WRITELLM_VERIFICATION_DIRECTORY']
    ? `e2e-${this.reportId}.json`
    : 'e2e.json'
  private startedAt = new Date()
  private startedMonotonic = performance.now()
  private listOnly = false

  onBegin(config: FullConfig, suite: Suite): void {
    this.startedAt = new Date()
    this.startedMonotonic = performance.now()
    this.listOnly = config.argv.includes('--list')
    validateManifest(manifest)
    const tests = suite.allTests()
    const actual = tests.map((test) => scenarioId(test))
    if (new Set(actual).size !== actual.length) {
      throw new Error('Electron E2E scenario IDs must be unique in every selected run')
    }
    this.selectedScenarioIds = [...actual].sort()

    for (const test of tests) validateScenarioTags(test, manifest)
    if (this.suite !== 'focused') {
      const expected = manifest.scenarios
        .filter((entry) => this.suite === 'full' || entry.tiers.includes(this.suite))
        .map((entry) => entry.id)
        .sort()
      if (JSON.stringify(expected) !== JSON.stringify(this.selectedScenarioIds)) {
        throw new Error(
          `Electron E2E ${this.suite} selection does not match the scenario manifest: expected ${JSON.stringify(expected)}, received ${JSON.stringify(this.selectedScenarioIds)}`
        )
      }
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const id = scenarioId(test)
    const results = this.results.get(id) ?? []
    results.push(result)
    this.results.set(id, results)
  }

  async onEnd(result: FullResult): Promise<void> {
    if (this.listOnly) return
    const passed: string[] = []
    const flaky: string[] = []
    const skipped: string[] = []
    const failed: string[] = []
    for (const id of this.selectedScenarioIds) {
      const attempts = this.results.get(id) ?? []
      const final = attempts.at(-1)
      if (final?.status === 'passed') {
        passed.push(id)
        if (attempts.length > 1 || attempts.some((attempt) => attempt.status !== 'passed')) {
          flaky.push(id)
        }
      } else if (final?.status === 'skipped') skipped.push(id)
      else failed.push(id)
    }
    const scenarios = this.selectedScenarioIds.map((id) => scenarioEvidence(id, this.results))
    const attempts = scenarios.reduce((count, scenario) => count + scenario.attemptCount, 0)
    const retries = scenarios.reduce((count, scenario) => count + scenario.retryCount, 0)
    const evidence = {
      e2eEvidence: true,
      format: 'writellm-e2e-evidence',
      version: 2,
      suite: this.suite,
      manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
      requiredScenarioIds: this.selectedScenarioIds,
      passedScenarioIds: passed,
      flakyScenarioIds: flaky,
      skippedScenarioIds: skipped,
      failedScenarioIds: failed,
      status: result.status,
      startedAt: timestamp(result.startTime) ?? this.startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Math.max(0, Math.round(result.duration)),
      wallTimeMs: Math.max(0, Math.round(performance.now() - this.startedMonotonic)),
      counts: {
        scenarios: scenarios.length,
        attempts,
        retries,
        passed: passed.length,
        flaky: flaky.length,
        skipped: skipped.length,
        failed: failed.length
      },
      scenarios
    }
    process.stdout.write(`${JSON.stringify(evidence)}\n`)
    await this.writeReport(evidence)
  }

  private async writeReport(evidence: object): Promise<void> {
    try {
      await mkdir(this.reportDirectory, { recursive: true })
      await writeFile(
        join(this.reportDirectory, this.reportFileName),
        `${JSON.stringify(evidence, null, 2)}\n`
      )
    } catch (error) {
      const code =
        error !== null && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : 'unknown'
      process.stderr.write(`[writellm-e2e-evidence] report write failed (${code})\n`)
      throw error
    }
  }
}

function reportDirectoryFor(reportId: string): string {
  const configured = process.env['WRITELLM_VERIFICATION_DIRECTORY']
  return configured === undefined || configured === ''
    ? resolve('.cache', 'verification', reportId)
    : resolve(configured)
}

function timestamp(value: Date | undefined): string | null {
  return value === undefined ? null : value.toISOString()
}

function scenarioEvidence(id: string, results: Map<string, TestResult[]>): ScenarioEvidence {
  const attempts = (results.get(id) ?? []).map((result, attempt) => ({
    attempt,
    retry: result.retry,
    status: result.status,
    durationMs: Math.max(0, Math.round(result.duration)),
    startedAt: timestamp(result.startTime),
    workerIndex: result.workerIndex,
    parallelIndex: result.parallelIndex
  }))
  const final = attempts.at(-1)
  return {
    id,
    status: final?.status ?? 'missing',
    attemptCount: attempts.length,
    retryCount: attempts.filter((attempt) => attempt.retry > 0).length,
    attempts
  }
}

function parseSuite(value: string | undefined): EvidenceSuite {
  if (value === undefined) return 'full'
  if (value === 'critical' || value === 'focused' || value === 'full' || value === 'packaged') {
    return value
  }
  throw new Error(`Unknown WRITELLM_E2E_SUITE ${JSON.stringify(value)}`)
}

function scenarioId(test: TestCase): string {
  const scenarios = test.annotations
    .filter((annotation) => annotation.type === 'scenario')
    .map((annotation) => annotation.description)
  if (scenarios.length !== 1 || scenarios[0] === undefined) {
    throw new Error(`Electron E2E test ${test.title} must declare exactly one scenario annotation`)
  }
  return scenarios[0]
}

function validateManifest(value: ScenarioManifest): void {
  if (
    value.format !== 'writellm-e2e-scenarios' ||
    value.version !== 1 ||
    !Array.isArray(value.scenarios)
  ) {
    throw new Error('Electron E2E scenario manifest header is invalid')
  }
  const ids = new Set<string>()
  for (const scenario of value.scenarios) {
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u.test(scenario.id)) {
      throw new Error(`Invalid Electron E2E scenario ID ${JSON.stringify(scenario.id)}`)
    }
    if (ids.has(scenario.id)) throw new Error(`Duplicate Electron E2E scenario ${scenario.id}`)
    ids.add(scenario.id)
    if (
      !Array.isArray(scenario.tiers) ||
      scenario.tiers.some((tier) => tier !== 'critical' && tier !== 'packaged') ||
      new Set(scenario.tiers).size !== scenario.tiers.length
    ) {
      throw new Error(`Invalid Electron E2E tiers for ${scenario.id}`)
    }
  }
}

function validateScenarioTags(test: TestCase, value: ScenarioManifest): void {
  const id = scenarioId(test)
  const declared = value.scenarios.find((entry) => entry.id === id)
  if (declared === undefined) throw new Error(`Electron E2E scenario ${id} is not in the manifest`)
  const expected = declared.tiers.map((tier) => `@${tier}`).sort()
  const actual = test.tags.filter((tag) => tag === '@critical' || tag === '@packaged').sort()
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(
      `Electron E2E scenario ${id} tags do not match the manifest: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
    )
  }
}
