import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXPECTED_FORMATS = Object.freeze({
  'windows-x64': ['NSIS'],
  'macos-arm64': ['DMG', 'ZIP'],
  'macos-x64': ['DMG', 'ZIP'],
  'linux-x64': ['AppImage', 'deb']
})
const REQUIRED_PACKAGED_SMOKE = Object.freeze([
  'native-hybrid',
  'credential-backend',
  'import-started',
  'runtime-inventory',
  'security-boundary',
  'provider-failure-fallback',
  'logging-boundary',
  'diagnostic-export',
  'stale-session',
  'app-database',
  'log-files',
  'fatal-log-flush'
])

export async function verifyReleaseEvidence({ root, output, tag, revision, mode, packageVersion }) {
  if (tag !== `v${packageVersion}`) {
    throw new Error(`Release tag ${tag} does not match package version ${packageVersion}`)
  }
  if (mode !== 'dry-run' && mode !== 'production') throw new Error(`Unknown release mode ${mode}`)
  if (!/^[a-f0-9]{40}$/u.test(revision)) throw new Error('Release revision must be a full Git SHA')

  const evidencePaths = (await recursiveFiles(resolve(root))).filter(
    (path) => basename(path) === 'package-evidence.json'
  )
  const rows = []
  const checksums = []
  const recoveryFixtureHashes = new Set()
  for (const evidencePath of evidencePaths) {
    const evidence = JSON.parse(await readFile(evidencePath, 'utf8'))
    const expectedFormats = EXPECTED_FORMATS[evidence.target]
    if (expectedFormats === undefined) throw new Error(`Unknown evidence target ${evidence.target}`)
    if (evidence.sourceRevision !== revision) {
      throw new Error(
        `${evidence.target} was built from ${evidence.sourceRevision}, expected ${revision}`
      )
    }
    if (evidence.sourceState !== 'clean') {
      throw new Error(`${evidence.target} package evidence was not built from a clean checkout`)
    }
    if (evidence.inventory?.target !== evidence.target) {
      throw new Error(`${evidence.target} inventory target does not match`)
    }
    if (
      evidence.recoveryFixtures?.format !== 'writellm-recovery-fixtures' ||
      evidence.recoveryFixtures.version !== 1 ||
      evidence.recoveryFixtures.cases !== 22 ||
      evidence.recoveryFixtures.sources !== 20 ||
      !Array.isArray(evidence.recoveryFixtures.categories) ||
      evidence.recoveryFixtures.categories.length < 14 ||
      !/^[a-f0-9]{64}$/u.test(evidence.recoveryFixtures.sha256)
    ) {
      throw new Error(`${evidence.target} recovery fixture evidence is invalid`)
    }
    recoveryFixtureHashes.add(evidence.recoveryFixtures.sha256)
    verifyPackagedSmokeEvidence(evidence)
    if (
      evidence.packagedE2e?.format !== 'writellm-packaged-e2e' ||
      evidence.packagedE2e.version !== 2 ||
      evidence.packagedE2e.suite !== 'packaged' ||
      !/^[a-f0-9]{64}$/u.test(evidence.packagedE2e.manifestSha256 ?? '') ||
      !Array.isArray(evidence.packagedE2e.requiredScenarioIds) ||
      evidence.packagedE2e.requiredScenarioIds.length === 0 ||
      !Array.isArray(evidence.packagedE2e.passedScenarioIds) ||
      JSON.stringify(evidence.packagedE2e.requiredScenarioIds) !==
        JSON.stringify(evidence.packagedE2e.passedScenarioIds) ||
      !Array.isArray(evidence.packagedE2e.flakyScenarioIds) ||
      evidence.packagedE2e.flakyScenarioIds.length !== 0 ||
      !Array.isArray(evidence.packagedE2e.skippedScenarioIds) ||
      evidence.packagedE2e.skippedScenarioIds.length !== 0
    ) {
      throw new Error(`${evidence.target} packaged Electron E2E evidence is invalid`)
    }
    const formats = (evidence.artifacts ?? []).map((artifact) => artifact.format).sort()
    if (JSON.stringify(formats) !== JSON.stringify([...expectedFormats].sort())) {
      throw new Error(`${evidence.target} artifact formats are incomplete`)
    }
    if (mode === 'production') verifyProductionSignatureEvidence(evidence)

    const artifacts = []
    for (const artifact of evidence.artifacts) {
      const artifactPath = join(dirname(evidencePath), artifact.file)
      const bytes = await readFile(artifactPath)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      if (sha256 !== artifact.sha256 || bytes.byteLength !== artifact.bytes) {
        throw new Error(`${evidence.target} artifact ${artifact.file} does not match its evidence`)
      }
      checksums.push({ file: artifact.file, sha256 })
      artifacts.push({ ...artifact })
    }
    rows.push({
      target: evidence.target,
      sourceState: evidence.sourceState,
      electron: evidence.electron,
      electronAbi: evidence.electronAbi,
      electronBuilder: evidence.electronBuilder,
      signing: evidence.signing,
      notarization: evidence.notarization,
      recoveryFixtures: evidence.recoveryFixtures,
      inventory: evidence.inventory,
      packagedSmoke: evidence.packagedSmoke,
      packagedE2e: evidence.packagedE2e,
      artifacts
    })
  }

  const expectedTargets = Object.keys(EXPECTED_FORMATS).sort()
  const actualTargets = rows.map((row) => row.target).sort()
  if (JSON.stringify(actualTargets) !== JSON.stringify(expectedTargets)) {
    throw new Error(`Release evidence targets are incomplete: ${actualTargets.join(', ')}`)
  }
  if (recoveryFixtureHashes.size !== 1) {
    throw new Error('Release evidence rows disagree on the recovery fixture manifest')
  }
  const duplicateArtifact = checksums.find(
    (item, index) => checksums.findIndex((candidate) => candidate.file === item.file) !== index
  )
  if (duplicateArtifact !== undefined) {
    throw new Error(`Duplicate release artifact name ${duplicateArtifact.file}`)
  }

  await mkdir(output, { recursive: true })
  const checksumText = checksums
    .sort((left, right) => left.file.localeCompare(right.file))
    .map((item) => `${item.sha256}  ${item.file}`)
    .join('\n')
  const manifest = {
    format: 'writellm-release-evidence',
    version: 1,
    status: mode === 'production' ? 'production' : 'test-only-unsigned',
    tag,
    revision,
    packageVersion,
    rows: rows.sort((left, right) => left.target.localeCompare(right.target))
  }
  await writeFile(join(output, 'SHA256SUMS'), `${checksumText}\n`)
  await writeFile(join(output, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

export function verifyReleaseSource({ tag, revision, requireClean = false }) {
  if (!/^[a-f0-9]{40}$/u.test(revision)) {
    throw new Error('Release revision must be a full Git SHA')
  }
  const packageVersion = JSON.parse(
    requireCommand('git', ['show', `${revision}:package.json`])
  ).version
  if (tag !== `v${packageVersion}`) {
    throw new Error(`Release tag ${tag} does not match package version ${packageVersion}`)
  }
  const taggedRevision = requireCommand('git', ['rev-list', '-n', '1', tag]).trim()
  if (taggedRevision !== revision) {
    throw new Error(`Tag ${tag} resolves to ${taggedRevision}, expected ${revision}`)
  }
  const lockDiff = spawnSync(
    'git',
    ['diff', '--exit-code', revision, '--', 'package.json', 'pnpm-lock.yaml'],
    {
      encoding: 'utf8'
    }
  )
  if (lockDiff.error) throw lockDiff.error
  if (lockDiff.status !== 0) throw new Error('Release package metadata and lockfile are not clean')
  if (requireClean && requireCommand('git', ['status', '--porcelain']).trim() !== '') {
    throw new Error('Release checkout must be clean')
  }
  return packageVersion
}

function verifyPackagedSmokeEvidence(evidence) {
  if (
    evidence.packagedSmoke?.format !== 'writellm-packaged-smoke' ||
    evidence.packagedSmoke.version !== 1 ||
    !Array.isArray(evidence.packagedSmoke.scenarios)
  ) {
    throw new Error(`${evidence.target} packaged smoke evidence is invalid`)
  }
  const required = [
    ...REQUIRED_PACKAGED_SMOKE,
    ...(evidence.target === 'linux-x64' ? ['linux-basic-text-rejection'] : [])
  ]
  for (const scenario of required) {
    if (!evidence.packagedSmoke.scenarios.includes(scenario)) {
      throw new Error(`${evidence.target} packaged smoke evidence is missing ${scenario}`)
    }
  }
}

function verifyProductionSignatureEvidence(evidence) {
  if (evidence.target.startsWith('macos-')) {
    if (!String(evidence.signing).includes('required') || evidence.notarization !== 'verified') {
      throw new Error(`${evidence.target} lacks Developer ID signing or notarization evidence`)
    }
  }
  if (
    evidence.target === 'windows-x64' &&
    (!String(evidence.signing).includes('required') || evidence.authenticode !== 'verified')
  ) {
    throw new Error('windows-x64 lacks Authenticode evidence')
  }
}

async function recursiveFiles(root) {
  const files = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...(await recursiveFiles(path)))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

function requireCommand(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr.trim()}`)
  }
  return result.stdout
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] !== undefined && resolve(process.argv[1]) === currentFile) {
  const values = new Map(
    process.argv
      .slice(2)
      .map((argument) => argument.match(/^--([a-z-]+)=(.+)$/u))
      .filter((match) => match !== null)
      .map((match) => [match[1], match[2]])
  )
  const root = values.get('root')
  const output = values.get('output')
  const tag = values.get('tag')
  const mode = values.get('mode')
  const revision = values.get('revision') ?? process.env.GITHUB_SHA
  if (
    root === undefined ||
    output === undefined ||
    tag === undefined ||
    mode === undefined ||
    revision === undefined
  ) {
    throw new Error(
      'Usage: verify-release-evidence.mjs --root=<dir> --output=<dir> --tag=<tag> ' +
        '--mode=<dry-run|production> --revision=<sha>'
    )
  }
  const packageVersion = verifyReleaseSource({ tag, revision })
  const result = await verifyReleaseEvidence({
    root: resolve(root),
    output: resolve(output),
    tag,
    revision,
    mode,
    packageVersion
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
