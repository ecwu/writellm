import type { Kysely } from 'kysely'
import type {
  AppDatabaseSchema,
  CatalogPurpose,
  PurposeSourceTable,
  PurposeModelTable
} from '../database-types'

export class PurposeCatalogRepository {
  constructor(private readonly db: Kysely<AppDatabaseSchema>) {}

  listSources(role: CatalogPurpose) {
    return this.db
      .selectFrom('purpose_sources')
      .selectAll()
      .where('role', '=', role)
      .orderBy('source_id')
      .execute()
  }
  listModels(role: CatalogPurpose) {
    return this.db
      .selectFrom('purpose_models')
      .selectAll()
      .where('role', '=', role)
      .orderBy('source_id')
      .orderBy('config_id')
      .execute()
  }
  getSource(role: CatalogPurpose, sourceId: string) {
    return this.db
      .selectFrom('purpose_sources')
      .selectAll()
      .where('role', '=', role)
      .where('source_id', '=', sourceId)
      .executeTakeFirst()
  }
  getModel(role: CatalogPurpose, sourceId: string, configId: string) {
    return this.db
      .selectFrom('purpose_models')
      .selectAll()
      .where('role', '=', role)
      .where('source_id', '=', sourceId)
      .where('config_id', '=', configId)
      .executeTakeFirst()
  }
  async getDefault(role: CatalogPurpose) {
    return (
      (await this.db
        .selectFrom('purpose_defaults')
        .select(['source_id as sourceId', 'config_id as configId'])
        .where('role', '=', role)
        .executeTakeFirst()) ?? null
    )
  }
  async saveSource(row: PurposeSourceTable) {
    await this.db
      .insertInto('purpose_sources')
      .values(row)
      .onConflict((c) =>
        c.columns(['role', 'source_id']).doUpdateSet({ name: row.name, enabled: row.enabled })
      )
      .execute()
  }
  async saveModel(row: PurposeModelTable) {
    await this.db
      .insertInto('purpose_models')
      .values(row)
      .onConflict((c) =>
        c.columns(['role', 'source_id', 'config_id']).doUpdateSet({
          model: row.model,
          mode: row.mode,
          model_revision: row.model_revision,
          embedding_dimension: row.embedding_dimension,
          enabled: row.enabled
        })
      )
      .execute()
  }
  async removeModel(role: CatalogPurpose, sourceId: string, configId: string) {
    await this.db
      .deleteFrom('purpose_models')
      .where('role', '=', role)
      .where('source_id', '=', sourceId)
      .where('config_id', '=', configId)
      .execute()
  }
  async setSourceEnabled(role: CatalogPurpose, sourceId: string, enabled: boolean) {
    await this.db
      .updateTable('purpose_sources')
      .set({ enabled: Number(enabled) })
      .where('role', '=', role)
      .where('source_id', '=', sourceId)
      .execute()
  }
  async setModelEnabled(
    role: CatalogPurpose,
    sourceId: string,
    configId: string,
    enabled: boolean
  ) {
    await this.db
      .updateTable('purpose_models')
      .set({ enabled: Number(enabled) })
      .where('role', '=', role)
      .where('source_id', '=', sourceId)
      .where('config_id', '=', configId)
      .execute()
  }
  async setDefault(role: CatalogPurpose, selection: { sourceId: string; configId: string } | null) {
    if (selection === null) {
      await this.db.deleteFrom('purpose_defaults').where('role', '=', role).execute()
      return
    }
    const enabled = this.db
      .selectFrom('purpose_models as m')
      .innerJoin('purpose_sources as s', (j) =>
        j.onRef('s.role', '=', 'm.role').onRef('s.source_id', '=', 'm.source_id')
      )
      .select(['m.role as role', 'm.source_id as source_id', 'm.config_id as config_id'])
      .where('m.role', '=', role)
      .where('m.source_id', '=', selection.sourceId)
      .where('m.config_id', '=', selection.configId)
      .where('m.enabled', '=', 1)
      .where('s.enabled', '=', 1)
    const result = await this.db
      .insertInto('purpose_defaults')
      .columns(['role', 'source_id', 'config_id'])
      .expression(enabled)
      .onConflict((c) =>
        c
          .column('role')
          .doUpdateSet({ source_id: selection.sourceId, config_id: selection.configId })
      )
      .executeTakeFirst()
    if (!result.numInsertedOrUpdatedRows)
      throw new Error('Select an enabled model from an enabled source.')
  }
}
