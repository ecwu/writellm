import Database from 'better-sqlite3'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { migrateDatabase } from '../../db/migrations'
import { projectMigrations } from '.'
import { migration0034 } from './0034-manuscript-asset-metadata'

describe('migration 0034 manuscript asset metadata', () => {
  it('preserves existing assets, adds nullable dimensions, and enforces deletion state', () => {
    const database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    migrateDatabase(database, {
      applicationVersion: 'test',
      databaseRole: 'project',
      migrations: projectMigrations.slice(0, 33),
      log: pino({ level: 'silent' })
    })
    const now = '2026-08-13T04:00:00.000Z'
    database
      .prepare(
        `INSERT INTO manuscript_assets (
           asset_id, sha256, byte_size, mime_type, extension, relative_path, source_type,
           original_name, generation_request_json, model_request_id, agent_run_id,
           agent_tool_call_id, created_at, last_referenced_at
         ) VALUES (?, ?, 24, 'image/png', '.png', ?, 'upload', 'legacy.png', NULL, NULL, NULL,
                   NULL, ?, ?)`
      )
      .run(
        '019d0000-0000-4000-8000-000000000304',
        'a'.repeat(64),
        `manuscript/assets/${'a'.repeat(64)}.png`,
        now,
        now
      )

    database.transaction(() => migration0034.up(database)).immediate()

    expect(database.prepare('SELECT * FROM manuscript_assets').get()).toMatchObject({
      width: null,
      height: null,
      deletion_state: 'active'
    })
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'index' AND name = 'section_revision_assets_asset_idx'"
        )
        .pluck()
        .get()
    ).toBe('section_revision_assets_asset_idx')
    expect(() =>
      database.prepare("UPDATE manuscript_assets SET deletion_state = 'gone'").run()
    ).toThrow()
    expect(() => database.prepare('UPDATE manuscript_assets SET width = 9000').run()).toThrow()
    expect(database.pragma('foreign_key_check')).toEqual([])
    database.close()
  })
})
