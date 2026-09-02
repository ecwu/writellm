import { spawnSync } from 'node:child_process'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectPackageArtifacts, verifyPackageInventory } from './package-inventory.mjs'
import { assertNativePackageHost } from './package-targets.mjs'
import { packageOptions, installerArguments } from './package-plan.mjs'
import { VerificationRun } from './verification-run.mjs'
import { releaseBuilderArguments, resolveReleaseMetadata } from './release-version.mjs'

const require = createRequire(import.meta.url)
const rootPackage = require('../package.json')
const releaseMetadata = resolveReleaseMetadata(rootPackage)
const electronBuilderCli = require.resolve('electron-builder/cli.js')
const packagedSmoke = fileURLToPath(new URL('./run-packaged-hybrid-smoke.mjs', import.meta.url))
const packagedE2e = fileURLToPath(new URL('./run-e2e.mjs', import.meta.url))
const checks = fileURLToPath(new URL('./run-checks.mjs', import.meta.url))
const recoveryFixtureVerification = fileURLToPath(
  new URL('./verify-recovery-fixtures.mjs', import.meta.url)
)
const { target, release, buildOnly, smokeOnly, unpackedOnly, planOnly } = packageOptions(
  process.argv.slice(2)
)
const signedPlatform = target.platform === 'darwin' || target.platform === 'win32'
const outputDirectory = resolve('dist', target.id)
const plan = {
  gate: release ? 'release' : 'package',
  target: target.id,
  host: `${process.platform}-${process.arch}`,
  electron: rootPackage.devDependencies.electron,
  electronAbi: electronProbe('process.versions.modules'),
  electronBuilder: require('electron-builder/package.json').version,
  packageVersion: releaseMetadata.packageVersion,
  releaseVersion: releaseMetadata.releaseVersion,
  buildNumber: releaseMetadata.buildNumber,
  betterSqlite3: rootPackage.dependencies['better-sqlite3'],
  sqliteVec: rootPackage.dependencies['sqlite-vec'],
  outputDirectory: `dist/${target.id}`,
  formats: unpackedOnly ? ['unpacked'] : ['unpacked', ...target.formats],
  publishing: 'disabled; promotion is explicit and external to electron-builder',
  signing: release
    ? signedPlatform
      ? 'required configured platform identity'
      : 'not applicable'
    : 'identity discovery disabled',
  notarization:
    release && target.platform === 'darwin'
      ? 'verified'
      : 'disabled for unsigned or non-macOS artifacts',
  authenticode: release && target.platform === 'win32' ? 'verified' : 'not applicable',
  verificationMode: buildOnly ? 'build-only' : smokeOnly ? 'package-smoke' : 'full-package-gate',
  steps: [
    'frozen target and native-host assertion',
    ...(buildOnly ? [] : ['static verification']),
    ...(!buildOnly && !smokeOnly ? ['recovery scenario inventory'] : []),
    'Electron ABI/native architecture preparation',
    'production build',
    'unpacked package and signature-policy verification',
    'ASAR/resource/native inventory verification',
    ...(buildOnly
      ? []
      : [
          'source-independent packaged runtime smoke',
          ...(smokeOnly ? [] : ['complete Electron E2E against the unpacked packaged executable'])
        ]),
    ...(unpackedOnly ? [] : ['installer/archive creation and structural inspection'])
  ]
}

