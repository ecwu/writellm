import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { createProject } from './project-lifecycle'
import { openProjectDatabase } from './project-database'
import {
  createProjectSnapshot,
  parseProjectSnapshotManifest,
  restoreProjectDatabase,
  restoreProjectSnapshot
} from './project-snapshot'
import { resolveProjectPath } from './project-paths'
import Database from 'better-sqlite3'

const directories: string[] = []
const log = pino({ level: 'silent' })

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('project snapshots', () => {
  it('publishes a consistent snapshot and restores it without an index', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'writellm-snapshot-'))
    directories.push(parent)
    const created = await createProject({
      destination: join(parent, '项目 with spaces.writellm'),
      forbiddenApplicationDirectories: [],
      applicationVersion: '1.0.0-test',
      initialTitle: 'Snapshot fixture',
      log
    })
    await created.writeLock.release()
    const sourceFile = 'manuscript/sections/fixture.blocknote.json'
    const sourcePath = resolveProjectPath(created.projectRoot, sourceFile)
    const sourceBody = '{"type":"doc","blocks":[]}'
    await writeFile(sourcePath, sourceBody, 'utf8')
    const sourceBytes = Buffer.from(sourceBody)
    const sourceHash = createHash('sha256').update(sourceBytes).digest('hex')
    const database = await openProjectDatabase({
      projectRoot: created.projectRoot,
      manifest: created.manifest,
      applicationVersion: '1.0.0-test',
      log
    })
    const events: string[] = []
    const snapshotRoot = join(parent, 'snapshot-output')
    const snapshot = await createProjectSnapshot({
      sourceRoot: created.projectRoot,
      manifest: created.manifest,
      sourceDatabase: database,
      destination: snapshotRoot,
      sourceAppVersion: '1.0.0-test',
      inventoryFromBackup: () => [
        {
          relativePath: sourceFile,
          role: 'manuscript-materialization',
          sha256: sourceHash,
          size: sourceBytes.byteLength
        }
      ],
      barrier: {
        pauseMutations: async () => {
          events.push('pause-mutations')
        },
        finalEditorFlush: async () => {
          events.push('flush')
        },
        pauseFilePublishers: async () => {
          events.push('pause-publishers')
        },
        resumeFilePublishers: async () => {
          events.push('resume-publishers')
        },
        resumeMutations: async () => {
          events.push('resume-mutations')
        }
      },
      log
    })
    database.close()

    expect(snapshot.projectId).toBe(created.manifest.projectId)
    expect(snapshot.indexIncluded).toBe(false)
    expect(snapshot.indexRebuildRequired).toBe(true)
    expect(events).toEqual([
      'pause-mutations',
      'flush',
      'pause-publishers',
      'resume-publishers',
      'resume-mutations'
    ])
    await expect(readFile(join(snapshotRoot, '.writellm', 'index.sqlite'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    expect(await readFile(join(snapshotRoot, sourceFile), 'utf8')).toBe(sourceBody)

    const restoredRoot = join(parent, '恢复后的项目.writellm')
    const restored = await restoreProjectSnapshot({
      snapshotRoot,
      destination: restoredRoot,
      log
    })
    expect(restored).toEqual({
      projectId: created.manifest.projectId,
      destination: restoredRoot,
      indexRebuildRequired: true
    })
    const restoredDatabase = await openProjectDatabase({
      projectRoot: restoredRoot,
      manifest: created.manifest,
      applicationVersion: '1.0.0-test',
      log
    })
    restoredDatabase.close()
  })

  it('restores a database only after a verified pre-restore backup', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'writellm-database-restore-'))
    directories.push(parent)
    const created = await createProject({
      destination: join(parent, 'restore.writellm'),
      forbiddenApplicationDirectories: [],
      applicationVersion: '1.0.0-test',
      log
    })
    await created.writeLock.release()
    const databasePath = resolveProjectPath(created.projectRoot, '.writellm/project.sqlite')
    const candidatePath = join(parent, 'candidate.sqlite')
    const source = new Database(databasePath)
    await source.backup(candidatePath)
    source.prepare("UPDATE project_meta SET updated_at = 'changed'").run()
    source.close()
    const result = await restoreProjectDatabase({
      projectRoot: created.projectRoot,
      candidateDatabase: candidatePath,
      projectId: created.manifest.projectId,
      log
    })
    const preRestore = await readFile(result.preRestoreBackup)
    expect(preRestore.length).toBeGreaterThan(0)
    const restored = new Database(databasePath, { readonly: true, fileMustExist: true })
    expect(restored.prepare('SELECT updated_at FROM project_meta').pluck().get()).not.toBe(
      'changed'
    )
    restored.close()
  })

  it('rejects traversal and case-colliding snapshot inventory paths', () => {
    const base = {
      snapshotFormat: 'writellm-project-snapshot',
      snapshotFormatVersion: 1,
      projectId: '11111111-1111-4111-8111-111111111111',
      projectFormatVersion: 1,
      projectDatabaseSchemaVersion: 2,
      schemaMigrationsSha256: 'a'.repeat(64),
      createdAt: '2026-07-15T00:00:00.000Z',
      sourceAppVersion: 'test',
      indexIncluded: false,
      indexRebuildRequired: true,
      database: { path: '.writellm/project.sqlite', sha256: 'b'.repeat(64), size: 1 },
      files: []
    }
    expect(() =>
      parseProjectSnapshotManifest({
        ...base,
        files: [{ relativePath: '../escape.txt', role: 'fixture', sha256: 'c'.repeat(64), size: 1 }]
      })
    ).toThrow()
    expect(() =>
      parseProjectSnapshotManifest({
        ...base,
        files: [
          { relativePath: 'A.txt', role: 'fixture', sha256: 'c'.repeat(64), size: 1 },
          { relativePath: 'a.txt', role: 'fixture', sha256: 'd'.repeat(64), size: 1 }
        ]
      })
    ).toThrow()
  })
})
