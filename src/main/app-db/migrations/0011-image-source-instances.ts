import type { DatabaseMigration } from '../../db/migrations'

const LEGACY_ACTIVE_IMAGE_PROVIDER_KEY = 'image.active-provider.v1'
const IMAGE_DEFAULT_SELECTION_KEY = 'image.default-selection.v1'
const LEGACY_IMAGE_SOURCES = {
  'google-gemini': 'Google Gemini',
  'google-vertex': 'Google Vertex AI',
  openai: 'OpenAI',
  xai: 'xAI'
} as const

type LegacyImageProviderId = keyof typeof LEGACY_IMAGE_SOURCES

/**
 * ADR 093: rewrite each fixed `image:<transport>` row in place as a source instance whose
 * `sourceId` is the legacy transport ID. The per-source model moves into the default selection.
 */
export const migration0011: DatabaseMigration = {
  version: 11,
  name: '0011-image-source-instances',
  checksum: 'sha256:f96457f6378742d0c7ba9161e449a6dc8a7f416459eaa7f1b81b93ceac166f44',
  up(database) {
    const rows = database
      .prepare(
        `SELECT id, provider, config_json
         FROM provider_configs
         WHERE id IN ('image:google-gemini', 'image:google-vertex', 'image:openai', 'image:xai')`
      )
      .all() as Array<{ id: string; provider: string; config_json: string }>
    const legacyModels = new Map<string, string>()
    const now = new Date().toISOString()
    for (const row of rows) {
      const providerId = row.id.slice('image:'.length) as LegacyImageProviderId
      if (row.provider !== providerId) {
        throw new Error('Legacy image provider identity does not match its row')
      }
      const legacy = JSON.parse(row.config_json) as Record<string, unknown>
      if (typeof legacy.model === 'string') legacyModels.set(providerId, legacy.model)
      const migrated: Record<string, unknown> = {
        role: 'image',
        providerId,
        sourceId: providerId,
        name: LEGACY_IMAGE_SOURCES[providerId],
        timeoutMs: legacy.timeoutMs ?? 120_000,
        batchLimit: legacy.batchLimit ?? 1,
        embeddingDimension: null,
        fileSizeLimitMb: null,
        defaultAspectRatio: legacy.defaultAspectRatio ?? 'auto',
        defaultImageSize: legacy.defaultImageSize ?? '1K',
        manualModels: [],
        disabledModelIds: []
      }
      if (providerId === 'google-vertex') {
        migrated.projectId = legacy.projectId
        migrated.location = legacy.location ?? 'global'
      }
      database
        .prepare('UPDATE provider_configs SET config_json = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(migrated), now, row.id)
      // A legacy Gemini endpoint field leaves the binding origin; the startup backfill
      // recomputes each binding from the rewritten configuration.
      database
        .prepare(
          'UPDATE encrypted_credentials SET binding_fingerprint = NULL WHERE provider_config_id = ?'
        )
        .run(row.id)
    }

    const active = database
      .prepare('SELECT value_json FROM app_settings WHERE key = ?')
      .pluck()
      .get(LEGACY_ACTIVE_IMAGE_PROVIDER_KEY) as string | undefined
    database.prepare('DELETE FROM app_settings WHERE key = ?').run(LEGACY_ACTIVE_IMAGE_PROVIDER_KEY)
    const activeProviderId = active === undefined ? null : (JSON.parse(active) as unknown)
    const modelId =
      typeof activeProviderId === 'string' ? legacyModels.get(activeProviderId) : undefined
    if (typeof activeProviderId !== 'string' || modelId === undefined) return
    database
      .prepare(
        `INSERT OR IGNORE INTO app_settings
          (key, value_json, created_at, updated_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(
        IMAGE_DEFAULT_SELECTION_KEY,
        JSON.stringify({ sourceId: activeProviderId, modelId }),
        now,
        now
      )
  }
}
