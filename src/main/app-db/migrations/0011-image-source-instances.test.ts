import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migration0001 } from './0001-application-state'
import { migration0004 } from './0004-credential-bindings'
import { migration0011 } from './0011-image-source-instances'

function legacyDatabase(): Database.Database {
  const database = new Database(':memory:')
  migration0001.up(database)
  migration0004.up(database)
  const now = '2026-10-01T00:00:00.000Z'
  const insert = database.prepare(
    'INSERT INTO provider_configs (id, provider, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  )
  const common = {
    role: 'image',
    timeoutMs: 90_000,
    embeddingDimension: null,
    batchLimit: 1,
    fileSizeLimitMb: null,
    defaultAspectRatio: '16:9',
    defaultImageSize: '2K'
  }
  insert.run(
    'image:google-gemini',
    'google-gemini',
    JSON.stringify({
      ...common,
      providerId: 'google-gemini',
      baseUrl: 'https://generativelanguage.googleapis.com',
      model: 'gemini-3-pro-image'
    }),
    now,
    now
  )
  insert.run(
    'image:google-vertex',
    'google-vertex',
    JSON.stringify({
      ...common,
      providerId: 'google-vertex',
      projectId: 'writellm-images-123',
      location: 'global',
      model: 'gemini-3.1-flash-image'
    }),
    now,
    now
  )
  database
    .prepare(
      `INSERT INTO encrypted_credentials
         (id, provider_config_id, ciphertext, binding_fingerprint, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      'image:google-gemini:api-key',
      'image:google-gemini',
      'ciphertext',
      'a'.repeat(64),
      now,
      now
    )
  database
    .prepare(
      'INSERT INTO app_settings (key, value_json, created_at, updated_at) VALUES (?, ?, ?, ?)'
    )
    .run('image.active-provider.v1', JSON.stringify('google-vertex'), now, now)
  return database
}

describe('migration 0011 image source instances', () => {
  it('rewrites legacy sources in place and moves the active model into the default', () => {
    const database = legacyDatabase()
    migration0011.up(database)

    const rows = database
      .prepare('SELECT id, provider, config_json FROM provider_configs ORDER BY id')
      .all() as Array<{ id: string; provider: string; config_json: string }>
    expect(rows.map((row) => [row.id, row.provider, JSON.parse(row.config_json)])).toEqual([
      [
        'image:google-gemini',
        'google-gemini',
        {
          role: 'image',
          providerId: 'google-gemini',
          sourceId: 'google-gemini',
          name: 'Google Gemini',
          timeoutMs: 90_000,
          batchLimit: 1,
          embeddingDimension: null,
          fileSizeLimitMb: null,
          defaultAspectRatio: '16:9',
          defaultImageSize: '2K',
          manualModels: [],
          disabledModelIds: []
        }
      ],
      [
        'image:google-vertex',
        'google-vertex',
        expect.objectContaining({
          sourceId: 'google-vertex',
          name: 'Google Vertex AI',
          projectId: 'writellm-images-123',
          location: 'global'
        })
      ]
    ])
    expect(
      database
        .prepare('SELECT id, ciphertext, binding_fingerprint FROM encrypted_credentials')
        .all()
    ).toEqual([
      { id: 'image:google-gemini:api-key', ciphertext: 'ciphertext', binding_fingerprint: null }
    ])
    expect(database.prepare('SELECT key, value_json FROM app_settings ORDER BY key').all()).toEqual(
      [
        {
          key: 'image.default-selection.v1',
          value_json: JSON.stringify({
            sourceId: 'google-vertex',
            modelId: 'gemini-3.1-flash-image'
          })
        }
      ]
    )
    database.close()
  })

  it('leaves no default when no legacy source was active', () => {
    const database = legacyDatabase()
    database.prepare('DELETE FROM app_settings').run()
    migration0011.up(database)
    expect(database.prepare('SELECT count(*) FROM app_settings').pluck().get()).toBe(0)
    database.close()
  })
})
