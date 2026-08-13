import type { DatabaseMigration } from '../../db/migrations'

export const migration0035: DatabaseMigration = {
  version: 35,
  name: '0035-manuscript-asset-variants',
  checksum: 'sha256:854f67ceff7a708154a5d478418a60044558347559a54754d51ab5d6d4dbedce',
  up(database) {
    database.exec(`
      CREATE TABLE manuscript_asset_variants (
        manuscript_asset_variant_id TEXT PRIMARY KEY NOT NULL,
        parent_asset_id TEXT NOT NULL
          REFERENCES manuscript_assets(asset_id) ON DELETE RESTRICT,
        candidate_asset_id TEXT NOT NULL
          REFERENCES manuscript_assets(asset_id) ON DELETE RESTRICT,
        generation_proposal_id TEXT NOT NULL
          REFERENCES mutation_proposals(mutation_proposal_id) ON DELETE RESTRICT,
        candidate_model_request_id TEXT NOT NULL
          REFERENCES model_requests(model_request_id) ON DELETE RESTRICT,
        section_proposal_id TEXT
          REFERENCES mutation_proposals(mutation_proposal_id) ON DELETE RESTRICT,
        disposition TEXT NOT NULL CHECK (disposition IN ('replace', 'insert_after')),
        created_at TEXT NOT NULL,
        UNIQUE (parent_asset_id, candidate_asset_id, generation_proposal_id)
      ) STRICT;

      CREATE INDEX manuscript_asset_variants_parent_idx
        ON manuscript_asset_variants(parent_asset_id, created_at DESC);
      CREATE INDEX manuscript_asset_variants_candidate_idx
        ON manuscript_asset_variants(candidate_asset_id, created_at DESC);
      CREATE UNIQUE INDEX manuscript_asset_variants_section_proposal_idx
        ON manuscript_asset_variants(section_proposal_id)
        WHERE section_proposal_id IS NOT NULL;
    `)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) {
      throw new Error(
        `Manuscript asset variant migration foreign key check failed: ${JSON.stringify(violations)}`
      )
    }
  }
}
