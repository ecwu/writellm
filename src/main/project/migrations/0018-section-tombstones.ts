import type { DatabaseMigration } from '../../db/migrations'

export const migration0018: DatabaseMigration = {
  version: 18,
  name: '0018-section-tombstones',
  checksum: 'sha256:8b40137774a818022f3259a4cba2eb708f73d70e614ea924bcc73fbc38c4196b',
  up(database) {
    database.exec(`
      ALTER TABLE sections
        ADD COLUMN deleted_at TEXT
        CHECK (deleted_at IS NULL OR length(deleted_at) BETWEEN 20 AND 64);

      DROP INDEX sections_unique_root_position;
      DROP INDEX sections_unique_child_position;
      DROP INDEX sections_outline_order;

      CREATE UNIQUE INDEX sections_unique_root_position
        ON sections(manuscript_id, position)
        WHERE parent_section_id IS NULL AND deleted_at IS NULL;

      CREATE UNIQUE INDEX sections_unique_child_position
        ON sections(manuscript_id, parent_section_id, position)
        WHERE parent_section_id IS NOT NULL AND deleted_at IS NULL;

      CREATE INDEX sections_outline_order
        ON sections(manuscript_id, parent_section_id, position)
        WHERE deleted_at IS NULL;
    `)
  }
}
