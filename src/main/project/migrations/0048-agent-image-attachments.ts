import type { DatabaseMigration } from '../../db/migrations'

export const migration0048: DatabaseMigration = {
  version: 48,
  name: '0048-agent-image-attachments',
  checksum: 'sha256:0d7278cb5bfa69cdc01c667459d5615684201d5b593e93e350c6b80fd05b23a8f',
  up(database) {
    database.exec(`
      CREATE TABLE agent_attachments (
        attachment_id TEXT PRIMARY KEY NOT NULL,
        agent_session_id TEXT NOT NULL REFERENCES agent_sessions(agent_session_id),
        name TEXT NOT NULL,
        original_sha256 TEXT NOT NULL,
        original_path TEXT NOT NULL UNIQUE,
        original_bytes INTEGER NOT NULL CHECK (original_bytes > 0),
        original_mime TEXT NOT NULL,
        original_width INTEGER NOT NULL CHECK (original_width > 0),
        original_height INTEGER NOT NULL CHECK (original_height > 0),
        image_sha256 TEXT NOT NULL,
        image_path TEXT NOT NULL UNIQUE,
        image_bytes INTEGER NOT NULL CHECK (image_bytes > 0),
        image_mime TEXT NOT NULL,
        image_width INTEGER NOT NULL CHECK (image_width BETWEEN 1 AND 2000),
        image_height INTEGER NOT NULL CHECK (image_height BETWEEN 1 AND 2000),
        created_at TEXT NOT NULL,
        released_at TEXT NOT NULL,
        deletion_state TEXT NOT NULL DEFAULT 'active' CHECK (deletion_state IN ('active', 'deleting'))
      ) STRICT;
      CREATE INDEX agent_attachment_owner ON agent_attachments(agent_session_id);
    `)
  }
}
