import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openAppDatabase } from '../app-db/connection'
import {
  initializeProjectDatabase,
  openProjectDatabase,
  PROJECT_DATABASE_APPLICATION_ID,
  PROJECT_SCHEMA_VERSION
} from './project-database'
import type { ProjectManifest } from './project-manifest'
import { PROJECT_DATABASE_RELATIVE_PATH } from './project-paths'
import { sql } from 'kysely'
import type Database from 'better-sqlite3'

const temporaryDirectories: string[] = []
const log = pino({ level: 'silent' })

async function temporaryRoot(name: string): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'writellm-project-db-'))
  temporaryDirectories.push(parent)
  const root = join(parent, name)
  await mkdir(root)
  return root
}

function manifest(projectId: string): ProjectManifest {
  return {
    format: 'writellm-project',
    formatVersion: 1,
    projectId,
    createdAt: '2026-07-14T00:00:00.000Z'
  }
}

function restoreV5ManuscriptSchema(database: Database.Database): void {
  database.pragma('foreign_keys = OFF')
  dropAgentTraceSchema(database)
  database.exec(`
    DROP TRIGGER IF EXISTS manuscript_comments_orphan_on_section_revision;
    DROP TRIGGER IF EXISTS manuscript_comments_reopen_on_proposal_undo;
    DROP TABLE IF EXISTS manuscript_comment_changes;
    DROP TABLE IF EXISTS manuscript_comment_delegations;
    DROP TABLE IF EXISTS manuscript_comment_anchor_history;
    DROP TABLE IF EXISTS manuscript_comment_reads;
    DROP TABLE IF EXISTS manuscript_comment_events;
    DROP TABLE IF EXISTS manuscript_comment_messages;
    DROP TABLE IF EXISTS manuscript_comment_threads;
    DROP TABLE manuscript_asset_variants;
    DROP TABLE agent_change_set_commands;
    DROP TABLE active_parse_revisions;
    DROP TABLE normalization_runs;
    DROP TABLE parse_task_events;
    DROP TABLE parse_revisions;
    DROP TABLE parse_tasks;
    DROP TABLE agent_writing_tasks;
    DROP TABLE mutation_proposals;
    DROP TABLE agent_events;
    DROP TABLE agent_runs;
    DROP TABLE agent_sessions;
    DROP TABLE model_requests;
    DROP TABLE imports;
    DROP TABLE knowledge_items;
    DROP TABLE file_records;
    DROP TABLE section_materializations;
    DROP TABLE section_revisions;
    ALTER TABLE sections RENAME TO sections_v6_fixture;
    CREATE TABLE sections (
      section_id TEXT PRIMARY KEY NOT NULL,
      manuscript_id TEXT NOT NULL,
      parent_section_id TEXT,
      position INTEGER NOT NULL CHECK (position >= 0),
      level INTEGER NOT NULL CHECK (level >= 1),
      title TEXT NOT NULL,
      objective TEXT,
      status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'drafting', 'completed')),
      current_revision_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (manuscript_id) REFERENCES manuscripts(manuscript_id) ON DELETE CASCADE,
      FOREIGN KEY (manuscript_id, parent_section_id)
        REFERENCES sections(manuscript_id, section_id) ON DELETE RESTRICT,
      UNIQUE (manuscript_id, section_id)
    ) STRICT;
    INSERT INTO sections
    SELECT section_id, manuscript_id, parent_section_id, position, level, title, objective,
      status, NULL, created_at, updated_at
    FROM sections_v6_fixture;
    DROP TABLE sections_v6_fixture;
    CREATE UNIQUE INDEX sections_unique_root_position
      ON sections(manuscript_id, position) WHERE parent_section_id IS NULL;
    CREATE UNIQUE INDEX sections_unique_child_position
      ON sections(manuscript_id, parent_section_id, position) WHERE parent_section_id IS NOT NULL;
    CREATE INDEX sections_outline_order
      ON sections(manuscript_id, parent_section_id, position);
    ALTER TABLE manuscripts DROP COLUMN outline_version;
    ALTER TABLE manuscript_briefs DROP COLUMN schema_version;
  `)
  database.pragma('foreign_keys = ON')
}

function dropAgentTraceSchema(database: Database.Database): void {
  database.exec(`
    DROP VIEW IF EXISTS agent_run_trace_v;
    DROP VIEW IF EXISTS agent_model_request_trace_v;
    DROP VIEW IF EXISTS agent_trace_document_v;
    DROP TABLE IF EXISTS agent_trace_records;
    DROP TABLE IF EXISTS model_request_traces;
    DROP TABLE IF EXISTS agent_trace_payloads;
  `)
}

