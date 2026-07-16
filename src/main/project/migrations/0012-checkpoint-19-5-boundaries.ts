import type { DatabaseMigration } from '../../db/migrations'

/**
 * Converges persisted state created by Checkpoints 15–19 to the CP19.5
 * recovery boundary. URL capabilities are dropped without attempting to
 * decrypt them. Interactive jobs are removed; durable stages are normalized
 * to their current single-purpose job names.
 */
export const migration0012: DatabaseMigration = {
  version: 12,
  name: '0012-checkpoint-19-5-boundaries',
  checksum: 'sha256:0bb3c76d2a9c0dd3f9586f83d3b60733f04e0d59f8f53f5cfb3a1ef8ea4fbf7a',
  up(database) {
    database.exec(`
      ALTER TABLE parse_tasks DROP COLUMN upload_url_ciphertext;
      ALTER TABLE parse_tasks DROP COLUMN download_url_ciphertext;

      UPDATE jobs SET type = 'mineru_parse'
       WHERE type IN ('mineru.submit', 'mineru.poll', 'mineru.download');
      UPDATE jobs SET type = 'normalize_parse_revision'
       WHERE type = 'mineru.normalize';
      UPDATE jobs SET type = 'build_index_generation'
       WHERE type = 'index.build';
      UPDATE jobs
         SET type = 'build_embedding_generation',
             payload_json = json_object(
               'generationId',
               COALESCE(json_extract(payload_json, '$.batchId'), 'legacy:' || job_id)
             )
       WHERE type = 'embedding.batch';
      UPDATE jobs SET type = 'remove_index_item'
       WHERE type = 'index.item-delete';
      UPDATE jobs
         SET type = 'rebuild_index',
             payload_json = json_object('generationId', 'legacy:' || job_id)
       WHERE type IN ('index.item-upsert', 'index.publish');
      UPDATE jobs
         SET type = 'rebuild_index',
             payload_json = json_object(
               'generationId',
               COALESCE(json_extract(payload_json, '$.generationId'), 'legacy:' || job_id)
             )
       WHERE type = 'index.rebuild';

      UPDATE jobs
         SET state = 'queued',
             completed_at = NULL,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE state = 'paused';

      DELETE FROM job_transitions
       WHERE job_id IN (SELECT job_id FROM jobs WHERE type IN ('import.validate', 'rerank.request'));
      DELETE FROM jobs WHERE type IN ('import.validate', 'rerank.request');
    `)
  }
}
