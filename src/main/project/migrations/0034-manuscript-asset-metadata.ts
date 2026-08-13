import type { DatabaseMigration } from '../../db/migrations'

export const migration0034: DatabaseMigration = {
  version: 34,
  name: '0034-manuscript-asset-metadata',
  checksum: 'sha256:7b89f5f47c40ff0e9ed48c699457addf2803694234026d94367ab412cbf12ff9',
  up(database) {
    database.exec(`
      ALTER TABLE manuscript_assets ADD COLUMN width INTEGER
        CHECK (width IS NULL OR width BETWEEN 1 AND 8192);
      ALTER TABLE manuscript_assets ADD COLUMN height INTEGER
        CHECK (height IS NULL OR height BETWEEN 1 AND 8192);
      ALTER TABLE manuscript_assets ADD COLUMN deletion_state TEXT NOT NULL DEFAULT 'active'
        CHECK (deletion_state IN ('active', 'deleting'));
      CREATE INDEX manuscript_assets_workspace_idx
        ON manuscript_assets(deletion_state, created_at DESC, asset_id DESC);
      CREATE INDEX section_revision_assets_asset_idx
        ON section_revision_assets(asset_id, section_revision_id);
    `)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) {
      throw new Error(
        `Manuscript asset metadata migration foreign key check failed: ${JSON.stringify(violations)}`
      )
    }
  }
}
