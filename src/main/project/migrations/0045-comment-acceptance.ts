import type { DatabaseMigration } from '../../db/migrations'

export const migration0045: DatabaseMigration = {
  version: 45,
  name: '0045-comment-acceptance',
  checksum: 'sha256:b12adf4085ec50677491b91b2f127738dc9429f1c01c3a8148dbb2cd51d51305',
  up(database) {
    database.exec(`
      ALTER TABLE manuscript_comment_threads ADD COLUMN anchor_revision_id TEXT REFERENCES section_revisions(section_revision_id);
      UPDATE manuscript_comment_threads SET anchor_revision_id = current_revision_id;
      CREATE TABLE manuscript_comment_anchor_history (
        thread_id TEXT NOT NULL REFERENCES manuscript_comment_threads(thread_id) ON DELETE CASCADE,
        revision_id TEXT NOT NULL REFERENCES section_revisions(section_revision_id),
        content_hash TEXT NOT NULL,
        anchor_json TEXT NOT NULL CHECK(json_valid(anchor_json)),
        anchor_status TEXT NOT NULL CHECK(anchor_status IN ('attached', 'orphaned')),
        PRIMARY KEY(thread_id, revision_id)
      ) STRICT;
      DELETE FROM manuscript_comment_reads;
      ALTER TABLE manuscript_comment_reads ADD COLUMN model_request_id TEXT;
      ALTER TABLE manuscript_comment_reads ADD COLUMN section_model_request_id TEXT;
      ALTER TABLE manuscript_comment_reads ADD COLUMN covered_blocks_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(covered_blocks_json));
      ALTER TABLE manuscript_comment_reads ADD COLUMN fragment_ranges_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(fragment_ranges_json));
      CREATE TABLE manuscript_comment_delegations (
        agent_session_id TEXT NOT NULL REFERENCES agent_sessions(agent_session_id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL REFERENCES manuscript_comment_threads(thread_id) ON DELETE CASCADE,
        agent_run_id TEXT REFERENCES agent_runs(agent_run_id) ON DELETE SET NULL,
        delegated_at TEXT NOT NULL,
        PRIMARY KEY(agent_session_id, thread_id)
      ) STRICT;
      CREATE TABLE manuscript_comment_changes (
        thread_id TEXT NOT NULL REFERENCES manuscript_comment_threads(thread_id) ON DELETE CASCADE,
        proposal_id TEXT NOT NULL REFERENCES mutation_proposals(mutation_proposal_id) ON DELETE CASCADE,
        PRIMARY KEY(thread_id, proposal_id)
      ) STRICT;
      DROP TRIGGER manuscript_comments_reopen_on_proposal_undo;
      CREATE TRIGGER manuscript_comments_reopen_on_proposal_undo
      AFTER UPDATE OF status ON mutation_proposals
      WHEN NEW.status = 'undone' AND OLD.status IS NOT NEW.status
      BEGIN
        INSERT INTO manuscript_comment_events (
          event_id, thread_id, type, actor, section_revision_id, payload_json, created_at
        )
        SELECT lower(hex(randomblob(16))), t.thread_id, 'reopened', 'system',
          t.current_revision_id, json_object('reason', 'linked_proposal_undone'), NEW.updated_at
        FROM manuscript_comment_threads t
        WHERE t.status = 'resolved' AND t.deleted_at IS NULL AND (
          SELECT e.proposal_id FROM manuscript_comment_events e
          WHERE e.thread_id = t.thread_id AND e.type = 'resolved'
          ORDER BY e.rowid DESC LIMIT 1
        ) = NEW.mutation_proposal_id;
        UPDATE manuscript_comment_threads
        SET status = 'open', version = version + 1, resolved_by = NULL,
            resolution_note = NULL, resolved_revision_id = NULL, resolved_at = NULL,
            updated_at = NEW.updated_at
        WHERE status = 'resolved' AND deleted_at IS NULL AND (
          SELECT e.proposal_id FROM manuscript_comment_events e
          WHERE e.thread_id = manuscript_comment_threads.thread_id AND e.type = 'resolved'
          ORDER BY e.rowid DESC LIMIT 1
        ) = NEW.mutation_proposal_id;
      END;
    `)
  }
}
