import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import {
  initializeProjectDatabase,
  openProjectDatabase,
  PROJECT_SCHEMA_VERSION,
  type ProjectDatabase
} from '../project-database'
import type { ProjectManifest } from '../project-manifest'
import { PROJECT_DATABASE_RELATIVE_PATH } from '../project-paths'

const roots: string[] = []
const log = pino({ level: 'silent' })

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })))
})

describe('migration 0019 section proposal refresh', () => {
  it('preserves every existing status and adds an auditable unique refresh chain', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-migration-0019-'))
    roots.push(root)
    const projectRoot = join(root, 'project')
    await mkdir(projectRoot)
    const manifest: ProjectManifest = {
      format: 'writellm-project',
      formatVersion: 1,
      projectId: '019c6a5c-8d34-7a8e-a602-3d37a52dc600',
      createdAt: '2026-07-22T00:00:00.000Z'
    }
    const initialized = await initializeProjectDatabase({
      projectRoot,
      manifest,
      applicationVersion: 'before-0019',
      log
    })
    seedV18ProposalRows(initialized)
    initialized.close()

    const databasePath = join(projectRoot, PROJECT_DATABASE_RELATIVE_PATH)
    const legacy = new Database(databasePath)
    legacy.pragma('foreign_keys = OFF')
    restoreV18MutationProposalTable(legacy)
    legacy.exec(`
      DROP TABLE manuscript_annotations;
      DROP TABLE manuscript_asset_variants;
      DROP TABLE agent_change_set_commands;
      DROP INDEX agent_runs_writing_task_idx;
      ALTER TABLE agent_runs DROP COLUMN writing_task_step_id;
      ALTER TABLE agent_runs DROP COLUMN writing_task_id;
      DROP TABLE agent_writing_tasks;
      DROP TABLE review_issue_events;
      DROP TABLE review_issues;
      UPDATE section_revisions
      SET content_schema_version = 2, count_algorithm_version = 1;
      DELETE FROM schema_migrations WHERE version >= 19;
      UPDATE schema_manifest SET schema_version = 18 WHERE id = 1;
      PRAGMA user_version = 18;
    `)
    legacy.pragma('foreign_keys = ON')
    expect(legacy.pragma('foreign_key_check')).toEqual([])
    legacy.close()

    const upgraded = await openProjectDatabase({
      projectRoot,
      manifest,
      applicationVersion: 'after-0019',
      log
    })
    expect(
      upgraded.immediate((database) =>
        database.prepare('SELECT status FROM mutation_proposals ORDER BY status').pluck().all()
      )
    ).toEqual(['applied', 'approved', 'failed', 'pending', 'rejected', 'undone'])
    expect(
      upgraded.immediate((database) =>
        database
          .prepare(
            "SELECT event_schema_version FROM agent_sessions WHERE agent_session_id = 'session-0019'"
          )
          .pluck()
          .get()
      )
    ).toBe(2)
    expect(
      upgraded.immediate((database) =>
        database
          .prepare('SELECT COUNT(*) FROM mutation_proposals WHERE replaces_proposal_id IS NULL')
          .pluck()
          .get()
      )
    ).toBe(6)
    expect(
      upgraded.immediate((database) =>
        String(
          database
            .prepare("SELECT sql FROM sqlite_schema WHERE name = 'mutation_proposals'")
            .pluck()
            .get()
        )
      )
    ).toContain("'superseded', 'conflicted', 'satisfied'")

    upgraded.immediate((database) => {
      clonePendingProposal(database, 'proposal-refreshed', 'proposal-pending')
      expect(() =>
        clonePendingProposal(database, 'proposal-duplicate-refresh', 'proposal-pending')
      ).toThrow()
    })
    expect(upgraded.immediate((database) => database.pragma('foreign_key_check'))).toEqual([])
    upgraded.immediate((database) =>
      database.prepare("DELETE FROM agent_sessions WHERE agent_session_id = 'session-0019'").run()
    )
    expect(
      upgraded.immediate((database) =>
        database.prepare('SELECT COUNT(*) FROM mutation_proposals').pluck().get()
      )
    ).toBe(0)
    expect(upgraded.immediate((database) => database.pragma('quick_check', { simple: true }))).toBe(
      'ok'
    )
    expect(upgraded.immediate((database) => database.pragma('foreign_key_check'))).toEqual([])
    expect(
      (await readdir(join(projectRoot, '.writellm', 'backups'))).some((name) =>
        name.includes(`-to-v${PROJECT_SCHEMA_VERSION}-`)
      )
    ).toBe(true)
    upgraded.close()
  })
})

