import Database from 'better-sqlite3'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { migrateDatabase } from '../../db/migrations'
import { projectMigrations } from '.'
import { migration0036 } from './0036-manuscript-annotations'

describe('migration 0036 manuscript annotations', () => {
  it('adds one restrictive project-local annotation authority with bounded indexes', () => {
    const database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    migrateDatabase(database, {
      applicationVersion: 'test',
      databaseRole: 'project',
      migrations: projectMigrations.slice(0, 35),
      log: pino({ level: 'silent' })
    })

    database.transaction(() => migration0036.up(database)).immediate()

    expect(
      (database.pragma('table_info(manuscript_annotations)') as Array<{ name: string }>).map(
        (column) => column.name
      )
    ).toEqual([
      'annotation_id',
      'kind',
      'status',
      'body',
      'section_id',
      'block_id',
      'anchor_revision_id',
      'text_anchor',
      'text_anchor_fingerprint',
      'version',
      'created_at',
      'updated_at',
      'resolved_at'
    ])
    expect(
      (
        database.pragma('foreign_key_list(manuscript_annotations)') as Array<{
          table: string
          on_delete: string
        }>
      ).map((foreignKey) => [foreignKey.table, foreignKey.on_delete])
    ).toEqual(
      expect.arrayContaining([
        ['sections', 'RESTRICT'],
        ['section_revisions', 'RESTRICT']
      ])
    )
    expect(
      database
        .prepare(
          "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name LIKE 'manuscript_annotations_%'"
        )
        .pluck()
        .get()
    ).toBe(3)
    expect(database.pragma('foreign_key_check')).toEqual([])
    database.close()
  })
})
