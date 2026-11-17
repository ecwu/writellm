import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../db/open-database'
import { credentialBindingFingerprint } from '../../providers/credential-binding'
import { APP_DATABASE_APPLICATION_ID, openAppDatabase } from '../connection'
import type { AppDatabaseSchema } from '../database-types'
import { PurposeCatalogRepository } from '../repositories/purpose-catalog'
import { appMigrations } from './index'

const log = pino({ enabled: false })
describe('application model catalogs', () => {
  it('upgrades v12 profiles without rebinding credentials and retains one explicit default for each purpose after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'purpose-migration-'))
    const path = join(directory, 'app.sqlite')
    const now = new Date().toISOString()
    const rows = [
      {
        id: 'speech',
        role: 'speech',
        providerId: 'openai-compatible',
        model: 'transcribe',
        mode: 'file',
        name: 'Microphone',
        sourceId: 'legacy'
      },
      {
        id: 'speech:live',
        role: 'speech',
        providerId: 'openai-compatible',
        model: 'transcribe',
        mode: 'realtime',
        name: 'Live audio',
        sourceId: 'live'
      },
      {
        id: 'embedding',
        role: 'embedding',
        providerId: 'openai-compatible',
        model: 'embed',
        modelRevision: 'v7',
        embeddingDimension: 384
      },
      {
        id: 'rerank',
        role: 'rerank',
        providerId: 'cohere-compatible',
        model: 'rank',
        modelRevision: 'v2'
      },
      { id: 'mineru', role: 'mineru', providerId: 'mineru', model: 'pipeline' },
      {
        id: 'speech:wrong',
        role: 'speech',
        providerId: 'openai-compatible',
        model: 'invalid',
        mode: 'file',
        name: 'Mismatched',
        sourceId: 'live'
      }
    ]
    try {
      const old = await openDatabase<AppDatabaseSchema>({
        path,
        applicationId: APP_DATABASE_APPLICATION_ID,
        applicationVersion: 'v12-test',
        databaseRole: 'app',
        migrations: appMigrations.filter((m) => m.version <= 12),
        log
      })
      for (const { id, ...entry } of rows) {
        const configJson = JSON.stringify({
          timeoutMs: 60000,
          batchLimit: 1,
          embeddingDimension: null,
          fileSizeLimitMb: entry.role === 'mineru' ? 100 : null,
          baseUrl: 'https://api.example.test',
          ...entry
        })
        await old.kysely
          .insertInto('provider_configs')
          .values({
            id,
            provider: entry.providerId,
            config_json: configJson,
            created_at: now,
            updated_at: now
          })
          .execute()
        await old.kysely
          .insertInto('encrypted_credentials')
          .values({
            id: `${id}:api-key`,
            provider_config_id: id,
            ciphertext: `ciphertext-${id}`,
            binding_fingerprint: credentialBindingFingerprint({
              providerConfigId: id,
              provider: entry.providerId,
              configJson
            }),
            created_at: now,
            updated_at: now
          })
          .execute()
      }
      await old.kysely
        .insertInto('app_settings')
        .values({
          key: 'speech.active-source.v1',
          value_json: '"live"',
          created_at: now,
          updated_at: now
        })
        .execute()
      old.close()
      const options = { path, applicationVersion: 'v13-test', log }
      const upgraded = await openAppDatabase(options)
      upgraded.close()
      const restarted = await openAppDatabase(options)
      try {
        const repository = new PurposeCatalogRepository(restarted.kysely)
        for (const role of ['embedding', 'rerank', 'mineru', 'speech'] as const) {
          expect(await repository.getDefault(role)).toEqual({
            sourceId: role === 'speech' ? 'live' : 'legacy',
            configId: 'legacy'
          })
        }
        expect(await repository.getModel('embedding', 'legacy', 'legacy')).toMatchObject({
          model: 'embed',
          model_revision: 'v7',
          embedding_dimension: 384
        })
        expect(await repository.getModel('rerank', 'legacy', 'legacy')).toMatchObject({
          model: 'rank',
          model_revision: 'v2'
        })
        expect(await repository.getModel('mineru', 'legacy', 'legacy')).toMatchObject({
          model: 'pipeline'
        })
        for (const { id, ...entry } of rows) {
          const row = await restarted.kysely
            .selectFrom('encrypted_credentials as c')
            .innerJoin('provider_configs as p', 'p.id', 'c.provider_config_id')
            .select(['p.config_json', 'c.ciphertext', 'c.binding_fingerprint'])
            .where('p.id', '=', id)
            .executeTakeFirstOrThrow()
          expect(row.ciphertext).toBe(`ciphertext-${id}`)
          expect(row.binding_fingerprint).toBe(
            credentialBindingFingerprint({
              providerConfigId: id,
              provider: entry.providerId,
              configJson: row.config_json
            })
          )
        }
        expect((await repository.listSources('speech')).map((source) => source.source_id)).toEqual([
          'legacy',
          'live'
        ])
        const live = await repository.getModel('speech', 'live', 'legacy')
        expect(live?.mode).toBe('realtime')
        if (!live) throw new Error('Missing migrated speech configuration')
        const file = { ...live, config_id: 'file', mode: 'file' as const }
        await repository.saveModel(file)
        expect(await repository.getDefault('speech')).toEqual({
          sourceId: 'live',
          configId: 'legacy'
        })
        await repository.setDefault('speech', { sourceId: 'live', configId: 'file' })
        await repository.setModelEnabled('speech', 'live', 'file', false)
        expect(await repository.getDefault('speech')).toBeNull()
        await expect(
          repository.setDefault('speech', { sourceId: 'live', configId: 'file' })
        ).rejects.toThrow('enabled')
        await repository.setDefault('speech', { sourceId: 'live', configId: 'legacy' })
        await repository.setSourceEnabled('speech', 'live', false)
        expect(await repository.getDefault('speech')).toBeNull()
        await repository.setDefault('speech', { sourceId: 'legacy', configId: 'legacy' })
        await restarted.kysely.deleteFrom('provider_configs').where('id', '=', 'speech').execute()
        expect(await repository.getDefault('speech')).toBeNull()
        expect(restarted.read((db) => db.pragma('foreign_key_check'))).toEqual([])
        expect(restarted.read((db) => db.pragma('integrity_check', { simple: true }))).toBe('ok')
      } finally {
        restarted.close()
      }
      const backups = await readdir(join(directory, 'backups'))
      expect(backups).toHaveLength(1)
      const backup = new Database(join(directory, 'backups', backups[0]), { readonly: true })
      try {
        expect(backup.pragma('user_version', { simple: true })).toBe(12)
        expect(backup.pragma('integrity_check', { simple: true })).toBe('ok')
        expect(backup.prepare('SELECT count(*) FROM encrypted_credentials').pluck().get()).toBe(6)
      } finally {
        backup.close()
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
