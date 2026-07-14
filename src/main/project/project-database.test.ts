import { mkdir, mkdtemp, rm } from 'node:fs/promises'
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
