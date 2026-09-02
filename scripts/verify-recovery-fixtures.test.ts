import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyRecoveryFixtures } from './verify-recovery-fixtures.mjs'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

describe('recovery fixture verification', () => {
  it('allows source edits but rejects a missing named recovery scenario', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-recovery-fixtures-'))
    temporaryRoots.push(root)
    const manifestPath = join(root, 'fixtures', 'recovery', 'manifest-v1.json')
    const manifest = JSON.parse(
      await readFile(resolve('fixtures/recovery/manifest-v1.json'), 'utf8')
    ) as {
      cases: Array<{ id: string; source: string; tests: string[] }>
    }
    await mkdir(dirname(manifestPath), { recursive: true })
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`)

    const sourcePaths = new Set(manifest.cases.map((fixture) => fixture.source))
    for (const sourcePath of sourcePaths) {
      const destination = join(root, sourcePath)
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, await readFile(resolve(sourcePath)))
    }

    const fixture = manifest.cases.find((candidate) => candidate.id === 'app-schema-history')
    if (fixture === undefined)
      throw new Error('app-schema-history fixture is missing from the test manifest')
    const sourcePath = join(root, fixture.source)
    const originalSource = await readFile(sourcePath, 'utf8')
    await writeFile(sourcePath, `${originalSource}\n// source changed without a manifest digest\n`)

    await expect(
      verifyRecoveryFixtures({ manifestPath, repositoryRoot: root })
    ).resolves.toMatchObject({
      cases: manifest.cases.length,
      sources: sourcePaths.size
    })

    await writeFile(
      sourcePath,
      originalSource.replace(fixture.tests[0], 'renamed recovery scenario')
    )
    await expect(verifyRecoveryFixtures({ manifestPath, repositoryRoot: root })).rejects.toThrow(
      `Recovery fixture test is missing: ${fixture.id} (${fixture.tests[0]})`
    )
  })
})
