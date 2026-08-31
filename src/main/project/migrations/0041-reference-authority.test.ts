import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migration0041 } from './0041-reference-authority'

describe('migration 0041 Reference authority', () => {
  it('backfills stored Knowledge without rewriting source identity or accepting unsafe keys', () => {
    const database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    database.exec(`
      CREATE TABLE knowledge_items (
        knowledge_item_id TEXT PRIMARY KEY NOT NULL,
        display_name TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO knowledge_items VALUES (
        '019c6a5c-8d34-7a8e-a602-3d37a52dc099',
        '研究：可靠引用',
        'stored',
        '2026-08-31T00:00:00.000Z',
        '2026-08-31T00:00:00.000Z'
      );
    `)

    migration0041.up(database)

    expect(
      database
        .prepare(
          `SELECT reference_id, citation_key, title, metadata_completeness, csl_json
             FROM reference_items`
        )
        .get()
    ).toEqual({
      reference_id: '019c6a5c-8d34-7a8e-a602-3d37a52dc099',
      citation_key: 'doc-019c6a5c8d347a8ea6023d37a52dc099',
      title: '研究：可靠引用',
      metadata_completeness: 'incomplete',
      csl_json:
        '{"id":"doc-019c6a5c8d347a8ea6023d37a52dc099","type":"document","title":"研究：可靠引用"}'
    })
    expect(database.prepare('SELECT * FROM knowledge_reference_links').get()).toMatchObject({
      reference_id: '019c6a5c-8d34-7a8e-a602-3d37a52dc099',
      knowledge_item_id: '019c6a5c-8d34-7a8e-a602-3d37a52dc099',
      relationship: 'primary'
    })
    expect(() =>
      database
        .prepare(
          `INSERT INTO reference_items VALUES (
            'bad', 'unsafe key', 'article-journal', 'Bad', NULL, NULL, NULL, NULL, NULL,
            '{"id":"unsafe key","type":"article-journal","title":"Bad"}',
            'complete', '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z'
          )`
        )
        .run()
    ).toThrow('CHECK constraint failed')
    database.close()
  })
})
