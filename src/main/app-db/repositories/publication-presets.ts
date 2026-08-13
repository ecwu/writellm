import { randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import {
  createPublicationPresetInputSchema,
  publicationPresetIdSchema,
  publicationPresetSchema,
  publicationPresetSnapshotSchema,
  updatePublicationPresetInputSchema,
  type CreatePublicationPresetInput,
  type PublicationPreset,
  type PublicationPresetSnapshot,
  type UpdatePublicationPresetInput
} from '../../../shared/contracts/publication-presets'
import type { PublicationOptions } from '../../../shared/contracts/publication'
import type { AppDatabase } from '../connection'

const MAX_USER_PRESETS = 20

interface PresetRow {
  preset_id: string
  name: string
  origin: 'application' | 'user'
  schema_version: number
  options_json: string
  is_default: number
  created_at: string
  updated_at: string
}

export class PublicationPresetRepository {
  constructor(
    private readonly database: AppDatabase,
    private readonly log: Pick<Logger, 'info' | 'error'>,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly createId: () => string = randomUUID
  ) {}

  snapshot(): PublicationPresetSnapshot {
    try {
      const rows = this.database.immediate((database) =>
        database
          .prepare(
            `SELECT preset_id, name, origin, schema_version, options_json, is_default,
                    created_at, updated_at
             FROM publication_presets
             ORDER BY is_default DESC, origin ASC, name COLLATE NOCASE ASC, preset_id ASC`
          )
          .all()
      ) as PresetRow[]
      const presets = rows.map(parseRow)
      const defaultPreset = presets.find((preset) => preset.isDefault)
      if (defaultPreset === undefined) throw new Error('Publication preset default is missing')
      return publicationPresetSnapshotSchema.parse({
        schemaVersion: 1,
        defaultPresetId: defaultPreset.presetId,
        presets
      })
    } catch (err) {
      this.log.error(
        { event: 'app.publication_presets.snapshot_failed', err },
        'Preset read failed'
      )
      throw err
    }
  }

  resolve(presetId?: string): PublicationOptions {
    const snapshot = this.snapshot()
    const selected =
      presetId === undefined
        ? snapshot.presets.find((preset) => preset.isDefault)
        : snapshot.presets.find(
            (preset) => preset.presetId === publicationPresetIdSchema.parse(presetId)
          )
    if (selected === undefined) throw new Error('Publication preset is unavailable')
    return selected.options
  }

  create(input: CreatePublicationPresetInput): PublicationPresetSnapshot {
    const parsed = createPublicationPresetInputSchema.parse(input)
    const timestamp = this.now()
    const presetId = publicationPresetIdSchema.parse(this.createId())
    try {
      this.database.immediate((database) => {
        const count = database
          .prepare("SELECT COUNT(*) AS count FROM publication_presets WHERE origin = 'user'")
          .get() as { count: number }
        if (count.count >= MAX_USER_PRESETS) throw new Error('Publication preset limit reached')
        database
          .prepare(
            `INSERT INTO publication_presets
               (preset_id, name, origin, schema_version, options_json, is_default,
                created_at, updated_at)
             VALUES (?, ?, 'user', 1, ?, 0, ?, ?)`
          )
          .run(presetId, parsed.name, JSON.stringify(parsed.options), timestamp, timestamp)
      })
      this.log.info({ event: 'app.publication_presets.created', presetId }, 'Preset created')
      return this.snapshot()
    } catch (err) {
      this.log.error(
        { event: 'app.publication_presets.create_failed', err, presetId },
        'Preset create failed'
      )
      throw err
    }
  }

  update(input: UpdatePublicationPresetInput): PublicationPresetSnapshot {
    const parsed = updatePublicationPresetInputSchema.parse(input)
    try {
      const result = this.database.immediate((database) =>
        database
          .prepare(
            `UPDATE publication_presets
             SET name = ?, options_json = ?, updated_at = ?
             WHERE preset_id = ? AND origin = 'user'`
          )
          .run(parsed.name, JSON.stringify(parsed.options), this.now(), parsed.presetId)
      )
      if (result.changes !== 1) throw new Error('Application publication presets are immutable')
      this.log.info(
        { event: 'app.publication_presets.updated', presetId: parsed.presetId },
        'Preset updated'
      )
      return this.snapshot()
    } catch (err) {
      this.log.error(
        { event: 'app.publication_presets.update_failed', err, presetId: parsed.presetId },
        'Preset update failed'
      )
      throw err
    }
  }

  delete(presetId: string): PublicationPresetSnapshot {
    const parsedId = publicationPresetIdSchema.parse(presetId)
    try {
      const result = this.database.immediate((database) =>
        database
          .prepare(
            "DELETE FROM publication_presets WHERE preset_id = ? AND origin = 'user' AND is_default = 0"
          )
          .run(parsedId)
      )
      if (result.changes !== 1) throw new Error('Default or application preset cannot be deleted')
      this.log.info(
        { event: 'app.publication_presets.deleted', presetId: parsedId },
        'Preset deleted'
      )
      return this.snapshot()
    } catch (err) {
      this.log.error(
        { event: 'app.publication_presets.delete_failed', err, presetId: parsedId },
        'Preset delete failed'
      )
      throw err
    }
  }

  setDefault(presetId: string): PublicationPresetSnapshot {
    const parsedId = publicationPresetIdSchema.parse(presetId)
    try {
      this.database.immediate((database) => {
        const exists = database
          .prepare('SELECT 1 FROM publication_presets WHERE preset_id = ?')
          .get(parsedId)
        if (exists === undefined) throw new Error('Publication preset is unavailable')
        database.prepare('UPDATE publication_presets SET is_default = 0 WHERE is_default = 1').run()
        database
          .prepare(
            'UPDATE publication_presets SET is_default = 1, updated_at = ? WHERE preset_id = ?'
          )
          .run(this.now(), parsedId)
      })
      this.log.info(
        { event: 'app.publication_presets.default_updated', presetId: parsedId },
        'Default preset updated'
      )
      return this.snapshot()
    } catch (err) {
      this.log.error(
        { event: 'app.publication_presets.default_update_failed', err, presetId: parsedId },
        'Default preset update failed'
      )
      throw err
    }
  }
}

function parseRow(row: PresetRow): PublicationPreset {
  let options: unknown
  try {
    options = JSON.parse(row.options_json)
  } catch (cause) {
    throw new Error('Publication preset options are malformed', { cause })
  }
  return publicationPresetSchema.parse({
    schemaVersion: row.schema_version,
    presetId: row.preset_id,
    name: row.name,
    origin: row.origin,
    options,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  })
}
