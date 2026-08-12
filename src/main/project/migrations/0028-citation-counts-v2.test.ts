import Database from 'better-sqlite3'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { migrateDatabase } from '../../db/migrations'
import { projectMigrations } from '.'
import { migration0028 } from './0028-citation-counts-v2'

describe('migration 0028 citation counts v2', () => {
  it('backfills retained bodies, preserves pruned history, and widens the version constraint', () => {
    const database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    migrateDatabase(database, {
      applicationVersion: 'test',
      databaseRole: 'project',
      migrations: projectMigrations.slice(0, 27),
      log: pino({ level: 'silent' })
    })
    const now = '2026-08-12T00:00:00.000Z'
    const retained = JSON.stringify([
      {
        id: 'block-1',
        type: 'paragraph',
        props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
        content: [{ type: 'text', text: 'Alpha[Source: Book, p. 2]Beta 中文', styles: {} }],
        children: []
      }
    ])
    database
      .transaction(() => {
        database.pragma('defer_foreign_keys = ON')
        database
          .prepare(
            'INSERT INTO project_meta (singleton_id, project_id, created_at, updated_at) VALUES (1, ?, ?, ?)'
          )
          .run('project-1', now, now)
        database
          .prepare(
            `INSERT INTO manuscripts
             (manuscript_id, project_id, is_primary, outline_version, created_at, updated_at)
           VALUES (?, ?, 1, 1, ?, ?)`
          )
          .run('manuscript-1', 'project-1', now, now)
        database
          .prepare(
            `INSERT INTO sections (
             section_id, manuscript_id, parent_section_id, position, level, title, objective,
             status, current_revision_id, created_at, updated_at, deleted_at
           ) VALUES (?, ?, NULL, 0, 1, 'Section', NULL, 'drafting', ?, ?, ?, NULL)`
          )
          .run('section-1', 'manuscript-1', 'revision-2', now, now)
        const insert = database.prepare(
          `INSERT INTO section_revisions (
           section_revision_id, section_id, revision_number, source, content_json,
           content_schema_version, content_hash, prior_revision_id, word_count, character_count,
           count_algorithm_version, agent_run_id, agent_tool_call_id, agent_proposal_id, created_at,
           content_body_retained, source_class
         ) VALUES (?, 'section-1', ?, 'manual', ?, 2, ?, ?, ?, ?, 1, NULL, NULL, NULL, ?, ?, ?)`
        )
        insert.run('revision-1', 1, '[]', 'a'.repeat(64), null, 9, 99, now, 0, 'manual_checkpoint')
        insert.run(
          'revision-2',
          2,
          retained,
          'b'.repeat(64),
          'revision-1',
          99,
          999,
          now,
          1,
          'manual_autosave'
        )
      })
      .immediate()

    database.transaction(() => migration0028.up(database)).immediate()

    expect(
      database
        .prepare(
          `SELECT revision_number, word_count, character_count, count_algorithm_version
             FROM section_revisions ORDER BY revision_number`
        )
        .all()
    ).toEqual([
      { revision_number: 1, word_count: 9, character_count: 99, count_algorithm_version: 1 },
      { revision_number: 2, word_count: 4, character_count: 11, count_algorithm_version: 2 }
    ])
    expect(() =>
      database.prepare('UPDATE section_revisions SET count_algorithm_version = 3').run()
    ).toThrow('CHECK constraint failed')
    expect(database.pragma('foreign_key_check')).toEqual([])
    database.close()
  })
})
