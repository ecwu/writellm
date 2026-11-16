import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../db/open-database'
import { openAppDatabase, APP_DATABASE_APPLICATION_ID } from '../connection'
import type { AppDatabaseSchema } from '../database-types'
import { appMigrations } from './index'
import { credentialBindingFingerprint } from '../../providers/credential-binding'

const log = pino({ enabled: false })
describe('migration 0012 speech sources', () => {
  it('keeps legacy storage identity, ciphertext and binding, and creates a verified pre-migration backup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-speech-migration-'))
    const path = join(root, 'app.sqlite')
    const original = {
      role: 'speech',
      providerId: 'openai-compatible',
      baseUrl: 'https://speech.example.test/proxy/v1',
      model: 'existing-custom-model',
      mode: 'file',
      timeoutMs: 60000,
      batchLimit: 1,
      embeddingDimension: null,
      fileSizeLimitMb: null
    }
    const configJson = JSON.stringify(original)
    const binding = credentialBindingFingerprint({
      providerConfigId: 'speech',
      provider: 'openai-compatible',
      configJson
    })
    const now = '2026-11-16T10:00:00.000Z'
    try {
      const old = await openDatabase<AppDatabaseSchema>({
        path,
        applicationId: APP_DATABASE_APPLICATION_ID,
        databaseRole: 'app',
        applicationVersion: 'test-old',
        migrations: appMigrations.filter((migration) => migration.version <= 11),
        log
      })
      await old.kysely
        .insertInto('provider_configs')
        .values({
          id: 'speech',
          provider: 'openai-compatible',
          config_json: configJson,
          created_at: now,
          updated_at: now
        })
        .execute()
      await old.kysely
        .insertInto('encrypted_credentials')
        .values({
          id: 'speech:api-key',
          provider_config_id: 'speech',
          ciphertext: 'unchanged-ciphertext',
          binding_fingerprint: binding,
          created_at: now,
          updated_at: now
        })
        .execute()
      old.close()
      const migrated = await openAppDatabase({ path, applicationVersion: 'test-new', log })
      const source = await migrated.kysely
        .selectFrom('provider_configs')
        .selectAll()
        .where('id', '=', 'speech')
        .executeTakeFirstOrThrow()
      expect(JSON.parse(source.config_json)).toEqual({
        ...original,
        sourceId: 'legacy',
        name: 'Speech input'
      })
      expect(
        credentialBindingFingerprint({
          providerConfigId: 'speech',
          provider: source.provider,
          configJson: source.config_json
        })
      ).toBe(binding)
      expect(
        await migrated.kysely
          .selectFrom('encrypted_credentials')
          .select(['ciphertext', 'binding_fingerprint', 'provider_config_id'])
          .executeTakeFirst()
      ).toEqual({
        ciphertext: 'unchanged-ciphertext',
        binding_fingerprint: binding,
        provider_config_id: 'speech'
      })
      expect(
        await migrated.kysely
          .selectFrom('app_settings')
          .select('value_json')
          .where('key', '=', 'speech.active-source.v1')
          .executeTakeFirst()
      ).toEqual({ value_json: '"legacy"' })
      expect(
        migrated.read((database) => database.prepare('PRAGMA integrity_check').pluck().get())
      ).toBe('ok')
      expect(
        migrated.read((database) => database.prepare('PRAGMA foreign_key_check').all())
      ).toEqual([])
      migrated.close()
      const backups = await readdir(join(root, 'backups'))
      expect(backups).toHaveLength(1)
      const backup = new Database(join(root, 'backups', backups[0]), { readonly: true })
      try {
        expect(backup.pragma('user_version', { simple: true })).toBe(11)
        expect(
          JSON.parse(
            (
              backup
                .prepare("SELECT config_json FROM provider_configs WHERE id='speech'")
                .get() as { config_json: string }
            ).config_json
          )
        ).toEqual(original)
        expect(backup.pragma('integrity_check', { simple: true })).toBe('ok')
      } finally {
        backup.close()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
