import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

const manifestPath = join(process.cwd(), 'e2e', 'scenario-manifest.json')
const manifestBytes = readFileSync(manifestPath)
const manifest = JSON.parse(manifestBytes.toString('utf8')) as ScenarioManifest

export default class EvidenceReporter implements Reporter {
  private selectedScenarioIds: string[] = []
  private readonly results = new Map<string, TestResult[]>()
  private readonly suite = parseSuite(process.env['WRITELLM_E2E_SUITE'])
  private listOnly = false

  onBegin(config: FullConfig, suite: Suite): void {
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

  onEnd(result: FullResult): void {
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
    process.stdout.write(
      `${JSON.stringify({
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
        status: result.status
      })}\n`
    )
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
