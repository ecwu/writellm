import type { DatabaseMigration } from '../../db/migrations'

export const migration0005: DatabaseMigration = {
  version: 5,
  name: '0005-job-runtime-close',
  checksum: 'sha256:763ea39ce69c96e47c24080d6736cc0b9ff5410e0ff7306791df413f00353bc3',
  up(database) {
    database.exec(`
      ALTER TABLE jobs ADD COLUMN resume_same_attempt INTEGER NOT NULL DEFAULT 0
        CHECK (resume_same_attempt IN (0, 1));

      CREATE INDEX jobs_runtime_status
        ON jobs(updated_at DESC, job_id DESC);
    `)
  }
}
