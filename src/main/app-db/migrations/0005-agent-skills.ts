import type { DatabaseMigration } from '../../db/migrations'

export const migration0005: DatabaseMigration = {
  version: 5,
  name: '0005-agent-skills',
  checksum: 'sha256:2824180cc4228759c44ff8123fbd490ad104ca91ba07579e3eec764b3360b745',
  up(database) {
    database.exec(`
      CREATE TABLE agent_skills (
        skill_id TEXT PRIMARY KEY CHECK (length(skill_id) BETWEEN 1 AND 200),
        source_kind TEXT NOT NULL CHECK (source_kind IN ('curated', 'github')),
        catalog_id TEXT CHECK (catalog_id IS NULL OR length(catalog_id) BETWEEN 1 AND 200),
        repository TEXT NOT NULL CHECK (length(repository) BETWEEN 3 AND 201),
        directory TEXT NOT NULL CHECK (length(directory) BETWEEN 1 AND 500),
        commit_sha TEXT NOT NULL CHECK (
          length(commit_sha) = 40 AND commit_sha NOT GLOB '*[^a-f0-9]*'
        ),
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
        description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 1024),
        display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
        license_spdx TEXT CHECK (license_spdx IS NULL OR length(license_spdx) BETWEEN 1 AND 100),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        disable_model_invocation INTEGER NOT NULL DEFAULT 0
          CHECK (disable_model_invocation IN (0, 1)),
        integrity_status TEXT NOT NULL DEFAULT 'ready'
          CHECK (integrity_status IN ('ready', 'missing_files', 'integrity_failed')),
        manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
        installed_at TEXT NOT NULL,
        last_checked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX agent_skills_enabled_idx
        ON agent_skills(enabled, integrity_status, name);
      CREATE INDEX agent_skills_repository_idx
        ON agent_skills(repository, directory);
    `)
  }
}
