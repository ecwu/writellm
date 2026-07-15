import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openAppDatabase } from '../app-db/connection'
import {
  initializeProjectDatabase,
  openProjectDatabase,
  PROJECT_DATABASE_APPLICATION_ID
} from './project-database'
import type { ProjectManifest } from './project-manifest'
import { PROJECT_DATABASE_RELATIVE_PATH } from './project-paths'
import { sql } from 'kysely'

const temporaryDirectories: string[] = []
const log = pino({ level: 'silent' })

async function temporaryRoot(name: string): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'writellm-project-db-'))
  temporaryDirectories.push(parent)
  const root = join(parent, name)
  await mkdir(root)
  return root
}

function manifest(projectId: string): ProjectManifest {
  return {
    format: 'writellm-project',
    formatVersion: 1,
    projectId,
    createdAt: '2026-07-14T00:00:00.000Z'
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('project database', () => {
  it('isolates project data from other projects and the app database', async () => {
    const firstRoot = await temporaryRoot('项目一')
    const secondRoot = await temporaryRoot('项目二')
    const firstManifest = manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc001')
    const secondManifest = manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc002')
    const first = await initializeProjectDatabase({
      projectRoot: firstRoot,
      manifest: firstManifest,
      applicationVersion: '1.0.0-test',
      log
    })
    const second = await initializeProjectDatabase({
      projectRoot: secondRoot,
      manifest: secondManifest,
      applicationVersion: '1.0.0-test',
      log
    })
    expect(
      await first.kysely.selectFrom('project_meta').select('project_id').executeTakeFirstOrThrow()
    ).toEqual({ project_id: firstManifest.projectId })
    expect(
      await second.kysely.selectFrom('project_meta').select('project_id').executeTakeFirstOrThrow()
    ).toEqual({ project_id: secondManifest.projectId })
    expect(await first.kysely.selectFrom('manuscripts').selectAll().execute()).toHaveLength(1)
    expect(await first.kysely.selectFrom('manuscript_briefs').selectAll().execute()).toHaveLength(1)
    expect(await first.kysely.selectFrom('sections').selectAll().execute()).toHaveLength(1)

    const app = await openAppDatabase({
      path: join(await temporaryRoot('user-data'), 'app.sqlite'),
      applicationVersion: '1.0.0-test',
      log
    })
    const appTables = await sql<{
      name: string
    }>`SELECT name FROM sqlite_schema WHERE type = 'table'`.execute(app.kysely)
    expect(appTables.rows.map((row) => row.name)).not.toContain('project_meta')

    const applicationId = await sql<{ application_id: number }>`PRAGMA application_id`.execute(
      first.kysely
    )
    expect(applicationId.rows[0]?.application_id).toBe(PROJECT_DATABASE_APPLICATION_ID)
    first.close()
    second.close()
    app.close()
  })

  it('creates the singleton manuscript, first brief, and initial section atomically', async () => {
    const root = await temporaryRoot('初始文稿')
    const projectManifest = manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc008')
    const database = await initializeProjectDatabase({
      projectRoot: root,
      manifest: projectManifest,
      applicationVersion: '1.0.0-test',
      log
    })

    const manuscript = await database.kysely
      .selectFrom('manuscripts')
      .selectAll()
      .executeTakeFirstOrThrow()
    expect(manuscript.project_id).toBe(projectManifest.projectId)
    expect(manuscript.is_primary).toBe(1)
    expect(
      await database.kysely
        .selectFrom('manuscript_briefs')
        .select(['manuscript_id', 'version', 'title', 'extensible_json'])
        .executeTakeFirstOrThrow()
    ).toEqual({
      manuscript_id: manuscript.manuscript_id,
      version: 1,
      title: 'Untitled Manuscript',
      extensible_json: '{}'
    })
    expect(
      await database.kysely
        .selectFrom('sections')
        .select([
          'manuscript_id',
          'parent_section_id',
          'position',
          'level',
          'title',
          'status',
          'current_revision_id'
        ])
        .executeTakeFirstOrThrow()
    ).toEqual({
      manuscript_id: manuscript.manuscript_id,
      parent_section_id: null,
      position: 0,
      level: 1,
      title: 'Untitled Section',
      status: 'planned',
      current_revision_id: null
    })
    database.close()
  })

  it('upgrades a version 1 project database without inventing project content', async () => {
    const root = await temporaryRoot('迁移')
    const projectManifest = manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc009')
    const database = await initializeProjectDatabase({
      projectRoot: root,
      manifest: projectManifest,
      applicationVersion: '1.0.0-test',
      log
    })
    database.close()

    const native = new (await import('better-sqlite3')).default(
      join(root, PROJECT_DATABASE_RELATIVE_PATH)
    )
    native.exec(`
      DROP TABLE sections;
      DROP TABLE manuscript_briefs;
      DROP INDEX manuscripts_one_primary_per_project;
      DROP TABLE manuscripts;
      DELETE FROM schema_migrations WHERE version = 2;
      UPDATE schema_manifest SET schema_version = 1 WHERE id = 1;
      PRAGMA user_version = 1;
    `)
    native.close()

    const upgraded = await openProjectDatabase({
      projectRoot: root,
      manifest: projectManifest,
      applicationVersion: '1.0.0-test',
      log
    })
    expect(await upgraded.kysely.selectFrom('manuscripts').selectAll().execute()).toEqual([])
    expect(await upgraded.kysely.selectFrom('manuscript_briefs').selectAll().execute()).toEqual([])
    expect(await upgraded.kysely.selectFrom('sections').selectAll().execute()).toEqual([])
    const migrationBackups = await readdir(join(root, '.writellm', 'backups'))
    expect(migrationBackups.filter((name) => name.startsWith('migration-'))).toHaveLength(1)
    upgraded.close()
  })

  it('keeps the original database and verified backup after migration failure', async () => {
    const root = await temporaryRoot('迁移失败')
    const projectManifest = manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc010')
    const database = await initializeProjectDatabase({
      projectRoot: root,
      manifest: projectManifest,
      applicationVersion: '1.0.0-test',
      log
    })
    database.close()

    const databasePath = join(root, PROJECT_DATABASE_RELATIVE_PATH)
    const native = new (await import('better-sqlite3')).default(databasePath)
    native.exec(`
      DROP TABLE sections;
      DROP TABLE manuscript_briefs;
      DROP INDEX manuscripts_one_primary_per_project;
      DROP TABLE manuscripts;
      DELETE FROM schema_migrations WHERE version = 2;
      UPDATE schema_manifest SET schema_version = 1 WHERE id = 1;
      PRAGMA user_version = 1;
      CREATE TABLE manuscripts (wrong_column TEXT) STRICT;
    `)
    native.close()
    const backups = join(root, '.writellm', 'backups')
    await mkdir(backups, { recursive: true })
    await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        writeFile(join(backups, `migration-old-${index}.sqlite`), `old-${index}`)
      )
    )

    await expect(
      openProjectDatabase({
        projectRoot: root,
        manifest: projectManifest,
        applicationVersion: '1.0.0-test',
        log
      })
    ).rejects.toThrow('Failed to open project database')

    const retained = await readdir(backups)
    expect(retained.filter((name) => name.startsWith('migration-old-'))).toHaveLength(4)
    expect(retained.filter((name) => name.includes('-to-v2-'))).toHaveLength(1)
    const original = new (await import('better-sqlite3')).default(databasePath, {
      readonly: true,
      fileMustExist: true
    })
    expect(original.prepare('SELECT project_id FROM project_meta').pluck().get()).toBe(
      projectManifest.projectId
    )
    expect(original.pragma('user_version', { simple: true })).toBe(1)
    original.close()
  })

  it('rejects a manifest and database identity mismatch before returning access', async () => {
    const root = await temporaryRoot('身份不匹配')
    const original = manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc003')
    const database = await initializeProjectDatabase({
      projectRoot: root,
      manifest: original,
      applicationVersion: '1.0.0-test',
      log
    })
    database.close()

    await expect(
      openProjectDatabase({
        projectRoot: root,
        manifest: manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc004'),
        applicationVersion: '1.0.0-test',
        log
      })
    ).rejects.toThrow('Failed to open project database')
  })

  it('logs the original identity validation error', async () => {
    const root = await temporaryRoot('日志')
    const original = manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc005')
    const database = await initializeProjectDatabase({
      projectRoot: root,
      manifest: original,
      applicationVersion: '1.0.0-test',
      log
    })
    database.close()
    const error = vi.fn()
    const spyLog = { info: vi.fn(), error } as unknown as typeof log

    await expect(
      openProjectDatabase({
        projectRoot: root,
        manifest: manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc006'),
        applicationVersion: '1.0.0-test',
        log: spyLog
      })
    ).rejects.toThrow()
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'db.open.failed',
        databaseRole: 'project',
        err: expect.any(Error)
      }),
      expect.any(String)
    )
  })

  it('does not accept an app database as a project database', async () => {
    const root = await temporaryRoot('角色')
    await mkdir(join(root, '.writellm'), { recursive: true })
    const app = await openAppDatabase({
      path: join(root, PROJECT_DATABASE_RELATIVE_PATH),
      applicationVersion: '1.0.0-test',
      log
    })
    app.close()

    await expect(
      openProjectDatabase({
        projectRoot: root,
        manifest: manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc007'),
        applicationVersion: '1.0.0-test',
        log
      })
    ).rejects.toThrow('Failed to open project database')
  })
})
