import type { DatabaseMigration } from '../../db/migrations'

const timestamp = '2026-08-13T00:00:00.000Z'

export const migration0007: DatabaseMigration = {
  version: 7,
  name: '0007-publication-presets',
  checksum: 'sha256:8c648dc480b4bc8b88497e1df764302336bc9992b5cd07a49c50c2be1560045d',
  up(database) {
    database.exec(`
      CREATE TABLE publication_presets (
        preset_id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        origin TEXT NOT NULL CHECK (origin IN ('application', 'user')),
        schema_version INTEGER NOT NULL CHECK (schema_version = 1),
        options_json TEXT NOT NULL,
        is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX publication_presets_one_default
        ON publication_presets(is_default) WHERE is_default = 1;
    `)
    const insert = database.prepare(`
      INSERT INTO publication_presets
        (preset_id, name, origin, schema_version, options_json, is_default, created_at, updated_at)
      VALUES (?, ?, 'application', 1, ?, ?, ?, ?)
    `)
    insert.run(
      'builtin:academic-a4',
      'Academic A4',
      JSON.stringify({
        schemaVersion: 1,
        pageSize: 'A4',
        marginsMm: { top: 25, right: 25, bottom: 25, left: 25 },
        template: 'academic',
        includeTableOfContents: true,
        includeReferences: true,
        mermaidFallback: 'rendered'
      }),
      1,
      timestamp,
      timestamp
    )
    insert.run(
      'builtin:report-letter',
      'Report Letter',
      JSON.stringify({
        schemaVersion: 1,
        pageSize: 'letter',
        marginsMm: { top: 20, right: 20, bottom: 20, left: 20 },
        template: 'report',
        includeTableOfContents: true,
        includeReferences: true,
        mermaidFallback: 'rendered'
      }),
      0,
      timestamp,
      timestamp
    )
    insert.run(
      'builtin:minimal-a4',
      'Minimal A4',
      JSON.stringify({
        schemaVersion: 1,
        pageSize: 'A4',
        marginsMm: { top: 20, right: 20, bottom: 20, left: 20 },
        template: 'minimal',
        includeTableOfContents: false,
        includeReferences: true,
        mermaidFallback: 'source'
      }),
      0,
      timestamp,
      timestamp
    )
  }
}
