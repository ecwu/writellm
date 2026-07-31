import type { DatabaseMigration } from '../../db/migrations'

export const migration0004: DatabaseMigration = {
  version: 4,
  name: '0004-credential-bindings',
  checksum: 'sha256:fe22b56a75f6acc8f8d269942f56f0d787dbe770b31a50e03a672dc270f363a8',
  up(database) {
    database.exec(`
      ALTER TABLE encrypted_credentials
        ADD COLUMN binding_fingerprint TEXT
        CHECK (
          binding_fingerprint IS NULL
          OR binding_fingerprint NOT GLOB '*[^a-f0-9]*'
             AND length(binding_fingerprint) = 64
        );

      DELETE FROM encrypted_credentials
       WHERE provider_config_id IN (
         SELECT id
           FROM provider_configs
          WHERE json_extract(config_json, '$.role') IN (
                  'agent',
                  'embedding',
                  'rerank',
                  'mineru'
                )
             OR (
               json_extract(config_json, '$.role') = 'agent-preset'
               AND json_extract(config_json, '$.kind') = 'custom'
             )
       );
    `)
  }
}