if (planOnly) {
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
  process.exit(0)
}
assertNativePackageHost(target)
process.stdout.write(`${JSON.stringify(plan)}\n`)
const verification = new VerificationRun(`package-${target.id}-${plan.verificationMode}`)
let failure
try {
  await rm(outputDirectory, { recursive: true, force: true })
  await mkdir(outputDirectory, { recursive: true })
  if (!buildOnly) await verification.command('static', process.execPath, [checks, 'fast'])
  const recoveryFixtures =
    buildOnly || smokeOnly
      ? undefined
      : JSON.parse(
          (
            await verification.command(
              'recovery-inventory',
              process.execPath,
              [recoveryFixtureVerification],
              { capture: true }
            )
          ).trim()
        )
  await verification.command('production-build', process.execPath, [checks, 'build'])

  const packageEnvironment = {
    WRITELLM_RELEASE_VERSION: releaseMetadata.releaseVersion,
    ...(release ? {} : { CSC_IDENTITY_AUTO_DISCOVERY: 'false' })
  }
  const builderBaseArguments = [
    target.builderPlatform,
    target.builderArch,
    '--publish=never',
    `--config.directories.output=${outputDirectory}`,
    ...(target.builderTarget === undefined ? [] : [`--config.win.target=${target.builderTarget}`]),
    ...releaseBuilderArguments(target, releaseMetadata),
    ...(release && target.platform === 'darwin' ? ['--config.mac.notarize=true'] : []),
    ...(release && signedPlatform ? ['--config.forceCodeSigning=true'] : [])
  ]
  await verification.command(
    'package-application',
    process.execPath,
    [electronBuilderCli, '--dir', ...builderBaseArguments],
    { env: packageEnvironment }
  )
  const resources = await resolvePackagedResources(outputDirectory)
  if (target.platform === 'darwin') {
    await verification.stage('signature-policy', () => {
      const app = resolve(resources, '..', '..')
      if (release) verifySignedAndNotarizedMacApp(app)
      else verifyNoIdentityMacSignature(app)
    })
  }
  const unpackedInventory = await verification.stage('package-inventory', () =>
    verifyPackageInventory(resources, target)
  )
  const packagedSmokeEvidence = buildOnly
    ? undefined
    : verifyPackagedSmokeOutput(
        await verification.command(
          'packaged-runtime-smoke',
          process.execPath,
          [packagedSmoke, resources],
          { capture: true }
        ),
        target
      )
  const packagedE2eEvidence =
    buildOnly || smokeOnly
      ? undefined
      : verifyPackagedE2eOutput(
          await verification.command(
            'packaged-e2e',
            process.execPath,
            [packagedE2e, '--suite=packaged'],
            {
              capture: true,
              env: {
                WRITELLM_E2E_EXECUTABLE_PATH: await resolvePackagedExecutable(resources, target)
              }
            }
          )
        )
  let artifacts = []
  if (!unpackedOnly) {
    await verification.command(
      'package-installers',
      process.execPath,
      [electronBuilderCli, ...installerArguments(builderBaseArguments, resources, target)],
      { env: packageEnvironment }
    )
    artifacts = await verification.stage('artifact-checksums', () =>
      inspectPackageArtifacts(outputDirectory, target, releaseMetadata.releaseVersion)
    )
    if (release && target.platform === 'win32') {
      await verification.stage('authenticode', () =>
        verifyWindowsAuthenticode(outputDirectory, artifacts)
      )
    }
  }
  const evidence = {
    ...plan,
    startedAt: verification.startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - verification.started),
    stages: verification.stages,
    sourceRevision: gitRevision(),
    sourceState: gitSourceState(),
    ...(recoveryFixtures === undefined ? {} : { recoveryFixtures }),
    inventory: unpackedInventory,
    ...(packagedSmokeEvidence === undefined ? {} : { packagedSmoke: packagedSmokeEvidence }),
    ...(packagedE2eEvidence === undefined ? {} : { packagedE2e: packagedE2eEvidence }),
    artifacts
  }
  await writeFile(
    join(outputDirectory, 'package-evidence.json'),
    `${JSON.stringify(evidence, null, 2)}\n`
  )
  process.stdout.write(`${JSON.stringify(evidence)}\n`)
} catch (error) {
  failure = error
} finally {
  await verification.finish(failure)
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`${command} exited with status ${result.status ?? result.signal}`)
}

function verifyPackagedSmokeOutput(output, target) {
  const records = output
    .split(/\r?\n/gu)
    .filter((line) => line.startsWith('{"packaged":true'))
    .map((line) => JSON.parse(line))
  const byScenario = new Map(
    records
      .filter((record) => typeof record.scenario === 'string')
      .map((record) => [record.scenario, record])
  )
  const required = [
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
    'fatal-log-flush',
    ...(target.platform === 'linux' ? ['linux-basic-text-rejection'] : [])
  ]
  for (const scenario of required) {
    if (!byScenario.has(scenario)) throw new Error(`Packaged smoke evidence is missing ${scenario}`)
  }
  return {
    format: 'writellm-packaged-smoke',
    version: 1,
    scenarios: required.map((scenario) => scenario)
  }
}

