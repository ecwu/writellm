import type { DatabaseMigration } from '../../db/migrations'

export const migration0001: DatabaseMigration = {
  version: 1,
  name: '0001-project-foundation',
  checksum: 'sha256:14788e8efc005e48ce037937af7b3dc42fa1d40c3a61e7aaab5ba58b481762a6',
  up(database) {
    database.exec(`
      CREATE TABLE project_meta (
        singleton_id INTEGER PRIMARY KEY NOT NULL CHECK (singleton_id = 1),
        project_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;    `)
  }
}
