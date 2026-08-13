import Database from 'better-sqlite3'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { migrateDatabase } from '../../db/migrations'
import { projectMigrations } from '.'
import { migration0033 } from './0033-figure-metadata'

describe('migration 0033 figure metadata', () => {
  it('appends a v3 current revision while preserving immutable legacy content', () => {
    const database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    migrateDatabase(database, {
      applicationVersion: 'test',
      databaseRole: 'project',
      migrations: projectMigrations.slice(0, 32),
      log: pino({ level: 'silent' })
    })
    const now = '2026-08-13T03:00:00.000Z'
    const legacyContent = JSON.stringify([
      {
        id: 'image-block',
        type: 'image',
        props: {
          backgroundColor: 'default',
          textAlignment: 'center',
          name: 'Existing alternative',
          url: 'writellm-asset:019d0000-0000-4000-8000-000000000301',
          caption: 'Existing caption',
          showPreview: true,
          previewWidth: 720
        },
        children: []
      }
    ])
    database
      .transaction(() => {
        database
          .prepare(
            'INSERT INTO project_meta (singleton_id, project_id, created_at, updated_at) VALUES (1, ?, ?, ?)'
          )
          .run('project-1', now, now)
        database
          .prepare(
            `INSERT INTO manuscripts
             (manuscript_id, project_id, is_primary, outline_version, created_at, updated_at)
             VALUES ('manuscript-1', 'project-1', 1, 1, ?, ?)`
          )
          .run(now, now)
        database
          .prepare(
            `INSERT INTO sections (
               section_id, manuscript_id, parent_section_id, position, level, title, objective,
               status, current_revision_id, created_at, updated_at, deleted_at
             ) VALUES ('section-1', 'manuscript-1', NULL, 0, 1, 'Section', NULL, 'drafting',
                       'revision-1', ?, ?, NULL)`
          )
          .run(now, now)
        database
          .prepare(
            `INSERT INTO section_revisions (
               section_revision_id, section_id, revision_number, source, source_class,
               content_json, content_schema_version, content_hash, prior_revision_id, word_count,
               character_count, count_algorithm_version, agent_run_id, agent_tool_call_id,
               agent_proposal_id, created_at
             ) VALUES ('revision-1', 'section-1', 1, 'manual', 'manual_checkpoint', ?, 2, ?,
                       NULL, 2, 15, 2, NULL, NULL, NULL, ?)`
          )
          .run(legacyContent, 'a'.repeat(64), now)
        database
          .prepare(
            `INSERT INTO section_materializations (
               section_id, section_revision_id, content_hash, relative_path, file_sha256,
               byte_size, envelope_schema_version, materialized_at
             ) VALUES ('section-1', 'revision-1', ?, 'manuscript/sections/section-1.json', ?,
                       100, 1, ?)`
          )
          .run('a'.repeat(64), 'b'.repeat(64), now)
      })
      .immediate()

    database.transaction(() => migration0033.up(database)).immediate()

    const rows = database
      .prepare(
        `SELECT section_revision_id, revision_number, content_json, content_schema_version,
                prior_revision_id, source, source_class
           FROM section_revisions ORDER BY revision_number`
      )
      .all() as Array<Record<string, unknown>>
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      section_revision_id: 'revision-1',
      revision_number: 1,
      content_json: legacyContent,
      content_schema_version: 2,
      prior_revision_id: null
    })
    expect(rows[1]).toMatchObject({
      revision_number: 2,
      content_schema_version: 3,
      prior_revision_id: 'revision-1',
      source: 'import',
      source_class: 'import'
    })
    const migrated = JSON.parse(String(rows[1]?.content_json)) as Array<{
      props: { figureId: string; altText: string; caption: string }
    }>
    expect(migrated[0]?.props).toMatchObject({
      figureId: 'figure:section-1:image-block',
      altText: 'Existing alternative',
      caption: 'Existing caption'
    })
    expect(database.prepare('SELECT current_revision_id FROM sections').pluck().get()).toBe(
      rows[1]?.section_revision_id
    )
    expect(database.prepare('SELECT COUNT(*) FROM section_materializations').pluck().get()).toBe(0)
    expect(() =>
      database.prepare('UPDATE section_revisions SET content_schema_version = 4').run()
    ).toThrow('CHECK constraint failed')
    expect(database.pragma('foreign_key_check')).toEqual([])
    expect(
      (database.pragma('foreign_key_list(review_issues)') as Array<{ table: string }>).map(
        (foreignKey) => foreignKey.table
      )
    ).toContain('mutation_proposals')
    database.close()
  })
})
