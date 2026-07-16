import type { DatabaseMigration } from '../../db/migrations'

export const migration0013: DatabaseMigration = {
  version: 13,
  name: '0013-manuscript-revision-controls',
  checksum: 'sha256:5fc9f6e8d5f8623f0ca6c3f271d4f88e3bd7f0ef3b1edb7e5dbcc1b3dca8c0d0',
  up(database) {
    database.exec(`
      ALTER TABLE section_revisions ADD COLUMN source_class TEXT NOT NULL
        DEFAULT 'manual_autosave'
        CHECK (source_class IN ('manual_autosave', 'manual_checkpoint', 'agent_accepted', 'import'));

      UPDATE section_revisions SET source_class = 'import' WHERE source = 'import';
      UPDATE section_revisions SET source_class = 'agent_accepted' WHERE source = 'agent';
      UPDATE section_revisions SET source_class = 'manual_checkpoint'
       WHERE source IN ('bootstrap', 'undo');
    `)
  }
}
