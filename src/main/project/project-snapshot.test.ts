import { createHash } from 'node:crypto'
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { createProject } from './project-lifecycle'
import { openProjectDatabase, PROJECT_SCHEMA_VERSION } from './project-database'
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
    const snapshotDatabaseBytes = await readFile(join(snapshotRoot, '.writellm', 'project.sqlite'))
    const snapshotDatabaseText = snapshotDatabaseBytes.toString('utf8').toLowerCase()
    expect(snapshotDatabaseText).not.toMatch(
      /upload_url_ciphertext|download_url_ciphertext|signature=|recovery_capability/
    )
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
    await expect(readFile(join(restoredRoot, 'writellm.snapshot.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    })

    const manifestPath = join(snapshotRoot, 'writellm.snapshot.json')
    const legacyManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<
      string,
      unknown
    >
    legacyManifest.snapshotFormatVersion = 1
    delete legacyManifest.versionHistory
    await writeFile(manifestPath, `${JSON.stringify(legacyManifest)}\n`)
    const legacyRoot = join(parent, 'legacy-v1.writellm')
    await expect(
      restoreProjectSnapshot({ snapshotRoot, destination: legacyRoot, log })
    ).resolves.toMatchObject({ projectId: created.manifest.projectId })
    await expect(
      access(resolveProjectPath(legacyRoot, '.writellm/history.git'))
    ).rejects.toMatchObject({ code: 'ENOENT' })
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
    const candidate = new Database(candidatePath)
    candidate.pragma('journal_mode = WAL')
    candidate.pragma('wal_autocheckpoint = 0')
    candidate.prepare("UPDATE project_meta SET updated_at = 'candidate-wal'").run()
    await writeFile(`${databasePath}-wal`, 'stale wal')
    await writeFile(`${databasePath}-shm`, 'stale shm')
    const result = await restoreProjectDatabase({
      projectRoot: created.projectRoot,
      candidateDatabase: candidatePath,
      projectId: created.manifest.projectId,
      log
    })
    const preRestore = await readFile(result.preRestoreBackup)
    expect(preRestore.length).toBeGreaterThan(0)
    await expect(access(`${databasePath}-wal`)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(`${databasePath}-shm`)).rejects.toMatchObject({ code: 'ENOENT' })
    const restored = new Database(databasePath, { readonly: true, fileMustExist: true })
    expect(restored.prepare('SELECT updated_at FROM project_meta').pluck().get()).toBe(
      'candidate-wal'
    )
    restored.close()
    candidate.close()
  })

  it('rejects incompatible restore candidates without replacing the current database', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'writellm-database-reject-'))
    directories.push(parent)
    const current = await createProject({
      destination: join(parent, 'current.writellm'),
      forbiddenApplicationDirectories: [],
      applicationVersion: '1.0.0-test',
      log
    })
    const other = await createProject({
      destination: join(parent, 'other.writellm'),
      forbiddenApplicationDirectories: [],
      applicationVersion: '1.0.0-test',
      log
    })
    await current.writeLock.release()
    await other.writeLock.release()
    const databasePath = resolveProjectPath(current.projectRoot, '.writellm/project.sqlite')
    const original = new Database(databasePath, { readonly: true })
    const originalProjectId = original.prepare('SELECT project_id FROM project_meta').pluck().get()
    original.close()

    await expect(
      restoreProjectDatabase({
        projectRoot: current.projectRoot,
        candidateDatabase: resolveProjectPath(other.projectRoot, '.writellm/project.sqlite'),
        projectId: current.manifest.projectId,
        log
      })
    ).rejects.toThrow('Project database restore failed')

    const unchanged = new Database(databasePath, { readonly: true, fileMustExist: true })
    expect(unchanged.prepare('SELECT project_id FROM project_meta').pluck().get()).toBe(
      originalProjectId
    )
    unchanged.close()
    await expect(
      access(resolveProjectPath(current.projectRoot, '.writellm/backups'))
    ).resolves.toBe(undefined)
    expect(
      await import('node:fs/promises').then(({ readdir }) =>
        readdir(resolveProjectPath(current.projectRoot, '.writellm/backups'))
      )
    ).toEqual([])
  })

  it('rejects restore candidates with newer schemas or changed migration checksums', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'writellm-database-schema-reject-'))
    directories.push(parent)
    const created = await createProject({
      destination: join(parent, 'schema.writellm'),
      forbiddenApplicationDirectories: [],
      applicationVersion: '1.0.0-test',
      log
    })
    await created.writeLock.release()
    const databasePath = resolveProjectPath(created.projectRoot, '.writellm/project.sqlite')

    const newer = join(parent, 'newer.sqlite')
    const newerSource = new Database(databasePath)
    await newerSource.backup(newer)
    newerSource.close()
    const newerDatabase = new Database(newer)
    const futureSchemaVersion = PROJECT_SCHEMA_VERSION + 1
    newerDatabase
      .prepare('INSERT INTO schema_migrations VALUES (?, ?, ?, ?)')
      .run(futureSchemaVersion, 'future', 'future-checksum', '2026-07-15T00:00:00.000Z')
    newerDatabase.prepare('UPDATE schema_manifest SET schema_version = ?').run(futureSchemaVersion)
    newerDatabase.pragma(`user_version = ${futureSchemaVersion}`)
    newerDatabase.close()
    await expect(
      restoreProjectDatabase({
        projectRoot: created.projectRoot,
        candidateDatabase: newer,
        projectId: created.manifest.projectId,
        log
      })
    ).rejects.toThrow('Project database restore failed')

    const changedChecksum = join(parent, 'checksum.sqlite')
    const checksumSource = new Database(databasePath)
    await checksumSource.backup(changedChecksum)
    checksumSource.close()
    const checksumDatabase = new Database(changedChecksum)
    checksumDatabase
      .prepare("UPDATE schema_migrations SET checksum = 'changed' WHERE version = 1")
      .run()
    checksumDatabase.close()
    await expect(
      restoreProjectDatabase({
        projectRoot: created.projectRoot,
        candidateDatabase: changedChecksum,
        projectId: created.manifest.projectId,
        log
      })
    ).rejects.toThrow('Project database restore failed')
  })

  it('rejects traversal and case-colliding snapshot inventory paths', () => {
    const base = {
      snapshotFormat: 'writellm-project-snapshot',
      snapshotFormatVersion: 1,
      projectId: '11111111-1111-4111-8111-111111111111',
      projectFormatVersion: 1,
      projectDatabaseSchemaVersion: 3,
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
    expect(() =>
      parseProjectSnapshotManifest({
        ...base,
        files: [{ relativePath: '/absolute.txt', role: 'fixture', sha256: 'c'.repeat(64), size: 1 }]
      })
    ).toThrow()
    expect(() =>
      parseProjectSnapshotManifest({
        ...base,
        files: [
          { relativePath: 'same.txt', role: 'fixture', sha256: 'c'.repeat(64), size: 1 },
          { relativePath: 'same.txt', role: 'fixture', sha256: 'c'.repeat(64), size: 1 }
        ]
      })
    ).toThrow()
  })

  it('rejects an inventory file reached through a symbolic-link directory', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'writellm-snapshot-symlink-'))
    directories.push(parent)
    const created = await createProject({
      destination: join(parent, 'source.writellm'),
      forbiddenApplicationDirectories: [],
      applicationVersion: '1.0.0-test',
      log
    })
    await created.writeLock.release()
    const outside = join(parent, 'outside')
    await mkdir(outside)
    const body = Buffer.from('outside')
    await writeFile(join(outside, 'file.txt'), body)
    await symlink(outside, join(created.projectRoot, 'linked'))
    const database = await openProjectDatabase({
      projectRoot: created.projectRoot,
      manifest: created.manifest,
      applicationVersion: '1.0.0-test',
      log
    })

    await expect(
      createProjectSnapshot({
        sourceRoot: created.projectRoot,
        manifest: created.manifest,
        sourceDatabase: database,
        destination: join(parent, 'snapshot'),
        sourceAppVersion: '1.0.0-test',
        inventoryFromBackup: () => [
          {
            relativePath: 'linked/file.txt',
            role: 'fixture',
            sha256: createHash('sha256').update(body).digest('hex'),
            size: body.byteLength
          }
        ],
        barrier: {
          pauseMutations: async () => undefined,
          finalEditorFlush: async () => undefined,
          pauseFilePublishers: async () => undefined,
          resumeFilePublishers: async () => undefined,
          resumeMutations: async () => undefined
        },
        log
      })
    ).rejects.toThrow('Project snapshot failed')
    database.close()
    await expect(access(join(parent, 'snapshot'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
