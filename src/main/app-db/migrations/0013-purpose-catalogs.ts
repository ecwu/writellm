import { providerConfigSchema, speechSourceConfigSchema } from '../../../shared/contracts/providers'
import type { DatabaseMigration } from '../../db/migrations'

/** Preserve each credential-bearing provider_configs row and attach its source and model. */
export const migration0013: DatabaseMigration = {
  version: 13,
  name: '0013-purpose-catalogs',
  checksum: 'sha256:f5dd3a70929ef6b14b666d5e1993b4c0eb6c4843568897b24baab665cb533532',
  up(database) {
    database.exec(`
      CREATE TABLE purpose_sources (
        role TEXT NOT NULL CHECK(role IN ('speech','embedding','rerank','mineru')),
        source_id TEXT NOT NULL CHECK(length(source_id) BETWEEN 1 AND 80),
        provider_config_id TEXT UNIQUE NOT NULL REFERENCES provider_configs(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
        enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
        PRIMARY KEY(role,source_id)
      ) STRICT;
      CREATE TABLE purpose_models (
        role TEXT NOT NULL,
        source_id TEXT NOT NULL,
        config_id TEXT NOT NULL CHECK(length(config_id) BETWEEN 1 AND 80),
        model TEXT NOT NULL CHECK(length(model) BETWEEN 1 AND 200),
        mode TEXT,
        model_revision TEXT,
        embedding_dimension INTEGER,
        enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
        PRIMARY KEY(role,source_id,config_id),
        FOREIGN KEY(role,source_id) REFERENCES purpose_sources(role,source_id) ON DELETE CASCADE,
        CHECK((role='speech' AND mode IS NOT NULL AND mode IN ('realtime','file')) OR (role!='speech' AND mode IS NULL)),
        CHECK((role IN ('embedding','rerank') AND model_revision IS NOT NULL AND length(model_revision) BETWEEN 1 AND 256)
          OR (role NOT IN ('embedding','rerank') AND model_revision IS NULL)),
        CHECK((role='embedding' AND embedding_dimension IS NOT NULL AND embedding_dimension BETWEEN 1 AND 65536)
          OR (role!='embedding' AND embedding_dimension IS NULL)),
        CHECK(role!='mineru' OR model IN ('pipeline','vlm','MinerU-HTML'))
      ) STRICT;
      CREATE UNIQUE INDEX purpose_model_identity ON purpose_models
        (role,source_id,model,coalesce(mode,''),coalesce(model_revision,''),coalesce(embedding_dimension,0));
      CREATE TABLE purpose_defaults (
        role TEXT PRIMARY KEY NOT NULL,
        source_id TEXT NOT NULL,
        config_id TEXT NOT NULL,
        FOREIGN KEY(role,source_id,config_id) REFERENCES purpose_models(role,source_id,config_id) ON DELETE CASCADE
      ) STRICT;
      CREATE TRIGGER purpose_source_disabled AFTER UPDATE OF enabled ON purpose_sources WHEN NEW.enabled=0 BEGIN
        DELETE FROM purpose_defaults WHERE role=NEW.role AND source_id=NEW.source_id;
      END;
      CREATE TRIGGER purpose_model_disabled AFTER UPDATE OF enabled ON purpose_models WHEN NEW.enabled=0 BEGIN
        DELETE FROM purpose_defaults WHERE role=NEW.role AND source_id=NEW.source_id AND config_id=NEW.config_id;
      END;
    `)
    const importSource = database.prepare(
      'INSERT INTO purpose_sources(role,source_id,provider_config_id,name,enabled) VALUES(?,?,?,?,1)'
    )
    const candidates = database
      .prepare(
        "SELECT id, provider, config_json FROM provider_configs WHERE id IN ('speech','embedding','rerank','mineru') OR id GLOB 'speech:*'"
      )
      .all() as Array<{ id: string; provider: string; config_json: string }>
    for (const row of candidates) {
      const raw: unknown = JSON.parse(row.config_json)
      if (row.id === 'speech' || row.id.startsWith('speech:')) {
        const parsed = speechSourceConfigSchema.safeParse(raw)
        if (!parsed.success || parsed.data.providerId !== row.provider) continue
        const expectedId =
          parsed.data.sourceId === 'legacy' ? 'speech' : `speech:${parsed.data.sourceId}`
        if (expectedId === row.id)
          importSource.run('speech', parsed.data.sourceId, row.id, parsed.data.name)
        continue
      }
      const parsed = providerConfigSchema.safeParse(raw)
      if (!parsed.success || parsed.data.role !== row.id || parsed.data.providerId !== row.provider)
        continue
      const name =
        row.id === 'embedding'
          ? 'OpenAI-compatible'
          : row.id === 'rerank'
            ? 'Cohere-compatible'
            : 'MinerU'
      importSource.run(row.id, 'legacy', row.id, name)
    }
    database.exec(`
      INSERT INTO purpose_models(role,source_id,config_id,model,mode,model_revision,embedding_dimension,enabled)
        SELECT s.role,s.source_id,'legacy',json_extract(p.config_json,'$.model'),json_extract(p.config_json,'$.mode'),
          json_extract(p.config_json,'$.modelRevision'),json_extract(p.config_json,'$.embeddingDimension'),1
        FROM purpose_sources s JOIN provider_configs p ON s.provider_config_id=p.id
        WHERE json_type(p.config_json,'$.model')='text';
      INSERT INTO purpose_defaults(role,source_id,config_id)
        SELECT role,source_id,config_id FROM purpose_models WHERE role!='speech' OR source_id=(
          SELECT json_extract(value_json,'$') FROM app_settings WHERE key='speech.active-source.v1'
        );
    `)
  }
}
