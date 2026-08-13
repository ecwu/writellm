import type { DatabaseMigration } from '../../db/migrations'

export const migration0008: DatabaseMigration = {
  version: 8,
  name: '0008-project-templates',
  checksum: 'sha256:5a94cf2847d5cc499d72964eff336271806f49432388407947b658873fa371bc',
  up(database) {
    database.exec(`
      CREATE TABLE project_templates (
        template_id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        description TEXT NOT NULL,
        schema_version INTEGER NOT NULL CHECK (schema_version = 1),
        relative_path TEXT NOT NULL UNIQUE,
        sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
        section_count INTEGER NOT NULL CHECK (section_count BETWEEN 1 AND 100),
        writing_rule_count INTEGER NOT NULL CHECK (writing_rule_count BETWEEN 0 AND 100),
        has_publication_preset INTEGER NOT NULL CHECK (has_publication_preset IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
  }
}
