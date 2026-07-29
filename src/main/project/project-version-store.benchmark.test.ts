import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, it } from 'vitest'
import { createProjectManifest, writeProjectManifest } from './project-manifest'
import {
  PROJECT_DATABASE_RELATIVE_PATH,
  PROJECT_HISTORY_RELATIVE_PATH,
  resolveProjectPath
} from './project-paths'
import {
  PROJECT_SNAPSHOT_FORMAT,
  PROJECT_SNAPSHOT_FORMAT_VERSION,
  PROJECT_SNAPSHOT_MANIFEST_FILE
} from './project-snapshot'
import { IsomorphicGitProjectVersionStore } from './project-version-store'

const enabled = process.env['WRITELLM_HISTORY_BENCHMARK'] === '1'
const roots: string[] = []

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
})

async function directoryBytes(root: string): Promise<number> {
  let bytes = 0
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    bytes += entry.isDirectory() ? await directoryBytes(path) : (await stat(path)).size
  }
  return bytes
}

describe.runIf(enabled)('project version history benchmark', () => {
  it('records 10/50/100 checkpoint latency and repository growth', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'writellm-history-benchmark-'))
    roots.push(parent)
    const projectRoot = join(parent, 'benchmark.writellm')
    await mkdir(resolveProjectPath(projectRoot, '.writellm'), { recursive: true })
    const manifest = createProjectManifest()
    await writeProjectManifest(projectRoot, manifest)
    const store = new IsomorphicGitProjectVersionStore({
      projectRoot,
      projectId: manifest.projectId,
      applicationVersion: 'benchmark',
      log: { info: () => undefined, warn: () => undefined, error: () => undefined }
    })
    const invariantKnowledge = Buffer.alloc(1_024 * 1_024, 0x61)
    const startedAt = performance.now()
    for (let checkpoint = 1; checkpoint <= 100; checkpoint += 1) {
      const snapshotRoot = join(parent, `snapshot-${randomUUID()}`)
      await mkdir(resolveProjectPath(snapshotRoot, '.writellm'), { recursive: true })
      await mkdir(resolveProjectPath(snapshotRoot, 'knowledge/originals'), { recursive: true })
      await writeProjectManifest(snapshotRoot, manifest)
      const database = Buffer.alloc(checkpoint * 1_024, checkpoint % 255)
      await writeFile(resolveProjectPath(snapshotRoot, PROJECT_DATABASE_RELATIVE_PATH), database)
      await writeFile(
        resolveProjectPath(snapshotRoot, 'knowledge/originals/large.bin'),
        invariantKnowledge
      )
      await writeFile(
        join(snapshotRoot, PROJECT_SNAPSHOT_MANIFEST_FILE),
        `${JSON.stringify({
          snapshotFormat: PROJECT_SNAPSHOT_FORMAT,
          snapshotFormatVersion: PROJECT_SNAPSHOT_FORMAT_VERSION,
          projectId: manifest.projectId,
          projectFormatVersion: manifest.formatVersion,
          projectDatabaseSchemaVersion: 22,
          schemaMigrationsSha256: 'a'.repeat(64),
          createdAt: new Date().toISOString(),
          sourceAppVersion: 'benchmark',
          indexIncluded: false,
          indexRebuildRequired: true,
          database: {
            path: PROJECT_DATABASE_RELATIVE_PATH,
            sha256: checkpoint.toString(16).padStart(64, '0'),
            size: database.length
          },
          files: [
            {
              relativePath: 'knowledge/originals/large.bin',
              role: 'knowledge',
              sha256: 'b'.repeat(64),
              size: invariantKnowledge.length
            }
          ],
          versionHistory: { included: false, files: [] }
        })}\n`
      )
      if (checkpoint === 1) await store.enable(snapshotRoot)
      else await store.createCheckpoint(snapshotRoot, { name: `Checkpoint ${checkpoint}` })
      await rm(snapshotRoot, { recursive: true, force: true })
      if (checkpoint === 10 || checkpoint === 50 || checkpoint === 100) {
        process.stdout.write(
          `${JSON.stringify({
            checkpointCount: checkpoint,
            elapsedMs: Math.round(performance.now() - startedAt),
            repositoryBytes: await directoryBytes(
              resolveProjectPath(projectRoot, PROJECT_HISTORY_RELATIVE_PATH)
            )
          })}\n`
        )
      }
    }
  }, 120_000)
})
