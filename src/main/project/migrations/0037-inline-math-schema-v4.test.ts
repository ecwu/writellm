import Database from 'better-sqlite3'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { migrateDatabase } from '../../db/migrations'
import { projectMigrations } from '.'
import { migration0037 } from './0037-inline-math-schema-v4'

describe('migration 0037 inline math schema v4', () => {
  it('appends an identical v4 current revision and preserves the current relation graph', () => {
    const database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    migrateDatabase(database, {
      applicationVersion: 'test',
      databaseRole: 'project',
      migrations: projectMigrations.slice(0, 36),
      log: pino({ level: 'silent' })
    })
    const now = '2026-08-23T12:00:00.000Z'
    const contentJson = JSON.stringify([
      {
        id: 'paragraph-1',
        type: 'paragraph',
        props: {
          backgroundColor: 'default',
          textColor: 'default',
          textAlignment: 'left'
        },
        content: [{ type: 'text', text: 'alpha', styles: {} }],
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
             ) VALUES ('revision-1', 'section-1', 1, 'manual', 'manual_checkpoint', ?, 3, ?,
                       NULL, 1, 5, 2, NULL, NULL, NULL, ?)`
          )
          .run(contentJson, 'a'.repeat(64), now)
        database
          .prepare(
            `INSERT INTO section_materializations (
               section_id, section_revision_id, content_hash, relative_path, file_sha256,
               byte_size, envelope_schema_version, materialized_at
             ) VALUES ('section-1', 'revision-1', ?, 'manuscript/sections/section-1.json', ?,
                       100, 1, ?)`
          )
          .run('a'.repeat(64), 'b'.repeat(64), now)
        database
          .prepare(
            `INSERT INTO manuscript_assets (
               asset_id, sha256, byte_size, mime_type, extension, relative_path, source_type,
               original_name, generation_request_json, model_request_id, agent_run_id,
               agent_tool_call_id, created_at, last_referenced_at, width, height, deletion_state
             ) VALUES (?, ?, 10, 'image/png', '.png', ?, 'upload', 'figure.png', NULL, NULL,
                       NULL, NULL, ?, ?, 10, 10, 'active')`
          )
          .run(
            '019d0000-0000-4000-8000-000000000650',
            'c'.repeat(64),
            'manuscript/assets/cc/asset.png',
            now,
            now
          )
        database
          .prepare(
            `INSERT INTO section_revision_assets (section_revision_id, asset_id)
             VALUES ('revision-1', '019d0000-0000-4000-8000-000000000650')`
          )
          .run()
        database
          .prepare(
            `INSERT INTO manuscript_annotations (
               annotation_id, kind, status, body, section_id, block_id, anchor_revision_id,
               text_anchor, text_anchor_fingerprint, version, created_at, updated_at, resolved_at
             ) VALUES ('annotation-1', 'note', 'open', 'Keep this', 'section-1', 'paragraph-1',
                       'revision-1', NULL, NULL, 1, ?, ?, NULL)`
          )
          .run(now, now)
        database
          .prepare(
            `INSERT INTO review_issues (
               review_issue_id, fingerprint, priority, category, title, description,
               evidence_summary, citation_ids_json, source_kind, check_id, section_id,
               revision_id, block_id, status, version, created_at, updated_at
             ) VALUES ('issue-1', ?, 'P2', 'style', 'Issue', 'Description', '', '[]',
                       'deterministic', 'check', 'section-1', 'revision-1', 'paragraph-1',
                       'open', 1, ?, ?)`
          )
          .run('d'.repeat(64), now, now)
        database
          .prepare(
            `INSERT INTO review_issue_events (
               review_issue_event_id, review_issue_id, event_type, from_status, to_status,
               actor_kind, summary, occurred_at
             ) VALUES ('issue-event-1', 'issue-1', 'created', NULL, 'open', 'system', NULL, ?)`
          )
          .run(now)
      })
      .immediate()

    database.transaction(() => migration0037.up(database)).immediate()

    const revisions = database
      .prepare(
        `SELECT section_revision_id, revision_number, content_json, content_schema_version,
                content_hash, prior_revision_id, word_count, character_count, source, source_class
           FROM section_revisions ORDER BY revision_number`
      )
      .all() as Array<Record<string, unknown>>
    expect(revisions).toHaveLength(2)
    expect(revisions[0]).toMatchObject({
      section_revision_id: 'revision-1',
      content_json: contentJson,
      content_schema_version: 3,
      content_hash: 'a'.repeat(64)
    })
    expect(revisions[1]).toMatchObject({
      revision_number: 2,
      content_json: contentJson,
      content_schema_version: 4,
      content_hash: 'a'.repeat(64),
      prior_revision_id: 'revision-1',
      word_count: 1,
      character_count: 5,
      source: 'import',
      source_class: 'import'
    })
    const currentRevisionId = String(revisions[1]?.section_revision_id)
    expect(database.prepare('SELECT current_revision_id FROM sections').pluck().get()).toBe(
      currentRevisionId
    )
    expect(database.prepare('SELECT COUNT(*) FROM section_materializations').pluck().get()).toBe(0)
    expect(
      database
        .prepare('SELECT asset_id FROM section_revision_assets WHERE section_revision_id = ?')
        .pluck()
        .get(currentRevisionId)
    ).toBe('019d0000-0000-4000-8000-000000000650')
    expect(
      database.prepare('SELECT anchor_revision_id FROM manuscript_annotations').pluck().get()
    ).toBe('revision-1')
    expect(database.prepare('SELECT COUNT(*) FROM review_issue_events').pluck().get()).toBe(1)
    expect(
      database
        .prepare(
          "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name = 'manuscript_annotations_anchor_idx'"
        )
        .pluck()
        .get()
    ).toBe(1)
    expect(() =>
      database.prepare('UPDATE section_revisions SET content_schema_version = 5').run()
    ).toThrow('CHECK constraint failed')
    expect(database.pragma('foreign_key_check')).toEqual([])
    expect(database.pragma('integrity_check', { simple: true })).toBe('ok')
    database.close()
  })
})
