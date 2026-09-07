import type { DatabaseMigration } from '../../db/migrations'

export const migration0046: DatabaseMigration = {
  version: 46,
  name: '0046-agent-message-replacements',
  checksum: 'sha256:52376c9fb4064d411dc9904edaf3fcf1d027f18ba2612d1050328073109a51f1',
  up(database) {
    database.exec(`
      CREATE TABLE agent_message_replacements (
        replacement_run_id TEXT PRIMARY KEY NOT NULL REFERENCES agent_runs(agent_run_id),
        agent_session_id TEXT NOT NULL REFERENCES agent_sessions(agent_session_id) ON DELETE CASCADE,
        target_event_id TEXT NOT NULL UNIQUE REFERENCES agent_events(agent_event_id),
        from_sequence INTEGER NOT NULL CHECK (from_sequence > 0),
        through_sequence INTEGER NOT NULL CHECK (through_sequence >= from_sequence),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX agent_message_replacements_session
        ON agent_message_replacements(agent_session_id, from_sequence, through_sequence);

      CREATE TABLE agent_edit_effects (
        effect_id TEXT PRIMARY KEY NOT NULL,
        agent_session_id TEXT NOT NULL REFERENCES agent_sessions(agent_session_id) ON DELETE CASCADE,
        after_sequence INTEGER NOT NULL CHECK (after_sequence >= 0)
      ) STRICT;
      CREATE INDEX agent_edit_effects_session ON agent_edit_effects(agent_session_id, after_sequence);

      INSERT INTO agent_edit_effects
      SELECT 'proposal:' || p.mutation_proposal_id, p.agent_session_id,
        COALESCE((SELECT MAX(e.sequence) FROM agent_events e
          WHERE e.agent_session_id = p.agent_session_id
            AND e.created_at <= CASE WHEN p.status = 'undone' THEN p.updated_at ELSE COALESCE(p.decision_at, p.updated_at) END), 0)
      FROM mutation_proposals p
      WHERE p.status IN ('applied', 'undone') OR p.applied_revision_id IS NOT NULL
        OR p.applied_brief_version IS NOT NULL OR p.applied_outline_version IS NOT NULL;

      INSERT INTO agent_edit_effects
      SELECT 'comment:' || c.event_id, c.agent_session_id,
        COALESCE((SELECT MAX(e.sequence) FROM agent_events e
          WHERE e.agent_session_id = c.agent_session_id AND e.created_at <= c.created_at), 0)
      FROM manuscript_comment_events c
      WHERE c.actor = 'agent' AND c.agent_session_id IS NOT NULL
        AND c.type IN ('created', 'replied', 'edited', 'deleted', 'resolved', 'reopened');

      CREATE TRIGGER agent_edit_proposal_effect AFTER UPDATE OF status ON mutation_proposals
      WHEN NEW.status IN ('applied', 'undone') AND NEW.status IS NOT OLD.status
      BEGIN
        INSERT INTO agent_edit_effects VALUES (
          'proposal:' || NEW.mutation_proposal_id || ':' || lower(hex(randomblob(16))), NEW.agent_session_id,
          COALESCE((SELECT MAX(sequence) FROM agent_events
            WHERE agent_session_id = NEW.agent_session_id), 0));
      END;
      CREATE TRIGGER agent_edit_comment_effect AFTER INSERT ON manuscript_comment_events
      WHEN NEW.actor = 'agent' AND NEW.agent_session_id IS NOT NULL
        AND NEW.type IN ('created', 'replied', 'edited', 'deleted', 'resolved', 'reopened')
      BEGIN
        INSERT INTO agent_edit_effects VALUES (
          'comment:' || NEW.event_id, NEW.agent_session_id,
          COALESCE((SELECT MAX(sequence) FROM agent_events
            WHERE agent_session_id = NEW.agent_session_id), 0));
      END;

      CREATE VIEW agent_effective_events AS
      SELECT e.* FROM agent_events e
      WHERE NOT EXISTS (
        SELECT 1 FROM agent_message_replacements r
        WHERE r.agent_session_id = e.agent_session_id AND (
          e.sequence BETWEEN r.from_sequence AND r.through_sequence
          OR (e.type = 'compaction_summary' AND e.sequence <= r.through_sequence
            AND COALESCE(json_extract(e.payload_json, '$.coveredThroughSequence'), 0) >= r.from_sequence)
        )
      );
    `)
  }
}
