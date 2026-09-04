import type { DatabaseMigration } from '../../db/migrations'

export const migration0044: DatabaseMigration = {
  version: 44,
  name: '0044-manuscript-comments',
  checksum: 'sha256:4995e0b53f1a96c8f09d292ea0442e87369f88449f2681e5025a68556eb84ec4',
  up(database) {
    database.exec(`
      CREATE TABLE manuscript_comment_threads (
        thread_id TEXT PRIMARY KEY NOT NULL,
        section_id TEXT NOT NULL REFERENCES sections(section_id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        anchor_status TEXT NOT NULL CHECK (anchor_status IN ('attached', 'orphaned')),
        quote TEXT NOT NULL CHECK (length(quote) > 0 AND length(CAST(quote AS BLOB)) <= 131072),
        anchor_json TEXT NOT NULL CHECK (
          length(CAST(anchor_json AS BLOB)) <= 262144
          AND json_valid(anchor_json) AND json_type(anchor_json) = 'array'
        ),
        created_revision_id TEXT NOT NULL REFERENCES section_revisions(section_revision_id),
        current_revision_id TEXT NOT NULL REFERENCES section_revisions(section_revision_id),
        resolved_by TEXT CHECK (resolved_by IN ('author', 'agent')),
        resolution_note TEXT CHECK (resolution_note IS NULL OR length(CAST(resolution_note AS BLOB)) <= 65536),
        resolved_revision_id TEXT REFERENCES section_revisions(section_revision_id),
        resolved_at TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX manuscript_comment_threads_section_status
        ON manuscript_comment_threads(section_id, status, updated_at, thread_id)
        WHERE deleted_at IS NULL;

      CREATE TABLE manuscript_comment_messages (
        message_id TEXT PRIMARY KEY NOT NULL,
        thread_id TEXT NOT NULL REFERENCES manuscript_comment_threads(thread_id) ON DELETE CASCADE,
        author TEXT NOT NULL CHECK (author IN ('author', 'agent')),
        body TEXT NOT NULL CHECK (length(body) > 0 AND length(CAST(body AS BLOB)) <= 65536),
        agent_session_id TEXT REFERENCES agent_sessions(agent_session_id) ON DELETE SET NULL,
        agent_run_id TEXT REFERENCES agent_runs(agent_run_id) ON DELETE SET NULL,
        operation_id TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (thread_id, operation_id)
      ) STRICT;

      CREATE INDEX manuscript_comment_messages_thread
        ON manuscript_comment_messages(thread_id, created_at, message_id)
        WHERE deleted_at IS NULL;

      CREATE TABLE manuscript_comment_events (
        event_id TEXT PRIMARY KEY NOT NULL,
        thread_id TEXT NOT NULL REFERENCES manuscript_comment_threads(thread_id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN (
          'created', 'replied', 'edited', 'deleted', 'resolved', 'reopened',
          'delegated', 'verified', 'anchor_rebased', 'anchor_orphaned'
        )),
        actor TEXT NOT NULL CHECK (actor IN ('author', 'agent', 'system')),
        agent_session_id TEXT REFERENCES agent_sessions(agent_session_id) ON DELETE SET NULL,
        agent_run_id TEXT REFERENCES agent_runs(agent_run_id) ON DELETE SET NULL,
        proposal_id TEXT REFERENCES mutation_proposals(mutation_proposal_id) ON DELETE SET NULL,
        section_revision_id TEXT REFERENCES section_revisions(section_revision_id),
        payload_json TEXT NOT NULL DEFAULT '{}' CHECK (
          length(CAST(payload_json AS BLOB)) <= 65536
          AND json_valid(payload_json) AND json_type(payload_json) = 'object'
        ),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX manuscript_comment_events_thread
        ON manuscript_comment_events(thread_id, created_at, event_id);

      CREATE TABLE manuscript_comment_reads (
        agent_run_id TEXT NOT NULL REFERENCES agent_runs(agent_run_id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL REFERENCES manuscript_comment_threads(thread_id) ON DELETE CASCADE,
        thread_version INTEGER NOT NULL CHECK (thread_version > 0),
        section_revision_id TEXT NOT NULL REFERENCES section_revisions(section_revision_id),
        section_read_revision_id TEXT REFERENCES section_revisions(section_revision_id),
        read_at TEXT NOT NULL,
        PRIMARY KEY (agent_run_id, thread_id)
      ) STRICT;

      CREATE TRIGGER manuscript_comments_orphan_on_section_revision
      AFTER UPDATE OF current_revision_id ON sections
      WHEN OLD.current_revision_id IS NOT NEW.current_revision_id
      BEGIN
        UPDATE manuscript_comment_threads
        SET current_revision_id = NEW.current_revision_id,
            anchor_status = 'orphaned',
            version = version + 1,
            updated_at = NEW.updated_at
        WHERE section_id = NEW.section_id AND deleted_at IS NULL;
      END;

      CREATE TRIGGER manuscript_comments_reopen_on_proposal_undo
      AFTER UPDATE OF status ON mutation_proposals
      WHEN NEW.status = 'undone' AND OLD.status IS NOT NEW.status
      BEGIN
        UPDATE manuscript_comment_threads
        SET status = 'open', version = version + 1, resolved_by = NULL,
            resolution_note = NULL, resolved_revision_id = NULL, resolved_at = NULL,
            updated_at = NEW.updated_at
        WHERE thread_id IN (
          SELECT thread_id FROM manuscript_comment_events
          WHERE proposal_id = NEW.mutation_proposal_id AND type = 'resolved'
        ) AND status = 'resolved' AND deleted_at IS NULL;

        INSERT INTO manuscript_comment_events (
          event_id, thread_id, type, actor, section_revision_id, payload_json, created_at
        )
        SELECT lower(hex(randomblob(16))), t.thread_id, 'reopened', 'system',
          t.current_revision_id, json_object('reason', 'linked_proposal_undone'), NEW.updated_at
        FROM manuscript_comment_threads t
        WHERE t.thread_id IN (
          SELECT thread_id FROM manuscript_comment_events
          WHERE proposal_id = NEW.mutation_proposal_id AND type = 'resolved'
        ) AND t.status = 'open' AND t.updated_at = NEW.updated_at AND t.deleted_at IS NULL;
      END;
    `)
  }
}