function seedV18ProposalRows(database: ProjectDatabase): void {
  database.immediate((native) => {
    const now = '2026-07-22T00:00:00.000Z'
    const section = native
      .prepare('SELECT section_id, current_revision_id FROM sections LIMIT 1')
      .get() as { section_id: string; current_revision_id: string }
    const undoRevisionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc601'
    native
      .prepare(
        `INSERT INTO section_revisions (
           section_revision_id, section_id, revision_number, source, content_json,
           content_schema_version, content_hash, prior_revision_id, word_count,
           character_count, count_algorithm_version, agent_run_id, agent_tool_call_id,
           agent_proposal_id, created_at, content_body_retained, source_class
         )
         SELECT ?, section_id, 2, 'manual', content_json, content_schema_version,
           content_hash, section_revision_id, word_count, character_count,
           count_algorithm_version, NULL, NULL, NULL, ?, 1, 'manual_checkpoint'
         FROM section_revisions WHERE section_revision_id = ?`
      )
      .run(undoRevisionId, now, section.current_revision_id)
    native
      .prepare(
        `INSERT INTO agent_sessions (
           agent_session_id, title, pi_runtime_version, event_schema_version,
           status, created_at, updated_at, archived_at
         ) VALUES ('session-0019', 'Migration session', 'test', 1, 'active', ?, ?, NULL)`
      )
      .run(now, now)
    native
      .prepare(
        `INSERT INTO agent_runs (
           agent_run_id, agent_session_id, status, provider_id, model_id,
           provider_fingerprint, model_fingerprint, editor_context_json,
           error_json, started_at, completed_at, created_at, updated_at
         ) VALUES ('run-0019', 'session-0019', 'running', 'provider', 'model',
           ?, ?, '{}', NULL, ?, NULL, ?, ?)`
      )
      .run('a'.repeat(64), 'b'.repeat(64), now, now, now)
    native
      .prepare(
        `INSERT INTO agent_events (
           agent_event_id, agent_session_id, agent_run_id, sequence, type,
           payload_json, model_request_id, created_at
         ) VALUES ('event-0019', 'session-0019', 'run-0019', 1, 'tool_call',
           '{}', NULL, ?)`
      )
      .run(now)

    const insert = native.prepare(
      `INSERT INTO mutation_proposals (
         mutation_proposal_id, agent_session_id, agent_run_id, tool_call_event_id,
         agent_tool_call_id, kind, payload_json, base_revision_id,
         base_brief_version, base_outline_version, status, decision_at,
         applied_revision_id, applied_brief_version, applied_outline_version,
         undo_revision_id, replaces_proposal_id, rejected_reason, created_at, updated_at
       ) VALUES (?, 'session-0019', 'run-0019', 'event-0019', ?, 'section_patch', '{}',
         ?, NULL, NULL, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?, ?)`
    )
    const rows = [
      ['proposal-pending', 'pending', null, null, null, null],
      ['proposal-approved', 'approved', now, null, null, null],
      ['proposal-rejected', 'rejected', now, null, null, 'Rejected before migration'],
      ['proposal-applied', 'applied', now, section.current_revision_id, null, null],
      ['proposal-failed', 'failed', now, null, null, 'Failed before migration'],
      ['proposal-undone', 'undone', now, section.current_revision_id, undoRevisionId, null]
    ] as const
    for (const [proposalId, status, decisionAt, appliedRevisionId, undoId, reason] of rows) {
      insert.run(
        proposalId,
        `tool-${proposalId}`,
        section.current_revision_id,
        status,
        decisionAt,
        appliedRevisionId,
        undoId,
        reason,
        now,
        now
      )
    }
  })
}

