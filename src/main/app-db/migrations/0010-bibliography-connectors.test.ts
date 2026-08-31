import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migration0010 } from './0010-bibliography-connectors'

describe('migration 0010 bibliography connectors', () => {
  it('keeps the external path in the application database connector record', () => {
    const database = new Database(':memory:')
    migration0010.up(database)
    database
      .prepare(
        `INSERT INTO bibliography_connectors VALUES (
          'connector-1', 'project-1', '/Users/test/library.json', 'library.json',
          'better-csl-json', 'ready', NULL, NULL, NULL,
          '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z'
        )`
      )
      .run()

    expect(
      database
        .prepare(
          'SELECT project_id, source_path, source_format, state FROM bibliography_connectors'
        )
        .get()
    ).toEqual({
      project_id: 'project-1',
      source_path: '/Users/test/library.json',
      source_format: 'better-csl-json',
      state: 'ready'
    })
    database.close()
  })
})
