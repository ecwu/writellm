import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { sql } from 'kysely'
import { openDatabase } from '../db/open-database'
import { APP_DATABASE_APPLICATION_ID, APP_SCHEMA_VERSION, openAppDatabase } from './connection'
import type { AppDatabaseSchema } from './database-types'
import { migration0001 } from './migrations/0001-application-state'
import { migration0002 } from './migrations/0002-agent-model-catalogs'
import { migration0003 } from './migrations/0003-agent-model-preferences'
import { credentialBindingFingerprint } from '../providers/credential-binding'

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
      'agent_model_preferences',
      'agent_provider_preferences',
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

  it('upgrades the v1 application schema, preserves data, and verifies a pre-migration backup', async () => {
    const userData = await temporaryUserData()
    const databasePath = join(userData, 'app.sqlite')
    const timestamp = '2026-07-31T10:00:00.000Z'
    const legacy = await openDatabase<AppDatabaseSchema>({
      path: databasePath,
      applicationId: APP_DATABASE_APPLICATION_ID,
      applicationVersion: '0.1.0-test',
      databaseRole: 'app',
      migrations: [migration0001],
      log
    })
    await legacy.kysely
      .insertInto('app_settings')
      .values({
        key: 'theme',
        value_json: JSON.stringify({ mode: 'dark' }),
        created_at: timestamp,
        updated_at: timestamp
      })
      .execute()
    legacy.close()

    const upgraded = await openAppDatabase({
      path: databasePath,
      applicationVersion: '1.0.0-test',
      log
    })

    expect(
      await upgraded.kysely
        .selectFrom('app_settings')
        .select(['key', 'value_json'])
        .executeTakeFirstOrThrow()
    ).toEqual({
      key: 'theme',
      value_json: JSON.stringify({ mode: 'dark' })
    })
    expect(
      await upgraded.kysely
        .selectFrom('schema_manifest')
        .select(['application_version', 'schema_version'])
        .executeTakeFirstOrThrow()
    ).toEqual({
      application_version: '1.0.0-test',
      schema_version: APP_SCHEMA_VERSION
    })
    upgraded.close()

    const backupNames = await readdir(join(userData, 'backups'))
    expect(backupNames).toHaveLength(1)
    expect(backupNames[0]).toMatch(/^migration-v1-to-v4-[0-9a-f-]+\.sqlite$/u)
    const backup = new Database(join(userData, 'backups', backupNames[0] as string), {
      readonly: true,
      fileMustExist: true
    })
    try {
      expect(backup.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(
        backup
          .prepare('SELECT application_version, schema_version FROM schema_manifest WHERE id = 1')
          .get()
      ).toEqual({
        application_version: '0.1.0-test',
        schema_version: 1
      })
      expect(
        backup.prepare('SELECT value_json FROM app_settings WHERE key = ?').get('theme')
      ).toEqual({
        value_json: JSON.stringify({ mode: 'dark' })
      })
      expect(
        backup
          .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = 'agent_model_catalogs'"
          )
          .get()
      ).toEqual({ count: 0 })
    } finally {
      backup.close()
    }
  })

  it('invalidates editable endpoint credentials while backfilling immutable built-ins', async () => {
    const userData = await temporaryUserData()
    const databasePath = join(userData, 'app.sqlite')
    const timestamp = '2026-07-31T10:00:00.000Z'
    const legacy = await openDatabase<AppDatabaseSchema>({
      path: databasePath,
      applicationId: APP_DATABASE_APPLICATION_ID,
      applicationVersion: '0.3.0-test',
      databaseRole: 'app',
      migrations: [migration0001, migration0002, migration0003],
      log
    })
    const immutableConfig = {
      role: 'image',
      providerId: 'google-gemini',
      model: 'gemini-3.1-flash-image'
    }
    const customConfig = {
      role: 'agent-preset',
      kind: 'custom',
      authMode: 'api_key',
      api: 'openai-responses',
      baseUrl: 'https://custom.example.test/v1'
    }
    const endpointConfig = {
      role: 'embedding',
      providerId: 'openai-compatible',
      baseUrl: 'https://embedding.example.test/v1'
    }
    legacy.immediate((nativeDatabase) => {
      for (const [id, provider, config] of [
        ['image', 'google-gemini', immutableConfig],
        ['agent:custom:legacy', 'writellm-custom:legacy', customConfig],
        ['embedding', 'openai-compatible', endpointConfig]
      ] as const) {
        nativeDatabase
          .prepare(
            `INSERT INTO provider_configs
               (id, provider, config_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`
          )
          .run(id, provider, JSON.stringify(config), timestamp, timestamp)
        nativeDatabase
          .prepare(
            `INSERT INTO encrypted_credentials
               (id, provider_config_id, ciphertext, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`
          )
          .run(`${id}:api-key`, id, `ciphertext:${id}`, timestamp, timestamp)
      }
    })
    legacy.close()

    const upgraded = await openAppDatabase({
      path: databasePath,
      applicationVersion: '1.0.0-test',
      log
    })
    const credentials = await upgraded.kysely
      .selectFrom('encrypted_credentials')
      .select(['provider_config_id', 'binding_fingerprint'])
      .orderBy('provider_config_id')
      .execute()
    expect(credentials).toEqual([
      {
        provider_config_id: 'image',
        binding_fingerprint: credentialBindingFingerprint({
          providerConfigId: 'image',
          provider: 'google-gemini',
          configJson: JSON.stringify(immutableConfig)
        })
      }
    ])
    await expect(
      upgraded.kysely
        .insertInto('encrypted_credentials')
        .values({
          id: 'image:invalid-binding',
          provider_config_id: 'image',
          ciphertext: 'ciphertext',
          binding_fingerprint: 'g'.repeat(64),
          created_at: timestamp,
          updated_at: timestamp
        })
        .execute()
    ).rejects.toThrow()
    upgraded.close()
  })
})
