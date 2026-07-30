import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { sql } from 'kysely'
import { APP_DATABASE_APPLICATION_ID, APP_SCHEMA_VERSION, openAppDatabase } from './connection'

const temporaryDirectories: string[] = []
const log = pino({ level: 'silent' })

async function temporaryUserData(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'writellm-app-db-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('application database', () => {
  it('opens without a project and contains only application-owned tables', async () => {
    const database = await openAppDatabase({
      path: join(await temporaryUserData(), 'app.sqlite'),
      applicationVersion: '1.0.0-test',
      log
    })

    const tables = await sql<{ name: string }>`
      SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `.execute(database.kysely)
    const applicationId = await sql<{ application_id: number }>`PRAGMA application_id`.execute(
      database.kysely
    )
    const manifest = await database.kysely
      .selectFrom('schema_manifest')
      .select(['application_version', 'schema_version'])
      .executeTakeFirstOrThrow()

    expect(tables.rows.map((row) => row.name)).toEqual([
      'agent_model_catalogs',
      'app_settings',
      'encrypted_credentials',
      'provider_configs',
      'recent_projects',
      'schema_manifest',
      'schema_migrations'
    ])
    expect(applicationId.rows[0]?.application_id).toBe(APP_DATABASE_APPLICATION_ID)
    expect(manifest).toEqual({
      application_version: '1.0.0-test',
      schema_version: APP_SCHEMA_VERSION
    })
    database.close()
  })
})
