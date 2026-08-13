import Database from 'better-sqlite3'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { migrateDatabase } from '../../db/migrations'
import { projectMigrations } from '.'
import { migration0035 } from './0035-manuscript-asset-variants'

describe('migration 0035 manuscript asset variants', () => {
  it('adds restrictive, indexed candidate lineage without changing existing assets', () => {
    const database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    migrateDatabase(database, {
      applicationVersion: 'test',
      databaseRole: 'project',
      migrations: projectMigrations.slice(0, 34),
      log: pino({ level: 'silent' })
    })

    database.transaction(() => migration0035.up(database)).immediate()

    const columns = (
      database.pragma('table_info(manuscript_asset_variants)') as Array<{ name: string }>
    ).map((column) => column.name)
    expect(columns).toEqual([
      'manuscript_asset_variant_id',
      'parent_asset_id',
      'candidate_asset_id',
      'generation_proposal_id',
      'candidate_model_request_id',
      'section_proposal_id',
      'disposition',
      'created_at'
    ])
    expect(
      (
        database.pragma('foreign_key_list(manuscript_asset_variants)') as Array<{
          table: string
          on_delete: string
        }>
      ).map((foreignKey) => [foreignKey.table, foreignKey.on_delete])
    ).toEqual(
      expect.arrayContaining([
        ['manuscript_assets', 'RESTRICT'],
        ['mutation_proposals', 'RESTRICT'],
        ['model_requests', 'RESTRICT']
      ])
    )
    expect(
      database
        .prepare(
          "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name LIKE 'manuscript_asset_variants_%'"
        )
        .pluck()
        .get()
    ).toBe(3)
    expect(database.pragma('foreign_key_check')).toEqual([])
    database.close()
  })
})
