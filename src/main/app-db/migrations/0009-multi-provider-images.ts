import type { DatabaseMigration } from '../../db/migrations'

const LEGACY_IMAGE_ID = 'image'
const GEMINI_IMAGE_ID = 'image:google-gemini'
const ACTIVE_IMAGE_PROVIDER_KEY = 'image.active-provider.v1'

export const migration0009: DatabaseMigration = {
  version: 9,
  name: '0009-multi-provider-images',
  checksum: 'sha256:2cad6c56494112340e775544488526e66906468de5e23c51e17e90c3bed8e5ca',
  up(database) {
    const legacy = database
      .prepare(
        `SELECT provider, config_json, created_at, updated_at
         FROM provider_configs
         WHERE id = ?`
      )
      .get(LEGACY_IMAGE_ID) as
      | {
          provider: string
          config_json: string
          created_at: string
          updated_at: string
        }
      | undefined
    if (legacy === undefined) return
    if (legacy.provider !== 'google-gemini') {
      throw new Error('Legacy image provider is not Google Gemini')
    }
    const targetExists = database
      .prepare('SELECT 1 FROM provider_configs WHERE id = ?')
      .pluck()
      .get(GEMINI_IMAGE_ID)
    if (targetExists !== undefined) {
      throw new Error('Migrated Gemini image provider already exists')
    }

    database
      .prepare(
        `INSERT INTO provider_configs
          (id, provider, config_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        GEMINI_IMAGE_ID,
        legacy.provider,
        legacy.config_json,
        legacy.created_at,
        legacy.updated_at
      )
    database
      .prepare(
        `UPDATE encrypted_credentials
         SET id = ?, provider_config_id = ?, binding_fingerprint = NULL
         WHERE provider_config_id = ?`
      )
      .run(`${GEMINI_IMAGE_ID}:api-key`, GEMINI_IMAGE_ID, LEGACY_IMAGE_ID)
    database.prepare('DELETE FROM provider_configs WHERE id = ?').run(LEGACY_IMAGE_ID)

    const now = new Date().toISOString()
    database
      .prepare(
        `INSERT OR IGNORE INTO app_settings
          (key, value_json, created_at, updated_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(ACTIVE_IMAGE_PROVIDER_KEY, JSON.stringify('google-gemini'), now, now)
  }
}