function verifyPackagedE2eOutput(output) {
  const evidence = output
    .split(/\r?\n/gu)
    .filter((line) => line.startsWith('{"e2eEvidence":true'))
    .map((line) => JSON.parse(line))
    .at(-1)
  if (
    evidence?.format !== 'writellm-e2e-evidence' ||
    evidence.version !== 2 ||
    evidence.suite !== 'packaged' ||
    !/^[a-f0-9]{64}$/u.test(evidence.manifestSha256 ?? '') ||
    !Array.isArray(evidence.requiredScenarioIds) ||
    !Array.isArray(evidence.passedScenarioIds) ||
    !Array.isArray(evidence.flakyScenarioIds) ||
    !Array.isArray(evidence.skippedScenarioIds) ||
    !Array.isArray(evidence.failedScenarioIds) ||
    evidence.requiredScenarioIds.length === 0 ||
    JSON.stringify(evidence.requiredScenarioIds) !== JSON.stringify(evidence.passedScenarioIds) ||
    evidence.flakyScenarioIds.length !== 0 ||
    evidence.skippedScenarioIds.length !== 0 ||
    evidence.failedScenarioIds.length !== 0 ||
    evidence.status !== 'passed'
  ) {
    throw new Error('Packaged Electron E2E evidence is incomplete, flaky, skipped, or invalid')
  }
  return {
    format: 'writellm-packaged-e2e',
    version: 2,
    suite: evidence.suite,
    manifestSha256: evidence.manifestSha256,
    requiredScenarioIds: evidence.requiredScenarioIds,
    passedScenarioIds: evidence.passedScenarioIds,
    flakyScenarioIds: evidence.flakyScenarioIds,
    skippedScenarioIds: evidence.skippedScenarioIds
  }
}

async function resolvePackagedResources(root) {
  const matches = []
  await walk(root, 0, matches)
  if (matches.length !== 1) {
    throw new Error(`Expected one unpacked app.asar under ${root}, found ${matches.length}`)
  }
  return dirname(matches[0])
}

async function resolvePackagedExecutable(resources, target) {
  if (target.platform === 'darwin') {
    const directory = join(resources, '..', 'MacOS')
    const entries = await readdir(directory, { withFileTypes: true })
    const executable = entries.find((entry) => entry.isFile() && !entry.name.startsWith('.'))
    if (executable === undefined) {
      throw new Error(`No packaged executable found for ${target.id}`)
    }
    return join(directory, executable.name)
  }
  const executableName = rootPackage.name
  return join(
    resources,
    '..',
    target.platform === 'win32' ? `${executableName}.exe` : executableName
  )
}

async function walk(directory, depth, matches) {
  if (depth > 6) return
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isFile() && entry.name === 'app.asar') matches.push(path)
    else if (entry.isDirectory()) await walk(path, depth + 1, matches)
  }
}

function verifyNoIdentityMacSignature(app) {
  const result = spawnSync('/usr/bin/codesign', ['--display', '--verbose=2', app], {
    encoding: 'utf8'
  })
  if (result.error) throw result.error
  const diagnostics = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (result.status !== 0) {
    if (!diagnostics.includes('code object is not signed at all')) {
      throw new Error(`Unable to inspect the package signature: ${diagnostics.trim()}`)
    }
    process.stdout.write('Verified that the packaged macOS app has no code signature.\n')
    return
  }
  const isAdHoc =
    diagnostics.includes('Signature=adhoc') || /\bflags=.*\badhoc\b/u.test(diagnostics)
  const hasNoTeam = diagnostics.includes('TeamIdentifier=not set')
  if (!isAdHoc || !hasNoTeam) {
    throw new Error('Package gate produced an Apple Team-signed app with discovery disabled.')
  }
  process.stdout.write('Verified a no-Team-ID ad-hoc/linker macOS signature.\n')
}

function verifySignedAndNotarizedMacApp(app) {
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
  run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', app])
  run('/usr/bin/xcrun', ['stapler', 'validate', app])
  process.stdout.write(
    'Verified the packaged macOS app with strict signing and notarization validation.\n'
  )
}

function verifyWindowsAuthenticode(directory, artifacts) {
  for (const artifact of artifacts.filter((candidate) => candidate.format === 'NSIS')) {
    const path = join(directory, artifact.file)
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '& { param([string]$Path) (Get-AuthenticodeSignature -LiteralPath $Path).Status }',
        path
      ],
      { encoding: 'utf8' }
    )
    if (result.error) throw result.error
    if (result.status !== 0 || result.stdout.trim() !== 'Valid') {
      throw new Error(
        `Authenticode verification failed for ${artifact.file}: ${result.stdout.trim()} ${result.stderr.trim()}`
      )
    }
  }
  process.stdout.write('Verified Authenticode signatures for Windows release artifacts.\n')
}

function electronProbe(expression) {
  const result = spawnSync(require('electron'), ['-p', expression], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8'
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Electron probe failed: ${result.stderr}`)
  return result.stdout.trim()
}

function gitRevision() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })
  if (result.error || result.status !== 0) return 'unavailable'
  return result.stdout.trim()
}

function gitSourceState() {
  const result = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
  if (result.error || result.status !== 0) return 'unavailable'
  return result.stdout.trim() === '' ? 'clean' : 'dirty'
}
