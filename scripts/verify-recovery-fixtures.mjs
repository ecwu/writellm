import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

const manifestPath = resolve('fixtures/recovery/manifest-v1.json')
const manifestText = await readFile(manifestPath, 'utf8')
const manifest = JSON.parse(manifestText)
if (
  manifest.format !== 'writellm-recovery-fixtures' ||
  manifest.version !== 1 ||
  manifest.syntheticOnly !== true ||
  !Array.isArray(manifest.cases)
) {
  throw new Error('Recovery fixture manifest header is invalid')
}

const requiredCategories = [
  'migration',
  'database-backup',
  'snapshot',
  'history',
  'lock',
  'session',
  'path',
  'materialization',
  'index',
  'knowledge',
  'export',
  'agent',
  'security',
  'logging'
]
const requiredIds = [
  'agent-interruption-review-and-capability',
  'agent-proposal-refresh-and-lineage',
  'app-schema-history',
  'asset-backed-manuscript-export',
  'centralized-worker-logging',
  'credential-backend-reporting',
  'fatal-log-flush',
  'interrupted-history-restore',
  'ipc-sender-and-navigation-denial',
  'log-redaction-and-error-cause',
  'log-retention',
  'log-rotation',
  'mineru-normalization-interruption',
  'missing-and-incompatible-index',
  'missing-materializations',
  'moved-unicode-and-case-collision-roots',
  'project-schema-history',
  'shutdown-log-flush',
  'snapshot-v1-v2-history',
  'stale-and-live-locks',
  'stale-project-sessions',
  'wal-online-backup-and-restore'
]
const seenIds = new Set()
const seenCategories = new Set()
const sourceDigests = new Map()
const repositoryRoot = resolve('.')
for (const fixture of manifest.cases) {
  if (
    fixture === null ||
    typeof fixture !== 'object' ||
    typeof fixture.id !== 'string' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(fixture.id) ||
    typeof fixture.category !== 'string' ||
    typeof fixture.source !== 'string' ||
    typeof fixture.sourceSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(fixture.sourceSha256) ||
    !Array.isArray(fixture.tests) ||
    fixture.tests.length === 0 ||
    fixture.tests.some((testName) => typeof testName !== 'string' || testName.length === 0)
  ) {
    throw new Error('Recovery fixture entry is malformed')
  }
  if (seenIds.has(fixture.id)) throw new Error(`Duplicate recovery fixture ${fixture.id}`)
  seenIds.add(fixture.id)
  seenCategories.add(fixture.category)
  const source = resolve(fixture.source)
  const relativeSource = relative(repositoryRoot, source)
  if (
    relativeSource === '..' ||
    relativeSource.startsWith(`..${sep}`) ||
    isAbsolute(relativeSource)
  )
    throw new Error(`Fixture source escapes: ${fixture.id}`)
  await access(source)
  const sourceText = await readFile(source, 'utf8')
  const sourceSha256 = createHash('sha256').update(sourceText).digest('hex')
  if (sourceSha256 !== fixture.sourceSha256) {
    throw new Error(
      `Recovery fixture source changed without a manifest update: ${fixture.id} (${fixture.source})`
    )
  }
  sourceDigests.set(fixture.source, sourceSha256)
  for (const testName of new Set(fixture.tests)) {
    if (!sourceText.includes(testName)) {
      throw new Error(`Recovery fixture test is missing: ${fixture.id} (${testName})`)
    }
  }
}
for (const category of requiredCategories) {
  if (!seenCategories.has(category))
    throw new Error(`Recovery fixture category is missing: ${category}`)
}
for (const fixtureId of requiredIds) {
  if (!seenIds.has(fixtureId)) throw new Error(`Recovery fixture is missing: ${fixtureId}`)
}

const forbidden = [
  /\/Users\//u,
  /[A-Za-z]:\\Users\\/u,
  /\bapi[_-]?key\b/iu,
  /\bauthorization\b/iu,
  /\bsigned[_-]?url\b/iu,
  /[?&](?:signature|token|credential)=/iu
]
for (const pattern of forbidden) {
  if (pattern.test(manifestText))
    throw new Error(`Recovery fixtures contain forbidden data: ${pattern}`)
}

process.stdout.write(
  `${JSON.stringify({
    format: manifest.format,
    version: manifest.version,
    cases: manifest.cases.length,
    categories: [...seenCategories].sort(),
    sources: sourceDigests.size,
    sha256: createHash('sha256').update(manifestText).digest('hex')
  })}\n`
)