function dropReferenceAuthoritySchema(database: Database.Database): void {
  database.exec(`
    DROP INDEX IF EXISTS knowledge_reference_links_primary_idx;
    DROP INDEX IF EXISTS knowledge_reference_links_knowledge_idx;
    DROP INDEX IF EXISTS reference_bindings_connector_idx;
    DROP INDEX IF EXISTS reference_creators_name_idx;
    DROP INDEX IF EXISTS reference_items_year_idx;
    DROP INDEX IF EXISTS reference_items_title_idx;
    DROP TABLE IF EXISTS knowledge_reference_links;
    DROP TABLE IF EXISTS reference_import_bindings;
    DROP TABLE IF EXISTS reference_creators;
    DROP TABLE IF EXISTS reference_settings;
    DROP TABLE IF EXISTS reference_items;
  `)
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('project database', () => {
  it('adds writing-skill provenance without rebuilding the model operation-kind boundary', async () => {
    const root = await temporaryRoot('skill-migration')
    const database = await initializeProjectDatabase({
      projectRoot: root,
      manifest: manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc099'),
      applicationVersion: '1.0.0-test',
      log
    })
    const evidence = database.immediate((native) => ({
      agentRunColumns: native.prepare('PRAGMA table_info(agent_runs)').all() as Array<{
        name: string
        dflt_value: string | null
      }>,
      modelRequestSql: (
        native
          .prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'model_requests'")
          .get() as { sql: string }
      ).sql
    }))
    expect(evidence.agentRunColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['skill_snapshot_json', 'skill_route_model_request_id'])
    )
    expect(evidence.modelRequestSql).toContain("delivery IS NULL OR delivery = 'skill_route'")
    expect(evidence.modelRequestSql).toContain("'agent', 'embedding', 'rerank'")
    expect(evidence.modelRequestSql).not.toContain("operation_kind IN ('skill_route'")
    database.close()
  })

  it('isolates project data from other projects and the app database', async () => {
    const firstRoot = await temporaryRoot('项目一')
    const secondRoot = await temporaryRoot('项目二')
    const firstManifest = manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc001')
    const secondManifest = manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc002')
    const first = await initializeProjectDatabase({
      projectRoot: firstRoot,
      manifest: firstManifest,
      applicationVersion: '1.0.0-test',
      log
    })
    const second = await initializeProjectDatabase({
      projectRoot: secondRoot,
      manifest: secondManifest,
      applicationVersion: '1.0.0-test',
      log
    })
    expect(
      await first.kysely.selectFrom('project_meta').select('project_id').executeTakeFirstOrThrow()
    ).toEqual({ project_id: firstManifest.projectId })
    expect(
      await second.kysely.selectFrom('project_meta').select('project_id').executeTakeFirstOrThrow()
    ).toEqual({ project_id: secondManifest.projectId })
    expect(await first.kysely.selectFrom('manuscripts').selectAll().execute()).toHaveLength(1)
    expect(await first.kysely.selectFrom('manuscript_briefs').selectAll().execute()).toHaveLength(1)
    expect(await first.kysely.selectFrom('sections').selectAll().execute()).toHaveLength(1)

    const app = await openAppDatabase({
      path: join(await temporaryRoot('user-data'), 'app.sqlite'),
      applicationVersion: '1.0.0-test',
      log
    })
    const appTables = await sql<{
      name: string
    }>`SELECT name FROM sqlite_schema WHERE type = 'table'`.execute(app.kysely)
    expect(appTables.rows.map((row) => row.name)).not.toContain('project_meta')

    const applicationId = await sql<{ application_id: number }>`PRAGMA application_id`.execute(
      first.kysely
    )
    expect(applicationId.rows[0]?.application_id).toBe(PROJECT_DATABASE_APPLICATION_ID)
    first.close()
    second.close()
    app.close()
  })

  it('creates the singleton manuscript, first brief, and initial section atomically', async () => {
    const root = await temporaryRoot('初始文稿')
    const projectManifest = manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc008')
    const database = await initializeProjectDatabase({
      projectRoot: root,
      manifest: projectManifest,
      applicationVersion: '1.0.0-test',
      log
    })

    const manuscript = await database.kysely
      .selectFrom('manuscripts')
      .selectAll()
      .executeTakeFirstOrThrow()
    expect(manuscript.project_id).toBe(projectManifest.projectId)
    expect(manuscript.is_primary).toBe(1)
    expect(
      await database.kysely
        .selectFrom('manuscript_briefs')
        .select(['manuscript_id', 'version', 'title', 'extensible_json'])
        .executeTakeFirstOrThrow()
    ).toEqual({
      manuscript_id: manuscript.manuscript_id,
      version: 1,
      title: 'Untitled Manuscript',
      extensible_json: '{}'
    })
    expect(
      await database.kysely
        .selectFrom('sections')
        .select([
          'manuscript_id',
          'parent_section_id',
          'position',
          'level',
          'title',
          'status',
          'current_revision_id',
          'deleted_at'
        ])
        .executeTakeFirstOrThrow()
    ).toEqual({
      manuscript_id: manuscript.manuscript_id,
      parent_section_id: null,
      position: 0,
      level: 1,
      title: 'Untitled Section',
      status: 'planned',
      current_revision_id: expect.any(String),
      deleted_at: null
    })
    expect(
      database.immediate(
        (current) =>
          current
            .prepare(
              "SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = 'sections_unique_root_position'"
            )
            .pluck()
            .get() as string
      )
    ).toContain('deleted_at IS NULL')
    expect(await database.kysely.selectFrom('section_revisions').selectAll().execute()).toEqual([
      expect.objectContaining({
        section_revision_id: expect.any(String),
        revision_number: 1,
        source: 'bootstrap',
        content_json: '[]'
      })
    ])
    database.close()
  })

  it('reopens when user-authored content mentions MinerU capability markers', async () => {
    const root = await temporaryRoot('凭证术语文稿')
    const projectManifest = manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc018')
    const objective =
      'Compare signature=, encrypted_url_ciphertext, and recovery_capability handling.'
    const database = await initializeProjectDatabase({
      projectRoot: root,
      manifest: projectManifest,
      applicationVersion: '1.0.0-test',
      log
    })
    const section = await database.kysely
      .selectFrom('sections')
      .select('section_id')
      .executeTakeFirstOrThrow()
    await database.kysely
      .updateTable('sections')
      .set({ objective })
      .where('section_id', '=', section.section_id)
      .executeTakeFirstOrThrow()
    database.close()

    const reopened = await openProjectDatabase({
      projectRoot: root,
      manifest: projectManifest,
      applicationVersion: '1.0.0-test',
      log
    })
    expect(
      await reopened.kysely
        .selectFrom('sections')
        .select('objective')
        .where('section_id', '=', section.section_id)
        .executeTakeFirstOrThrow()
    ).toEqual({ objective })
    reopened.close()
  })

  it('materializes the strict CP19.5 job vocabulary without a paused schema state', async () => {
    const root = await temporaryRoot('严格任务状态')
    const projectManifest = manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc009')
    const database = await initializeProjectDatabase({
      projectRoot: root,
      manifest: projectManifest,
      applicationVersion: '1.0.0-test',
      log
    })
    const schema = database.immediate(
      (native) =>
        native
          .prepare("SELECT name, sql FROM sqlite_master WHERE name IN ('jobs', 'job_transitions')")
          .all() as Array<{ name: string; sql: string }>
    )
    expect(schema).toHaveLength(2)
    expect(schema.every((entry) => !entry.sql.toLowerCase().includes("'paused'"))).toBe(true)
    expect(
      database.immediate((native) =>
        native.prepare("SELECT COUNT(*) FROM jobs WHERE state = 'paused'").pluck().get()
      )
    ).toBe(0)
    database.close()
  })

  it('upgrades a version 1 project database without inventing project content', async () => {
    const root = await temporaryRoot('迁移')
    const projectManifest = manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc009')
    const database = await initializeProjectDatabase({
      projectRoot: root,
      manifest: projectManifest,
      applicationVersion: '1.0.0-test',
      log
    })
    database.close()

    const native = new (await import('better-sqlite3')).default(
      join(root, PROJECT_DATABASE_RELATIVE_PATH)
    )
    native.pragma('foreign_keys = OFF')
    dropAgentTraceSchema(native)
    dropReferenceAuthoritySchema(native)
    native.exec(`
      DROP TRIGGER IF EXISTS manuscript_comments_orphan_on_section_revision;
    DROP TRIGGER IF EXISTS manuscript_comments_reopen_on_proposal_undo;
    DROP TABLE IF EXISTS manuscript_comment_changes;
    DROP TABLE IF EXISTS manuscript_comment_delegations;
    DROP TABLE IF EXISTS manuscript_comment_anchor_history;
    DROP TABLE IF EXISTS manuscript_comment_reads;
    DROP TABLE IF EXISTS manuscript_comment_events;
    DROP TABLE IF EXISTS manuscript_comment_messages;
    DROP TABLE IF EXISTS manuscript_comment_threads;
    DROP TABLE manuscript_asset_variants;
      DROP TABLE agent_change_set_commands;
      DROP TABLE active_parse_revisions;
      DROP TABLE normalization_runs;
      DROP TABLE parse_task_events;
      DROP TABLE parse_revisions;
      DROP TABLE parse_tasks;
      DROP TABLE agent_writing_tasks;
      DROP TABLE mutation_proposals;
      DROP TABLE agent_events;
      DROP TABLE agent_runs;
      DROP TABLE agent_sessions;
      DROP TABLE model_requests;
      DROP TABLE imports;
      DROP TABLE knowledge_items;
      DROP TABLE file_records;
      DROP TABLE section_materializations;
      DROP TABLE section_revisions;
      DROP TABLE job_transitions;
      DROP TABLE jobs;
      DROP TABLE sections;
      DROP TABLE manuscript_briefs;
      DROP INDEX manuscripts_one_primary_per_project;
      DROP TABLE manuscripts;
      DROP INDEX IF EXISTS artifact_cleanup_requests_state_idx;
      DROP TABLE IF EXISTS artifact_cleanup_requests;
      DELETE FROM schema_migrations WHERE version >= 2;
      UPDATE schema_manifest SET schema_version = 1 WHERE id = 1;
      PRAGMA user_version = 1;
    `)
    native.close()

    const upgraded = await openProjectDatabase({
      projectRoot: root,
      manifest: projectManifest,
      applicationVersion: '1.0.0-test',
      log
    })
    expect(await upgraded.kysely.selectFrom('manuscripts').selectAll().execute()).toEqual([])
    expect(await upgraded.kysely.selectFrom('manuscript_briefs').selectAll().execute()).toEqual([])
    expect(await upgraded.kysely.selectFrom('sections').selectAll().execute()).toEqual([])
    const migrationBackups = await readdir(join(root, '.writellm', 'backups'))
    expect(migrationBackups.filter((name) => name.startsWith('migration-'))).toHaveLength(1)
    upgraded.close()
  })

  it('backs up and deterministically hardens a version 3 job database', async () => {
    const root = await temporaryRoot('作业迁移')
    const projectManifest = manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc014')
    const database = await initializeProjectDatabase({
      projectRoot: root,
      manifest: projectManifest,
      applicationVersion: '1.0.0-test',
      log
    })
    database.close()

    const native = new (await import('better-sqlite3')).default(
      join(root, PROJECT_DATABASE_RELATIVE_PATH)
    )
    native.pragma('foreign_keys = OFF')
    dropReferenceAuthoritySchema(native)
    restoreV5ManuscriptSchema(native)
    native.exec(`
      DROP TABLE job_transitions;
      DROP TABLE jobs;
      CREATE TABLE jobs (
        job_id TEXT PRIMARY KEY NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        state TEXT NOT NULL,
        priority INTEGER NOT NULL,
        attempts INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        run_after TEXT NOT NULL,
        lease_owner TEXT,
        locked_until TEXT,
        heartbeat_at TEXT,
        progress_json TEXT,
        deduplication_key TEXT,
        cancellation_requested INTEGER NOT NULL,
        error_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      ) STRICT;
      DROP INDEX IF EXISTS artifact_cleanup_requests_state_idx;
      DROP TABLE IF EXISTS artifact_cleanup_requests;
      DELETE FROM schema_migrations WHERE version >= 4;
      UPDATE schema_manifest SET schema_version = 3 WHERE id = 1;
      PRAGMA user_version = 3;
    `)
    const insert = native.prepare(`
      INSERT INTO jobs (
        job_id, type, payload_json, state, priority, attempts, max_attempts, run_after,
        lease_owner, locked_until, heartbeat_at, progress_json, deduplication_key,
        cancellation_requested, error_json, created_at, updated_at, started_at, completed_at
      ) VALUES (
        ?, 'build_index_generation', '{"generationId":"migration-g"}', 'running', 0, ?, ?,
        '2026-07-15T00:00:00.000Z', 'old-worker', '2026-07-15T01:00:00.000Z',
        NULL, NULL, NULL, ?, ?,
        '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:01.000Z',
        '2026-07-15T00:00:00.000Z', NULL
      )
    `)
    insert.run('running-queued', 1, 3, 0, null)
    insert.run('running-cancelled', 1, 3, 1, null)
    insert.run('running-exhausted', 1, 1, 0, null)
    native
      .prepare(`
        INSERT INTO jobs (
          job_id, type, payload_json, state, priority, attempts, max_attempts, run_after,
          lease_owner, locked_until, heartbeat_at, progress_json, deduplication_key,
          cancellation_requested, error_json, created_at, updated_at, started_at, completed_at
        ) VALUES (
          'legacy-paused', 'build_index_generation', '{"generationId":"paused-g"}', 'paused', 0, 0, 3,
          '2026-07-15T00:00:00.000Z', NULL, NULL, NULL, NULL, NULL, 0, NULL,
          '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:01.000Z', NULL, NULL
        )
      `)
      .run()
    native
      .prepare(`
        INSERT INTO jobs (
          job_id, type, payload_json, state, priority, attempts, max_attempts, run_after,
          lease_owner, locked_until, heartbeat_at, progress_json, deduplication_key,
          cancellation_requested, error_json, created_at, updated_at, started_at, completed_at
        ) VALUES (
          'legacy-failed', 'build_index_generation', '{"generationId":"legacy-g"}', 'failed', 0, 1, 1,
          '2026-07-15T00:00:00.000Z', NULL, NULL, NULL, NULL, NULL, 0,
          '{"code":"provider_error","message":"Authorization Bearer secret /Users/private","retryable":false,"attempt":1,"recordedAt":"2026-07-15T00:00:00.000Z"}',
          '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:01.000Z',
          '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:01.000Z'
        )
      `)
      .run()
    native.close()

    const upgraded = await openProjectDatabase({
      projectRoot: root,
      manifest: projectManifest,
      applicationVersion: '1.0.0-test',
      log
    })
    const rows = upgraded.immediate((current) =>
      current.prepare('SELECT * FROM jobs ORDER BY job_id').all()
    ) as Array<Record<string, unknown>>
    expect(rows.map(({ job_id, state }) => [job_id, state])).toEqual([
      ['legacy-failed', 'failed'],
      ['legacy-paused', 'queued'],
      ['running-cancelled', 'cancelled'],
      ['running-exhausted', 'failed'],
      ['running-queued', 'queued']
    ])
    for (const row of rows) {
      expect(row.lease_owner).toBeNull()
      expect(row.lease_token).toBeNull()
      expect(row.locked_until).toBeNull()
      expect(String(row.error_json)).not.toContain('secret')
      expect(String(row.error_json)).not.toContain('/Users/private')
    }
    const transitions = upgraded.immediate((current) =>
      current.prepare('SELECT event FROM job_transitions ORDER BY sequence').pluck().all()
    )
    expect(transitions).toHaveLength(5)
    expect(new Set(transitions)).toEqual(new Set(['migration_snapshot']))
    const jobsSchema = upgraded.immediate((current) =>
      current.prepare("SELECT sql FROM sqlite_schema WHERE name = 'jobs'").pluck().get()
    )
    expect(String(jobsSchema).toLowerCase()).not.toContain("'paused'")
    expect(rows.some(({ state }) => state === 'paused')).toBe(false)
    expect(upgraded.immediate((current) => current.pragma('quick_check', { simple: true }))).toBe(
      'ok'
    )
    expect(upgraded.immediate((current) => current.pragma('foreign_key_check'))).toEqual([])
    expect(
      (await readdir(join(root, '.writellm', 'backups'))).some((name) =>
        name.includes(`-to-v${PROJECT_SCHEMA_VERSION}-`)
      )
    ).toBe(true)
    upgraded.close()
  })

  it('backs up and deterministically upgrades populated version 5 manuscript data', async () => {
    const root = await temporaryRoot('文稿迁移')
    const projectManifest = manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc015')
    const database = await initializeProjectDatabase({
      projectRoot: root,
      manifest: projectManifest,
      applicationVersion: '1.0.0-test',
      log
    })
    const originalSection = await database.kysely
      .selectFrom('sections')
      .selectAll()
      .executeTakeFirstOrThrow()
    database.close()

    const native = new (await import('better-sqlite3')).default(
      join(root, PROJECT_DATABASE_RELATIVE_PATH)
    )
    native.pragma('foreign_keys = OFF')
    dropReferenceAuthoritySchema(native)
    restoreV5ManuscriptSchema(native)
    native.exec(`
      DROP INDEX IF EXISTS artifact_cleanup_requests_state_idx;
      DROP TABLE IF EXISTS artifact_cleanup_requests;
      DELETE FROM schema_migrations WHERE version >= 6;
      UPDATE schema_manifest SET schema_version = 5 WHERE id = 1;
      PRAGMA user_version = 5;
    `)
    native.close()

    const upgraded = await openProjectDatabase({
      projectRoot: root,
      manifest: projectManifest,
      applicationVersion: '1.0.0-test',
      log
    })
    const section = await upgraded.kysely
      .selectFrom('sections')
      .selectAll()
      .executeTakeFirstOrThrow()
    const revisions = await upgraded.kysely
      .selectFrom('section_revisions')
      .selectAll()
      .orderBy('revision_number', 'asc')
      .execute()
    const originalRevision = revisions[0]
    const currentRevision = revisions.at(-1)
    expect(section).toMatchObject({
      section_id: originalSection.section_id,
      title: originalSection.title,
      position: originalSection.position,
      status: originalSection.status,
      created_at: originalSection.created_at,
      current_revision_id: currentRevision?.section_revision_id
    })
    expect(originalRevision).toMatchObject({
      section_revision_id: `${originalSection.section_id}:revision:1`,
      section_id: originalSection.section_id,
      revision_number: 1,
      source: 'bootstrap',
      content_json: '[]',
      word_count: 0,
      character_count: 0
    })
    expect(currentRevision).toMatchObject({
      section_id: originalSection.section_id,
      revision_number: 4,
      source: 'import',
      content_json: '[]',
      content_schema_version: 5,
      prior_revision_id: revisions[2]?.section_revision_id,
      word_count: 0,
      character_count: 0
    })
    expect(upgraded.immediate((current) => current.pragma('quick_check', { simple: true }))).toBe(
      'ok'
    )
    expect(upgraded.immediate((current) => current.pragma('foreign_key_check'))).toEqual([])
    expect(
      (await readdir(join(root, '.writellm', 'backups'))).some((name) =>
        name.includes(`-to-v${PROJECT_SCHEMA_VERSION}-`)
      )
    ).toBe(true)
    upgraded.close()
  })

  it('rolls back version 6 when a version 5 section has an unexplained revision pointer', async () => {
    const root = await temporaryRoot('文稿迁移拒绝')
    const projectManifest = manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc016')
    const database = await initializeProjectDatabase({
      projectRoot: root,
      manifest: projectManifest,
      applicationVersion: '1.0.0-test',
      log
    })
    database.close()
    const databasePath = join(root, PROJECT_DATABASE_RELATIVE_PATH)
    const native = new (await import('better-sqlite3')).default(databasePath)
    restoreV5ManuscriptSchema(native)
    native.exec(`
      UPDATE sections SET current_revision_id = 'legacy-unknown';
      DELETE FROM schema_migrations WHERE version >= 6;
      UPDATE schema_manifest SET schema_version = 5 WHERE id = 1;
      PRAGMA user_version = 5;
    `)
    native.close()

    await expect(
      openProjectDatabase({
        projectRoot: root,
        manifest: projectManifest,
        applicationVersion: '1.0.0-test',
        log
      })
    ).rejects.toThrow('Failed to open project database')

    const unchanged = new (await import('better-sqlite3')).default(databasePath, {
      readonly: true,
      fileMustExist: true
    })
    expect(unchanged.pragma('user_version', { simple: true })).toBe(5)
    expect(unchanged.prepare('SELECT current_revision_id FROM sections').pluck().get()).toBe(
      'legacy-unknown'
    )
    expect(
      unchanged
        .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'section_revisions'")
        .get()
    ).toBeUndefined()
    unchanged.close()
  })

  it('keeps the original database and verified backup after migration failure', async () => {
    const root = await temporaryRoot('迁移失败')
    const projectManifest = manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc010')
    const database = await initializeProjectDatabase({
      projectRoot: root,
      manifest: projectManifest,
      applicationVersion: '1.0.0-test',
      log
    })
    database.close()

    const databasePath = join(root, PROJECT_DATABASE_RELATIVE_PATH)
    const native = new (await import('better-sqlite3')).default(databasePath)
    native.pragma('foreign_keys = OFF')
    dropAgentTraceSchema(native)
    dropReferenceAuthoritySchema(native)
    native.exec(`
      DROP TRIGGER IF EXISTS manuscript_comments_orphan_on_section_revision;
    DROP TRIGGER IF EXISTS manuscript_comments_reopen_on_proposal_undo;
    DROP TABLE IF EXISTS manuscript_comment_changes;
    DROP TABLE IF EXISTS manuscript_comment_delegations;
    DROP TABLE IF EXISTS manuscript_comment_anchor_history;
    DROP TABLE IF EXISTS manuscript_comment_reads;
    DROP TABLE IF EXISTS manuscript_comment_events;
    DROP TABLE IF EXISTS manuscript_comment_messages;
    DROP TABLE IF EXISTS manuscript_comment_threads;
    DROP TABLE manuscript_asset_variants;
      DROP TABLE agent_change_set_commands;
      DROP TABLE section_revisions;
      DROP TABLE job_transitions;
      DROP TABLE jobs;
      DROP TABLE sections;
      DROP TABLE manuscript_briefs;
      DROP INDEX manuscripts_one_primary_per_project;
      DROP TABLE manuscripts;
      DROP INDEX IF EXISTS artifact_cleanup_requests_state_idx;
      DROP TABLE IF EXISTS artifact_cleanup_requests;
      DELETE FROM schema_migrations WHERE version >= 2;
      UPDATE schema_manifest SET schema_version = 1 WHERE id = 1;
      PRAGMA user_version = 1;
      CREATE TABLE manuscripts (wrong_column TEXT) STRICT;
    `)
    native.close()
    const backups = join(root, '.writellm', 'backups')
    await mkdir(backups, { recursive: true })
    await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        writeFile(join(backups, `migration-old-${index}.sqlite`), `old-${index}`)
      )
    )

    await expect(
      openProjectDatabase({
        projectRoot: root,
        manifest: projectManifest,
        applicationVersion: '1.0.0-test',
        log
      })
    ).rejects.toThrow('Failed to open project database')

    const retained = await readdir(backups)
    expect(retained.filter((name) => name.startsWith('migration-old-'))).toHaveLength(4)
    expect(
      retained.filter((name) => name.includes(`-to-v${PROJECT_SCHEMA_VERSION}-`))
    ).toHaveLength(1)
    const original = new (await import('better-sqlite3')).default(databasePath, {
      readonly: true,
      fileMustExist: true
    })
    expect(original.prepare('SELECT project_id FROM project_meta').pluck().get()).toBe(
      projectManifest.projectId
    )
    expect(original.pragma('user_version', { simple: true })).toBe(1)
    original.close()
  })

  it('rejects a manifest and database identity mismatch before returning access', async () => {
    const root = await temporaryRoot('身份不匹配')
    const original = manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc003')
    const database = await initializeProjectDatabase({
      projectRoot: root,
      manifest: original,
      applicationVersion: '1.0.0-test',
      log
    })
    database.close()

    await expect(
      openProjectDatabase({
        projectRoot: root,
        manifest: manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc004'),
        applicationVersion: '1.0.0-test',
        log
      })
    ).rejects.toThrow('Failed to open project database')
  })

  it('logs the original identity validation error', async () => {
    const root = await temporaryRoot('日志')
    const original = manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc005')
    const database = await initializeProjectDatabase({
      projectRoot: root,
      manifest: original,
      applicationVersion: '1.0.0-test',
      log
    })
    database.close()
    const error = vi.fn()
    const spyLog = { info: vi.fn(), error } as unknown as typeof log

    await expect(
      openProjectDatabase({
        projectRoot: root,
        manifest: manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc006'),
        applicationVersion: '1.0.0-test',
        log: spyLog
      })
    ).rejects.toThrow()
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'db.open.failed',
        databaseRole: 'project',
        err: expect.any(Error)
      }),
      expect.any(String)
    )
  })

  it('does not accept an app database as a project database', async () => {
    const root = await temporaryRoot('角色')
    await mkdir(join(root, '.writellm'), { recursive: true })
    const app = await openAppDatabase({
      path: join(root, PROJECT_DATABASE_RELATIVE_PATH),
      applicationVersion: '1.0.0-test',
      log
    })
    app.close()

    await expect(
      openProjectDatabase({
        projectRoot: root,
        manifest: manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc007'),
        applicationVersion: '1.0.0-test',
        log
      })
    ).rejects.toThrow('Failed to open project database')
  })

  it('rejects a symbolic-link project database without touching the external target', async () => {
    const root = await temporaryRoot('数据库链接')
    const outsideRoot = await temporaryRoot('外部数据库')
    const projectManifest = manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc017')
    const database = await initializeProjectDatabase({
      projectRoot: root,
      manifest: projectManifest,
      applicationVersion: '1.0.0-test',
      log
    })
    database.close()
    const projectDatabasePath = join(root, PROJECT_DATABASE_RELATIVE_PATH)
    const outsidePath = join(outsideRoot, 'sentinel.sqlite')
    const outside = new (await import('better-sqlite3')).default(outsidePath)
    outside.exec(
      "CREATE TABLE sentinel (value TEXT NOT NULL); INSERT INTO sentinel VALUES ('safe')"
    )
    outside.close()
    const before = await readFile(outsidePath)
    await unlink(projectDatabasePath)
    await symlink(outsidePath, projectDatabasePath)

    await expect(
      openProjectDatabase({
        projectRoot: root,
        manifest: projectManifest,
        applicationVersion: '1.0.0-test',
        log
      })
    ).rejects.toMatchObject({ code: 'path_symbolic_link' })
    expect(await readFile(outsidePath)).toEqual(before)
    const verified = new (await import('better-sqlite3')).default(outsidePath, {
      readonly: true,
      fileMustExist: true
    })
    expect(verified.prepare('SELECT value FROM sentinel').pluck().get()).toBe('safe')
    expect(verified.pragma('application_id', { simple: true })).toBe(0)
    verified.close()
  })

  it('rejects an unrelated application-id-zero database before backup or mutation', async () => {
    const root = await temporaryRoot('无关数据库')
    await mkdir(join(root, '.writellm'))
    const databasePath = join(root, PROJECT_DATABASE_RELATIVE_PATH)
    const unrelated = new (await import('better-sqlite3')).default(databasePath)
    unrelated.exec(
      "CREATE TABLE sentinel (value TEXT NOT NULL); INSERT INTO sentinel VALUES ('safe')"
    )
    unrelated.close()
    const before = await readFile(databasePath)

    await expect(
      openProjectDatabase({
        projectRoot: root,
        manifest: manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc018'),
        applicationVersion: '1.0.0-test',
        log
      })
    ).rejects.toThrow('Failed to open project database')
    expect(await readFile(databasePath)).toEqual(before)
    await expect(access(join(root, '.writellm', 'backups'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    const verified = new (await import('better-sqlite3')).default(databasePath, {
      readonly: true,
      fileMustExist: true
    })
    expect(verified.pragma('application_id', { simple: true })).toBe(0)
    expect(verified.prepare('SELECT value FROM sentinel').pluck().get()).toBe('safe')
    verified.close()
  })

  it('rejects application ID zero even when project_meta matches the manifest', async () => {
    const root = await temporaryRoot('零应用身份')
    const projectManifest = manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc019')
    const database = await initializeProjectDatabase({
      projectRoot: root,
      manifest: projectManifest,
      applicationVersion: '1.0.0-test',
      log
    })
    database.close()
    const databasePath = join(root, PROJECT_DATABASE_RELATIVE_PATH)
    const forged = new (await import('better-sqlite3')).default(databasePath)
    forged.pragma('application_id = 0')
    forged.close()
    const before = await readFile(databasePath)

    await expect(
      openProjectDatabase({
        projectRoot: root,
        manifest: projectManifest,
        applicationVersion: '1.0.0-test',
        log
      })
    ).rejects.toThrow('Failed to open project database')
    expect(await readFile(databasePath)).toEqual(before)
    const verified = new (await import('better-sqlite3')).default(databasePath, {
      readonly: true,
      fileMustExist: true
    })
    expect(verified.pragma('application_id', { simple: true })).toBe(0)
    expect(verified.prepare('SELECT project_id FROM project_meta').pluck().get()).toBe(
      projectManifest.projectId
    )
    verified.close()
  }, 15_000)

  it('rejects a corrupt project database without creating migration artifacts', async () => {
    const root = await temporaryRoot('损坏数据库')
    await mkdir(join(root, '.writellm'))
    const databasePath = join(root, PROJECT_DATABASE_RELATIVE_PATH)
    const corrupt = Buffer.from('not-a-sqlite-database')
    await writeFile(databasePath, corrupt)

    await expect(
      openProjectDatabase({
        projectRoot: root,
        manifest: manifest('019c6a5c-8d34-7a8e-a602-3d37a52dc020'),
        applicationVersion: '1.0.0-test',
        log
      })
    ).rejects.toThrow('Failed to open project database')
    expect(await readFile(databasePath)).toEqual(corrupt)
    await expect(access(join(root, '.writellm', 'backups'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })
})
