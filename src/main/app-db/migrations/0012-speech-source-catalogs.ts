import type { DatabaseMigration } from '../../db/migrations'

/** Keep the legacy storage identity so its origin-bound ciphertext remains valid. */
export const migration0012: DatabaseMigration = {
  version: 12,
  name: '0012-speech-source-catalogs',
  checksum: 'sha256:86f57d096b88f768a37dc9f8b19cbb20973ffef6ba7c8fc737b2e1f8d3b3592e',
  up(database) {
    database.exec(`CREATE TABLE source_model_catalogs (
    provider_config_id TEXT PRIMARY KEY NOT NULL REFERENCES provider_configs(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL CHECK (length(fingerprint)=64),
    models_json TEXT NOT NULL CHECK (json_valid(models_json)),
    checked_at TEXT,
    last_attempted_at TEXT NOT NULL,
    last_error_code TEXT,
    CHECK (checked_at IS NULL OR datetime(checked_at) IS NOT NULL),
    CHECK (datetime(last_attempted_at) IS NOT NULL),
    CHECK (last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 100)
  ) STRICT;`)
    const row = database
      .prepare("SELECT config_json FROM provider_configs WHERE id='speech'")
      .get() as { config_json: string } | undefined
    if (row === undefined) return
    const config = JSON.parse(row.config_json) as Record<string, unknown>
    if (config.role !== 'speech' || config.providerId !== 'openai-compatible')
      throw new Error('Legacy speech provider identity is invalid')
    const now = new Date().toISOString()
    database
      .prepare("UPDATE provider_configs SET config_json=?,updated_at=? WHERE id='speech'")
      .run(JSON.stringify({ ...config, sourceId: 'legacy', name: 'Speech input' }), now)
    database
      .prepare(
        'INSERT OR IGNORE INTO app_settings(key,value_json,created_at,updated_at) VALUES(?,?,?,?)'
      )
      .run('speech.active-source.v1', JSON.stringify('legacy'), now, now)
  }
}
