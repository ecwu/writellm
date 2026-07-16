import type Database from 'better-sqlite3'

const FORBIDDEN_CAPABILITY_MARKERS = [
  'signed_url',
  'download_url',
  'encrypted_download_url',
  'signed_url_ciphertext',
  'upload_url_ciphertext',
  'download_url_ciphertext',
  'recovery_capability',
  'ciphertext',
  'signature='
] as const

const DURABLE_JOB_TYPES = new Set([
  'mineru_parse',
  'normalize_parse_revision',
  'build_index_generation',
  'build_embedding_generation',
  'remove_index_item',
  'rebuild_index',
  'artifact_cleanup'
])

/** Verify that project persistence contains no reusable MinerU URL capability. */
export function assertNoPersistedMineruCapabilities(database: Database.Database): void {
  const objects = database
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'trigger', 'view')"
    )
    .all() as Array<{ name: string; sql: string | null }>
  for (const object of objects) {
    const definition = object.sql?.toLowerCase() ?? ''
    const marker = FORBIDDEN_CAPABILITY_MARKERS.find((value) => definition.includes(value))
    if (marker !== undefined) {
      throw new Error(
        `Project database persists a forbidden MinerU capability marker: ${marker} in ${object.name}`
      )
    }
    const columns = database
      .prepare(`PRAGMA table_info(${quoteIdentifier(object.name)})`)
      .all() as Array<{ name: string }>
    const column = columns.find(({ name }) =>
      FORBIDDEN_CAPABILITY_MARKERS.some((value) => name.toLowerCase().includes(value))
    )
    if (column !== undefined) {
      throw new Error(
        `Project database persists a forbidden MinerU capability column: ${object.name}.${column.name}`
      )
    }
  }

  for (const table of objects.filter(({ sql }) => sql?.toLowerCase().startsWith('create table'))) {
    const columns = database
      .prepare(`PRAGMA table_info(${quoteIdentifier(table.name)})`)
      .all() as Array<{ name: string; type: string }>
    for (const column of columns.filter(({ type }) => /char|clob|text|blob/i.test(type))) {
      const columnName = quoteIdentifier(column.name)
      const tableName = quoteIdentifier(table.name)
      const row = database
        .prepare(
          `SELECT 1 FROM ${tableName}
             WHERE lower(CAST(${columnName} AS TEXT)) LIKE '%signature=%'
                OR lower(CAST(${columnName} AS TEXT)) LIKE '%_url_ciphertext%'
                OR lower(CAST(${columnName} AS TEXT)) LIKE '%recovery_capability%'
             LIMIT 1`
        )
        .get()
      if (row !== undefined) {
        throw new Error(
          `Project database contains a forbidden MinerU capability value in ${table.name}.${column.name}`
        )
      }
    }
  }
}

/** Verify that the durable queue contains only the CP19.5 job vocabulary. */
export function assertJobPersistenceBoundary(database: Database.Database): void {
  const rows = database.prepare('SELECT type, state FROM jobs').all() as Array<{
    type: string
    state: string
  }>
  const invalidTypes = rows.map(({ type }) => type).filter((type) => !DURABLE_JOB_TYPES.has(type))
  const paused = rows.filter(({ state }) => state === 'paused').length
  const schemaRows = database
    .prepare("SELECT name, sql FROM sqlite_master WHERE name IN ('jobs', 'job_transitions')")
    .all() as Array<{ name: string; sql: string | null }>
  const pausedSchema = schemaRows.some(({ sql }) => sql?.toLowerCase().includes("'paused'"))
  if (invalidTypes.length > 0 || paused > 0 || pausedSchema) {
    const details = [
      ...(invalidTypes.length === 0 ? [] : [`types=${[...new Set(invalidTypes)].join(',')}`]),
      ...(paused === 0 ? [] : [`paused=${paused}`]),
      ...(pausedSchema ? ['paused_schema=true'] : [])
    ].join(' ')
    throw new Error(`Project database durable job boundary violated: ${details}`)
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}
