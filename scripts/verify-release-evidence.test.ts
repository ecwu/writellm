import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyReleaseEvidence } from './verify-release-evidence.mjs'
import { releaseBuilderArguments, resolveReleaseMetadata } from './release-version.mjs'

const roots: string[] = []
const revision = 'a'.repeat(40)
const formats = {
  'windows-x64': ['NSIS'],
  'macos-arm64': ['DMG', 'ZIP'],
  'macos-x64': ['DMG', 'ZIP'],
  'linux-x64': ['AppImage', 'deb']
}

interface PackageEvidenceFixture {
  sourceState: string
  recoveryFixtures: {
    sha256: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('release evidence verification', () => {
  it('accepts a complete dry-run matrix and writes deterministic checksum evidence', async () => {
    const root = await fixtureRoot()
    const output = join(root, 'output')
    const result = await verifyReleaseEvidence({
      root,
      output,
      tag: 'v0.2026.8.6',
      revision,
      mode: 'dry-run',
      packageVersion: '0.2026.8',
      releaseVersion: '0.2026.8.6'
    })
    expect(result.status).toBe('test-only-unsigned')
    expect(result.rows).toHaveLength(4)
  })

  it('rejects an incomplete matrix and unsigned production evidence', async () => {
    const incomplete = await fixtureRoot(['linux-x64'])
    await expect(
      verifyReleaseEvidence({
        root: incomplete,
        output: join(incomplete, 'output'),
        tag: 'v0.2026.8.6',
        revision,
        mode: 'dry-run',
        packageVersion: '0.2026.8',
        releaseVersion: '0.2026.8.6'
      })
    ).rejects.toThrow('targets are incomplete')

    const unsigned = await fixtureRoot()
    await expect(
      verifyReleaseEvidence({
        root: unsigned,
        output: join(unsigned, 'output'),
        tag: 'v0.2026.8.6',
        revision,
        mode: 'production',
        packageVersion: '0.2026.8',
        releaseVersion: '0.2026.8.6'
      })
    ).rejects.toThrow(/signing|notarization/u)
  })

  it('rejects dirty package provenance and inconsistent recovery fixtures', async () => {
    const dirty = await fixtureRoot()
    await updateEvidence(dirty, 'windows-x64', (evidence) => ({
      ...evidence,
      sourceState: 'dirty'
    }))
    await expect(
      verifyReleaseEvidence({
        root: dirty,
        output: join(dirty, 'output'),
        tag: 'v0.2026.8.6',
        revision,
        mode: 'dry-run',
        packageVersion: '0.2026.8',
        releaseVersion: '0.2026.8.6'
      })
    ).rejects.toThrow('clean checkout')

    const inconsistent = await fixtureRoot()
    await updateEvidence(inconsistent, 'macos-arm64', (evidence) => ({
      ...evidence,
      recoveryFixtures: {
        ...evidence.recoveryFixtures,
        sha256: 'c'.repeat(64)
      }
    }))
    await expect(
      verifyReleaseEvidence({
        root: inconsistent,
        output: join(inconsistent, 'output'),
        tag: 'v0.2026.8.6',
        revision,
        mode: 'dry-run',
        packageVersion: '0.2026.8',
        releaseVersion: '0.2026.8.6'
      })
    ).rejects.toThrow('disagree')
  })

  it('maps the four-component release version to platform-native build metadata', () => {
    const metadata = resolveReleaseMetadata({
      version: '0.2026.8',
      release: { version: '0.2026.8.1' }
    })
    expect(metadata).toEqual({
      packageVersion: '0.2026.8',
      releaseVersion: '0.2026.8.1',
      buildNumber: '1',
      macBuildVersion: '2026.8.1'
    })
    expect(releaseBuilderArguments({ platform: 'darwin' }, metadata)).toEqual([
      '--config.buildVersion=2026.8.1'
    ])
    expect(releaseBuilderArguments({ platform: 'win32' }, metadata)).toEqual([
      '--config.buildVersion=0.2026.8.1'
    ])
    expect(releaseBuilderArguments({ platform: 'linux' }, metadata)).toEqual([
      '--config.buildNumber=1'
    ])
  })

  it('rejects release metadata whose SemVer base does not match', () => {
    expect(() =>
      resolveReleaseMetadata({ version: '1.0.0', release: { version: '0.2026.8.1' } })
    ).toThrow('must match release base')
  })
})

async function updateEvidence(
  root: string,
  target: string,
  update: (evidence: PackageEvidenceFixture) => PackageEvidenceFixture
) {
  const path = join(root, target, 'package-evidence.json')
  const evidence = JSON.parse(await readFile(path, 'utf8')) as PackageEvidenceFixture
  await writeFile(path, JSON.stringify(update(evidence)))
}

async function fixtureRoot(omitted: string[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'writellm-release-evidence-'))
  roots.push(root)
  for (const [target, targetFormats] of Object.entries(formats)) {
    if (omitted.includes(target)) continue
    const directory = join(root, target)
    await mkdir(directory, { recursive: true })
    const artifacts = []
    for (const format of targetFormats) {
      const file = `${target}.${format.toLowerCase()}`
      const bytes = Buffer.from(`${target}:${format}`)
      await writeFile(join(directory, file), bytes)
      artifacts.push({
        format,
        file,
        bytes: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex')
      })
    }
    await writeFile(
      join(directory, 'package-evidence.json'),
      JSON.stringify({
        target,
        packageVersion: '0.2026.8',
        releaseVersion: '0.2026.8.6',
        sourceRevision: revision,
        sourceState: 'clean',
        electron: '43.1.0',
        electronAbi: '148',
        electronBuilder: '26.15.3',
        signing: 'identity discovery disabled',
        notarization: 'disabled',
        recoveryFixtures: {
          format: 'writellm-recovery-fixtures',
          version: 1,
          cases: 22,
          sources: 20,
          categories: Array.from({ length: 14 }, (_, index) => `category-${index}`),
          sha256: 'b'.repeat(64)
        },
        packagedSmoke: {
          format: 'writellm-packaged-smoke',
          version: 1,
          scenarios: [
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
            ...(target === 'linux-x64' ? ['linux-basic-text-rejection'] : [])
          ]
        },
        packagedE2e: {
          format: 'writellm-packaged-e2e',
          version: 2,
          suite: 'packaged',
          manifestSha256: 'd'.repeat(64),
          requiredScenarioIds: ['project.lifecycle-restart'],
          passedScenarioIds: ['project.lifecycle-restart'],
          flakyScenarioIds: [],
          skippedScenarioIds: []
        },
        inventory: { target },
        artifacts
      })
    )
  }
  return root
}
