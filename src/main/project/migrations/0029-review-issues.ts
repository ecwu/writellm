import type { DatabaseMigration } from '../../db/migrations'

export const migration0029: DatabaseMigration = {
  version: 29,
  name: '0029-review-issues',
  checksum: 'sha256:1559fd8100fd6ae296d5091909ad4eae190465b2b2293474ab3991a585244ce8',
  up(database) {
    database.exec(`
      CREATE TABLE review_issues (
        review_issue_id TEXT PRIMARY KEY NOT NULL,
        fingerprint TEXT NOT NULL UNIQUE
          CHECK (length(fingerprint) = 64 AND fingerprint NOT GLOB '*[^0-9a-f]*'),
        priority TEXT NOT NULL CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
        category TEXT NOT NULL CHECK (category IN (
          'integrity', 'structure', 'citation', 'evidence', 'consistency', 'terminology',
          'translation', 'audience', 'style', 'objective', 'other'
        )),
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
        description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 8192),
        evidence_summary TEXT NOT NULL CHECK (length(evidence_summary) <= 8192),
        citation_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (
          length(CAST(citation_ids_json AS BLOB)) <= 8192
          AND json_valid(citation_ids_json) AND json_type(citation_ids_json) = 'array'
        ),
        source_kind TEXT NOT NULL CHECK (source_kind IN ('deterministic', 'semantic')),
        check_id TEXT CHECK (check_id IS NULL OR length(check_id) BETWEEN 1 AND 128),
        section_id TEXT,
        revision_id TEXT,
        block_id TEXT CHECK (block_id IS NULL OR length(block_id) BETWEEN 1 AND 256),
        source_agent_session_id TEXT REFERENCES agent_sessions(agent_session_id) ON DELETE SET NULL,
        source_agent_run_id TEXT REFERENCES agent_runs(agent_run_id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'open'
          CHECK (status IN ('open', 'in_progress', 'resolved', 'dismissed')),
        assigned_agent_session_id TEXT REFERENCES agent_sessions(agent_session_id) ON DELETE SET NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        resolved_by_proposal_id TEXT
          REFERENCES mutation_proposals(mutation_proposal_id) ON DELETE SET NULL,
        resolution_summary TEXT CHECK (
          resolution_summary IS NULL OR length(resolution_summary) <= 4096
        ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resolved_at TEXT,
        dismissed_at TEXT,
        CHECK (
          (section_id IS NULL AND revision_id IS NULL AND block_id IS NULL)
          OR (section_id IS NOT NULL AND revision_id IS NOT NULL)
        ),
        CHECK ((status = 'in_progress') = (assigned_agent_session_id IS NOT NULL)),
        CHECK ((status = 'resolved') = (resolved_at IS NOT NULL)),
        CHECK ((status = 'dismissed') = (dismissed_at IS NOT NULL))
      ) STRICT;

      CREATE TABLE review_issue_events (
        review_issue_event_id TEXT PRIMARY KEY NOT NULL,
        review_issue_id TEXT NOT NULL
          REFERENCES review_issues(review_issue_id) ON DELETE CASCADE,
        event_type TEXT NOT NULL CHECK (event_type IN (
          'created', 'refreshed', 'claimed', 'reassigned', 'released', 'resolved',
          'reopened', 'dismissed', 'priority_changed', 'proposal_linked'
        )),
        from_status TEXT CHECK (
          from_status IS NULL OR from_status IN ('open', 'in_progress', 'resolved', 'dismissed')
        ),
        to_status TEXT NOT NULL CHECK (
          to_status IN ('open', 'in_progress', 'resolved', 'dismissed')
        ),
        actor_kind TEXT NOT NULL CHECK (actor_kind IN ('agent', 'user', 'system')),
        actor_agent_session_id TEXT REFERENCES agent_sessions(agent_session_id) ON DELETE SET NULL,
        actor_agent_run_id TEXT REFERENCES agent_runs(agent_run_id) ON DELETE SET NULL,
        proposal_id TEXT REFERENCES mutation_proposals(mutation_proposal_id) ON DELETE SET NULL,
        summary TEXT CHECK (summary IS NULL OR length(summary) <= 4096),
        occurred_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX review_issues_status_priority_idx
        ON review_issues(status, priority, updated_at DESC, review_issue_id);
      CREATE INDEX review_issues_category_idx
        ON review_issues(category, updated_at DESC, review_issue_id);
      CREATE INDEX review_issues_section_idx
        ON review_issues(section_id, status, updated_at DESC)
        WHERE section_id IS NOT NULL;
      CREATE INDEX review_issues_source_run_idx
        ON review_issues(source_agent_run_id, created_at)
        WHERE source_agent_run_id IS NOT NULL;
      CREATE INDEX review_issue_events_issue_idx
        ON review_issue_events(review_issue_id, occurred_at, review_issue_event_id);
    `)
  }
}
