import Database from 'better-sqlite3'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { blockNoteDocumentSchema } from '../../../shared/contracts/manuscript'
import { migrateDatabase } from '../../db/migrations'
import { projectMigrations } from '.'
import { migration0038 } from './0038-native-block-math-diagram-schema-v5'

describe('migration 0038 native block Math and Diagram schema v5', () => {
  it('projects the active v4 head while preserving history, IDs, assets, and relation tables', () => {
    const database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    migrateDatabase(database, {
      applicationVersion: 'test',
      databaseRole: 'project',
      migrations: projectMigrations.slice(0, 37),
      log: pino({ level: 'silent' })
    })
    const now = '2026-08-23T20:00:00.000Z'
    const legacyContent = [
      {
        id: 'paragraph-1',
        type: 'paragraph',
        props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
        content: [
          { type: 'text', text: 'Before ', styles: {} },
          { type: 'math', content: 'a+b' },
          { type: 'text', text: ' after', styles: {} }
        ],
        children: [
          {
            id: 'math-1',
            type: 'math',
            props: {
              textAlignment: 'center',
              source: '\\begin{aligned}x&=y\\end{aligned}',
              caption: 'A retained equation caption',
              previewWidth: 720
            },
            children: []
          }
        ]
      },
      {
        id: 'mermaid-1',
        type: 'mermaid',
        props: {
          textAlignment: 'center',
          source: 'graph TD\nA-->B',
          caption: 'Flow',
          previewWidth: 720
        },
        children: []
      }
    ]
    const legacyJson = JSON.stringify(legacyContent)

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
                       'revision-v4', ?, ?, NULL)`
          )
          .run(now, now)
        database
          .prepare(
            `INSERT INTO section_revisions (
               section_revision_id, section_id, revision_number, source, source_class,
               content_json, content_schema_version, content_hash, prior_revision_id, word_count,
               character_count, count_algorithm_version, agent_run_id, agent_tool_call_id,
               agent_proposal_id, created_at
             ) VALUES ('revision-v4', 'section-1', 1, 'manual', 'manual_checkpoint', ?, 4, ?,
                       NULL, 4, 20, 2, NULL, NULL, NULL, ?)`
          )
          .run(legacyJson, 'a'.repeat(64), now)
        database
          .prepare(
            `INSERT INTO section_materializations (
               section_id, section_revision_id, content_hash, relative_path, file_sha256,
               byte_size, envelope_schema_version, materialized_at
             ) VALUES ('section-1', 'revision-v4', ?, 'manuscript/sections/section-1.json', ?,
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
            '019d0000-0000-4000-8000-000000000680',
            'c'.repeat(64),
            'manuscript/assets/cc/asset.png',
            now,
            now
          )
        database
          .prepare(
            `INSERT INTO section_revision_assets (section_revision_id, asset_id)
             VALUES ('revision-v4', '019d0000-0000-4000-8000-000000000680')`
          )
          .run()
        database
          .prepare(
            `INSERT INTO manuscript_annotations (
               annotation_id, kind, status, body, section_id, block_id, anchor_revision_id,
               text_anchor, text_anchor_fingerprint, version, created_at, updated_at, resolved_at
             ) VALUES ('annotation-1', 'note', 'open', 'Keep this', 'section-1', 'paragraph-1',
                       'revision-v4', NULL, NULL, 1, ?, ?, NULL)`
          )
          .run(now, now)
      })
      .immediate()

    database.transaction(() => migration0038.up(database)).immediate()

    const revisions = database
      .prepare(
        `SELECT section_revision_id, revision_number, content_json, content_schema_version,
                content_hash, prior_revision_id, word_count, character_count
           FROM section_revisions ORDER BY revision_number`
      )
      .all() as Array<Record<string, unknown>>
    expect(revisions).toHaveLength(2)
    expect(revisions[0]).toMatchObject({
      section_revision_id: 'revision-v4',
      content_json: legacyJson,
      content_schema_version: 4,
      content_hash: 'a'.repeat(64)
    })
    expect(revisions[1]).toMatchObject({
      revision_number: 2,
      content_schema_version: 5,
      prior_revision_id: 'revision-v4'
    })
    expect(revisions[1]?.content_hash).not.toBe('a'.repeat(64))

    const migrated = blockNoteDocumentSchema.parse(JSON.parse(String(revisions[1]?.content_json)))
    expect(migrated.map((block) => block.type)).toEqual(['paragraph', 'diagram'])
    expect(migrated[0]?.id).toBe('paragraph-1')
    expect(migrated[0]?.children.map((block) => block.type)).toEqual(['mathBlock', 'paragraph'])
    expect(migrated[0]?.children[0]?.id).toBe('math-1')
    expect(migrated[0]?.children[1]?.content).toEqual([
      { type: 'text', text: 'A retained equation caption', styles: { italic: true } }
    ])
    expect(migrated[1]).toMatchObject({
      id: 'mermaid-1',
      type: 'diagram',
      props: { engine: 'mermaid', caption: 'Flow', altText: '' }
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
    ).toBe('019d0000-0000-4000-8000-000000000680')
    expect(
      database.prepare('SELECT anchor_revision_id FROM manuscript_annotations').pluck().get()
    ).toBe('revision-v4')
    expect(() =>
      database.prepare('UPDATE section_revisions SET content_schema_version = 6').run()
    ).toThrow('CHECK constraint failed')
    expect(database.pragma('foreign_key_check')).toEqual([])
    expect(database.pragma('integrity_check', { simple: true })).toBe('ok')
    database.close()
  })
})
