import type { DatabaseMigration } from '../../db/migrations'

const parseTables = [
  'parse_tasks',
  'parse_task_events',
  'parse_revisions',
  'normalization_runs',
  'active_parse_revisions'
] as const

interface Definition {
  name: string
  sql: string
}

/** ADR 095: old tasks retain the original singleton source and its saved connection fingerprint. */
export const migration0050: DatabaseMigration = {
  version: 50,
  name: '0050-mineru-provider-binding',
  checksum: 'sha256:65b8f64c77ce57021ed77da57413e8c4c249f4f35e8d0f6718a65fb37b6ed45dd',
  up(database) {
    const placeholders = parseTables.map(() => '?').join(', ')
    const definitions = database
      .prepare(
        `SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name IN (${placeholders})`
      )
      .all(...parseTables) as Definition[]
    const tables = new Map(definitions.map(({ name, sql }) => [name, sql]))
    const reverse = [...parseTables].reverse()
    const indexes = database
      .prepare(
        `SELECT name, sql FROM sqlite_schema
        WHERE type = 'index' AND sql IS NOT NULL AND tbl_name IN (${placeholders})`
      )
      .all(...parseTables) as Definition[]
    if (parseTables.some((name) => !tables.has(name))) {
      throw new Error('MinerU binding migration found an unexpected project schema')
    }

    database.pragma('defer_foreign_keys = ON')
    database.pragma('legacy_alter_table = ON')
    try {
      for (const { name } of indexes) database.exec(`DROP INDEX "${name.replaceAll('"', '""')}"`)
      for (const table of reverse) database.exec(`ALTER TABLE "${table}" RENAME TO "${table}_v49"`)
      for (const table of parseTables) {
        const definition = tables.get(table) as string
        database.exec(
          table === 'parse_tasks'
            ? definition.replace('remote_task_id TEXT UNIQUE', 'remote_task_id TEXT')
            : definition
        )
        database.exec(`INSERT INTO "${table}" SELECT * FROM "${table}_v49"`)
      }
      for (const table of reverse) database.exec(`DROP TABLE "${table}_v49"`)
      for (const { sql } of indexes) database.exec(sql)

      database.exec(`
        ALTER TABLE parse_tasks ADD COLUMN provider_source_id TEXT NOT NULL DEFAULT 'legacy'
          CHECK (length(provider_source_id) BETWEEN 1 AND 80 AND provider_source_id NOT GLOB '*[^A-Za-z0-9._:-]*');
        ALTER TABLE parse_tasks ADD COLUMN provider_config_id TEXT NOT NULL DEFAULT 'legacy'
          CHECK (length(provider_config_id) BETWEEN 1 AND 80 AND provider_config_id NOT GLOB '*[^A-Za-z0-9._:-]*');
        CREATE UNIQUE INDEX parse_tasks_remote_source_idx
          ON parse_tasks(provider_source_id, provider_fingerprint, remote_task_id);
      `)
    } finally {
      database.pragma('legacy_alter_table = OFF')
    }
  }
}