function restoreV18MutationProposalTable(database: Database.Database): void {
  database.exec(`
    DROP INDEX mutation_proposals_run_idx;
    DROP INDEX mutation_proposals_status_idx;
    ALTER TABLE mutation_proposals RENAME TO mutation_proposals_v19_fixture;

    CREATE TABLE mutation_proposals (
      mutation_proposal_id TEXT PRIMARY KEY NOT NULL,
      agent_session_id TEXT NOT NULL REFERENCES agent_sessions(agent_session_id) ON DELETE CASCADE,
      agent_run_id TEXT NOT NULL REFERENCES agent_runs(agent_run_id) ON DELETE CASCADE,
      tool_call_event_id TEXT NOT NULL REFERENCES agent_events(agent_event_id) ON DELETE RESTRICT,
      agent_tool_call_id TEXT NOT NULL CHECK (length(agent_tool_call_id) BETWEEN 1 AND 256),
      kind TEXT NOT NULL CHECK (kind IN ('brief_update', 'outline_patch', 'section_patch')),
      payload_json TEXT NOT NULL CHECK (
        length(CAST(payload_json AS BLOB)) <= 1048576
        AND json_valid(payload_json)
        AND json_type(payload_json) = 'object'
      ),
      base_revision_id TEXT REFERENCES section_revisions(section_revision_id) ON DELETE RESTRICT,
      base_brief_version INTEGER CHECK (base_brief_version IS NULL OR base_brief_version > 0),
      base_outline_version INTEGER CHECK (base_outline_version IS NULL OR base_outline_version > 0),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'approved', 'rejected', 'applied', 'failed', 'undone'
      )),
      decision_at TEXT,
      applied_revision_id TEXT REFERENCES section_revisions(section_revision_id) ON DELETE RESTRICT,
      applied_brief_version INTEGER CHECK (
        applied_brief_version IS NULL OR applied_brief_version > 0
      ),
      applied_outline_version INTEGER CHECK (
        applied_outline_version IS NULL OR applied_outline_version > 0
      ),
      undo_revision_id TEXT REFERENCES section_revisions(section_revision_id) ON DELETE RESTRICT,
      rejected_reason TEXT CHECK (rejected_reason IS NULL OR length(rejected_reason) <= 4096),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (
        (kind = 'brief_update' AND base_revision_id IS NULL
          AND base_brief_version IS NOT NULL AND base_outline_version IS NULL)
        OR
        (kind = 'outline_patch' AND base_revision_id IS NULL
          AND base_brief_version IS NULL AND base_outline_version IS NOT NULL)
        OR
        (kind = 'section_patch' AND base_revision_id IS NOT NULL
          AND base_brief_version IS NULL AND base_outline_version IS NULL)
      ),
      CHECK (
        (status = 'pending' AND decision_at IS NULL)
        OR (status <> 'pending' AND decision_at IS NOT NULL)
      ),
      CHECK (
        (status IN ('pending', 'approved', 'rejected', 'failed')
          AND applied_revision_id IS NULL
          AND applied_brief_version IS NULL
          AND applied_outline_version IS NULL
          AND undo_revision_id IS NULL)
        OR
        (status = 'applied' AND undo_revision_id IS NULL AND (
          (kind = 'brief_update' AND applied_revision_id IS NULL
            AND applied_brief_version = base_brief_version + 1
            AND applied_outline_version IS NULL)
          OR
          (kind = 'outline_patch' AND applied_revision_id IS NULL
            AND applied_brief_version IS NULL
            AND applied_outline_version = base_outline_version + 1)
          OR
          (kind = 'section_patch' AND applied_revision_id IS NOT NULL
            AND applied_brief_version IS NULL AND applied_outline_version IS NULL)
        ))
        OR
        (status = 'undone' AND kind = 'section_patch'
          AND applied_revision_id IS NOT NULL AND undo_revision_id IS NOT NULL
          AND applied_revision_id <> undo_revision_id
          AND applied_brief_version IS NULL AND applied_outline_version IS NULL)
      ),
      CHECK (
        (status IN ('rejected', 'failed') AND rejected_reason IS NOT NULL)
        OR (status NOT IN ('rejected', 'failed') AND rejected_reason IS NULL)
      )
    ) STRICT;

    INSERT INTO mutation_proposals (
      mutation_proposal_id, agent_session_id, agent_run_id, tool_call_event_id,
      agent_tool_call_id, kind, payload_json, base_revision_id, base_brief_version,
      base_outline_version, status, decision_at, applied_revision_id,
      applied_brief_version, applied_outline_version, undo_revision_id,
      rejected_reason, created_at, updated_at
    )
    SELECT
      mutation_proposal_id, agent_session_id, agent_run_id, tool_call_event_id,
      agent_tool_call_id, kind, payload_json, base_revision_id, base_brief_version,
      base_outline_version, status, decision_at, applied_revision_id,
      applied_brief_version, applied_outline_version, undo_revision_id,
      rejected_reason, created_at, updated_at
    FROM mutation_proposals_v19_fixture;

    DROP TABLE mutation_proposals_v19_fixture;
    CREATE INDEX mutation_proposals_run_idx
      ON mutation_proposals(agent_run_id, created_at);
    CREATE INDEX mutation_proposals_status_idx
      ON mutation_proposals(status, updated_at DESC);
  `)
}

function clonePendingProposal(
  database: Database.Database,
  proposalId: string,
  replacesProposalId: string
): void {
  database
    .prepare(
      `INSERT INTO mutation_proposals (
         mutation_proposal_id, agent_session_id, agent_run_id, tool_call_event_id,
         agent_tool_call_id, kind, payload_json, base_revision_id,
         base_brief_version, base_outline_version, status, decision_at,
         applied_revision_id, applied_brief_version, applied_outline_version,
         undo_revision_id, replaces_proposal_id, rejected_reason, created_at, updated_at
       )
       SELECT ?, agent_session_id, agent_run_id, tool_call_event_id,
         agent_tool_call_id, kind, payload_json, base_revision_id,
         base_brief_version, base_outline_version, 'pending', NULL,
         NULL, NULL, NULL, NULL, ?, NULL, created_at, updated_at
       FROM mutation_proposals WHERE mutation_proposal_id = 'proposal-pending'`
    )
    .run(proposalId, replacesProposalId)
}
