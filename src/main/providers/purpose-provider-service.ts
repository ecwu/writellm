import { randomUUID } from 'node:crypto'
import type { Transaction } from 'kysely'
import type { Logger } from 'pino'
import type { VectorGenerationContract } from '../../shared/contracts/indexing'
import {
  providerConfigSchema,
  purposeSourceDraftSchema,
  purposeSourceSaveInputSchema,
  purposeModelSaveInputSchema,
  type PurposeSourceDraft,
  type PurposeModelDraft,
  type PurposeSourceStatus,
  type PurposeModelStatus,
  type PurposeModelSelection,
  type PurposeProviderRole,
  type PurposeCatalog,
  type PurposeSourceSaveInput,
  type PurposeSourceInput,
  type PurposeModelSaveInput,
  type PurposeModelInput,
  type PurposeModelEnabledInput,
  type PurposeDefaultInput,
  type PurposeModelTestInput,
  type ProviderConfigForRole,
  type ProviderSettingsSnapshot,
  type ProviderConnectionTestResult
} from '../../shared/contracts/providers'
import type { AppDatabase } from '../app-db/connection'
import type { AppDatabaseSchema } from '../app-db/database-types'
import { PurposeCatalogRepository } from '../app-db/repositories/purpose-catalog'
import type { CredentialService } from './credential-service'
import { credentialBindingFingerprint } from './credential-binding'

export class PurposeSelectionUnavailableError extends Error {}
export type ResolvedPurpose<R extends PurposeProviderRole> = PurposeModelSelection & {
  providerConfigId: string
  config: ProviderConfigForRole<R>
}

type SourceRow = NonNullable<Awaited<ReturnType<PurposeCatalogRepository['getSource']>>>
type ModelRow = NonNullable<Awaited<ReturnType<PurposeCatalogRepository['getModel']>>>

function readSource(row: Pick<SourceRow, 'name' | 'enabled'>, raw: string): PurposeSourceDraft {
  const config = JSON.parse(raw)
  return purposeSourceDraftSchema.parse({
    role: config.role,
    providerId: config.providerId,
    name: row.name,
    enabled: !!row.enabled,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    batchLimit: config.batchLimit,
    fileSizeLimitMb: config.fileSizeLimitMb
  })
}

function readModel(row: ModelRow): PurposeModelStatus {
  return {
    configId: row.config_id,
    modelId: row.model,
    enabled: !!row.enabled,
    mode: row.mode,
    modelRevision: row.model_revision,
    embeddingDimension: row.embedding_dimension
  }
}

export function purposeRuntimeConfig<R extends PurposeProviderRole>(
  role: R,
  source: PurposeSourceDraft,
  sourceId: string,
  model: PurposeModelDraft
): ProviderConfigForRole<R> {
  return providerConfigSchema.parse({
    role,
    providerId: source.providerId,
    baseUrl: source.baseUrl,
    timeoutMs: source.timeoutMs,
    batchLimit: source.batchLimit,
    fileSizeLimitMb: source.fileSizeLimitMb,
    model: model.modelId,
    embeddingDimension: model.embeddingDimension,
    ...(role === 'embedding' ? { sourceId } : {}),
    ...(model.modelRevision === null ? {} : { modelRevision: model.modelRevision }),
    ...(model.mode === null ? {} : { mode: model.mode })
  }) as ProviderConfigForRole<R>
}

export class PurposeProviderService {
  readonly repo: PurposeCatalogRepository
  constructor(
    private readonly db: AppDatabase,
    private readonly credentials: CredentialService,
    private readonly log: Logger,
    private readonly now: () => string,
    private readonly fullSnapshot: () => Promise<ProviderSettingsSnapshot>,
    private readonly modelCatalog: (
      id: string,
      transaction: Transaction<AppDatabaseSchema>
    ) => Promise<Pick<PurposeSourceStatus, 'catalog' | 'modelCandidates'>>,
    private readonly probe: (
      resolved: ResolvedPurpose<PurposeProviderRole>
    ) => Promise<ProviderConnectionTestResult>,
    private readonly invalidateCatalog: (id: string) => void
  ) {
    this.repo = new PurposeCatalogRepository(db.kysely)
  }

  async snapshot(secure: boolean): Promise<PurposeCatalog> {
    return this.db.kysely.transaction().execute(async (tx) => {
      const connections = await tx
        .selectFrom('purpose_sources as s')
        .innerJoin('provider_configs as c', 'c.id', 's.provider_config_id')
        .leftJoin('encrypted_credentials as k', 'k.provider_config_id', 'c.id')
        .leftJoin('source_model_catalogs as catalog', 'catalog.provider_config_id', 'c.id')
        .selectAll('s')
        .select([
          'c.provider',
          'c.config_json',
          'k.binding_fingerprint',
          'k.id as credentialId',
          'catalog.provider_config_id as cached'
        ])
        .orderBy('c.created_at')
        .orderBy('s.source_id')
        .execute()
      const models = await tx
        .selectFrom('purpose_models')
        .selectAll()
        .orderBy('config_id')
        .execute()
      const defaults = await tx.selectFrom('purpose_defaults').selectAll().execute()
      const catalog: PurposeCatalog = {
        speech: { sources: [], defaultSelection: null },
        mineru: { sources: [], defaultSelection: null },
        embedding: { sources: [], defaultSelection: null },
        rerank: { sources: [], defaultSelection: null }
      }
      for (const d of defaults)
        catalog[d.role].defaultSelection = { sourceId: d.source_id, configId: d.config_id }
      const groupedModels = new Map<string, PurposeModelStatus[]>()
      for (const row of models) {
        const key = `${row.role}:${row.source_id}`
        const group = groupedModels.get(key) ?? []
        group.push(readModel(row))
        groupedModels.set(key, group)
      }
      for (const row of connections) {
        const source = readSource(row, row.config_json)
        if (source.role !== row.role || source.providerId !== row.provider)
          throw new Error('Purpose source connection mismatch')
        const authConfigured =
          row.binding_fingerprint !== null &&
          row.binding_fingerprint ===
            credentialBindingFingerprint({
              providerConfigId: row.provider_config_id,
              provider: row.provider,
              configJson: row.config_json
            })
        const issues: string[] = []
        if (!source.enabled) issues.push('Source is disabled.')
        if (!authConfigured && row.credentialId !== null)
          issues.push('Save the credential again for this source.')
        else if (!authConfigured && source.role !== 'speech')
          issues.push('Provider credential is missing.')
        if (authConfigured && !secure) issues.push('Secure credential storage is unavailable.')
        const discovery = row.cached
          ? await this.modelCatalog(row.provider_config_id, tx)
          : {
              modelCandidates: [],
              catalog: { status: 'never' as const, checkedAt: null, lastErrorCode: null }
            }
        catalog[row.role].sources.push({
          ...source,
          sourceId: row.source_id,
          models: groupedModels.get(`${row.role}:${row.source_id}`) ?? [],
          ...discovery,
          issues,
          authConfigured,
          available: issues.length === 0
        })
      }
      return catalog
    })
  }

  async resolve<R extends PurposeProviderRole>(
    role: R,
    selection?: PurposeModelSelection
  ): Promise<ResolvedPurpose<R>> {
    const target = selection ?? (await this.repo.getDefault(role))
    if (!target) throw new PurposeSelectionUnavailableError(`${role} provider is not configured`)
    const [resolved] = await this.listResolved(role, target)
    if (!resolved)
      throw new PurposeSelectionUnavailableError(`${role} source or model is unavailable`)
    return resolved
  }

  async listResolved<R extends PurposeProviderRole>(
    role: R,
    filter:
      | PurposeModelSelection
      | Pick<VectorGenerationContract, 'modelId' | 'modelRevision' | 'dimension'>
  ): Promise<ResolvedPurpose<R>[]> {
    let query = this.db.kysely
      .selectFrom('purpose_sources as s')
      .innerJoin('provider_configs as c', 'c.id', 's.provider_config_id')
      .innerJoin('purpose_models as m', (join) =>
        join.onRef('m.role', '=', 's.role').onRef('m.source_id', '=', 's.source_id')
      )
      .selectAll('m')
      .select(['s.provider_config_id', 's.name', 'c.config_json', 'c.provider'])
      .where('s.role', '=', role)
      .where('s.enabled', '=', 1)
      .where('m.enabled', '=', 1)
    if ('sourceId' in filter) {
      query = query
        .where('s.source_id', '=', filter.sourceId)
        .where('m.config_id', '=', filter.configId)
    } else {
      query = query
        .where('m.model', '=', filter.modelId)
        .where('m.model_revision', '=', filter.modelRevision)
        .where('m.embedding_dimension', '=', filter.dimension)
    }
    const rows = await query.execute()
    return rows.map((row) => {
      const source = readSource(row, row.config_json)
      if (source.role !== role || row.provider !== source.providerId)
        throw new PurposeSelectionUnavailableError('Source identity changed')
      return {
        sourceId: row.source_id,
        configId: row.config_id,
        providerConfigId: row.provider_config_id,
        config: purposeRuntimeConfig(role, source, row.source_id, readModel(row))
      }
    })
  }

  async withResolved<R extends PurposeProviderRole, T>(
    resolved: ResolvedPurpose<R>,
    operation: (
      config: ProviderConfigForRole<R>,
      credential: R extends 'speech' ? string | undefined : string
    ) => Promise<T>
  ): Promise<T> {
    const config: ProviderConfigForRole<PurposeProviderRole> = resolved.config
    const run = async (credential: string | undefined) => {
      const current = await this.resolve(config.role, resolved)
      if (JSON.stringify(current.config) !== JSON.stringify(resolved.config))
        throw new PurposeSelectionUnavailableError('The source configuration changed. Try again.')
      return operation(
        resolved.config,
        credential as R extends 'speech' ? string | undefined : string
      )
    }
    const binding = credentialBindingFingerprint({
      providerConfigId: resolved.providerConfigId,
      provider: config.providerId,
      configJson: JSON.stringify(resolved.config)
    })
    return config.role === 'speech'
      ? this.credentials.withOptionalCredential(resolved.providerConfigId, run, binding)
      : this.credentials.withCredential(resolved.providerConfigId, run, binding)
  }

  async #writeSource(
    tx: Transaction<AppDatabaseSchema>,
    source: PurposeSourceDraft,
    sourceId: string,
    storageId: string,
    ciphertext: string | undefined,
    create: boolean,
    legacyConfig?: object
  ) {
    const repo = new PurposeCatalogRepository(tx)
    const previous = await tx
      .selectFrom('provider_configs')
      .select(['provider', 'config_json'])
      .where('id', '=', storageId)
      .executeTakeFirst()
    // Only the compatibility API can adopt a retained, incomplete singleton row.
    const repairing =
      create &&
      previous !== undefined &&
      storageId === source.role &&
      sourceId === 'legacy' &&
      legacyConfig !== undefined
    if (create && previous && !repairing) throw new Error('Source already exists')
    if (create && (await repo.listSources(source.role)).length >= 50)
      throw new Error('At most 50 sources can be configured')
    const json = JSON.stringify(legacyConfig ?? source)
    const values = { provider: source.providerId, config_json: json, updated_at: this.now() }
    await tx
      .insertInto('provider_configs')
      .values({ ...values, id: storageId, created_at: this.now() })
      .onConflict((c) => c.column('id').doUpdateSet(values))
      .execute()
    if (ciphertext !== undefined) await this.credentials.persistEncrypted(storageId, ciphertext, tx)
    else if (previous) {
      const storedCredential = await tx
        .selectFrom('encrypted_credentials')
        .select('binding_fingerprint')
        .where('provider_config_id', '=', storageId)
        .executeTakeFirst()
      if (
        storedCredential &&
        storedCredential.binding_fingerprint !==
          credentialBindingFingerprint({
            providerConfigId: storageId,
            provider: source.providerId,
            configJson: json
          })
      )
        await this.credentials.removeCredential(storageId, tx)
    }
    if (
      previous &&
      (repairing ||
        ciphertext !== undefined ||
        JSON.parse(previous.config_json).baseUrl !== source.baseUrl)
    ) {
      this.invalidateCatalog(storageId)
      await tx
        .deleteFrom('source_model_catalogs')
        .where('provider_config_id', '=', storageId)
        .execute()
    }
    await repo.saveSource({
      role: source.role,
      source_id: sourceId,
      provider_config_id: storageId,
      name: source.name,
      enabled: source.enabled ? 1 : 0
    })
  }

  async #writeModel(
    repo: PurposeCatalogRepository,
    role: PurposeProviderRole,
    sourceId: string,
    configId: string,
    model: PurposeModelDraft
  ) {
    await repo.saveModel({
      role,
      source_id: sourceId,
      config_id: configId,
      model: model.modelId,
      mode: model.mode,
      model_revision: model.modelRevision,
      embedding_dimension: model.embeddingDimension,
      enabled: model.enabled ? 1 : 0
    })
  }

  async savePurposeSource(input: PurposeSourceSaveInput) {
    const { source, sourceId, apiKey } = purposeSourceSaveInputSchema.parse(input)
    const id = sourceId ?? randomUUID()
    const ciphertext =
      apiKey === undefined ? undefined : await this.credentials.encryptForPersistence(apiKey)
    await this.db.kysely.transaction().execute(async (tx) => {
      const existing = await new PurposeCatalogRepository(tx).getSource(source.role, id)
      if (sourceId && !existing) throw new Error('Source was removed')
      await this.#writeSource(
        tx,
        source,
        id,
        existing?.provider_config_id ?? `${source.role}:${id}`,
        ciphertext,
        !existing
      )
    })
    return this.#changed(source.role, 'provider.purpose.source_saved')
  }

  async saveLegacy(
    config: ProviderConfigForRole<PurposeProviderRole>,
    sourceId: string,
    name: string,
    apiKey: string | undefined,
    activate: boolean,
    requireExisting = false
  ) {
    const role = config.role
    const source = purposeSourceDraftSchema.parse({
      role,
      providerId: config.providerId,
      baseUrl: config.baseUrl,
      timeoutMs: config.timeoutMs,
      batchLimit: config.batchLimit,
      fileSizeLimitMb: config.fileSizeLimitMb,
      name,
      enabled: true
    })
    const model = {
      modelId: config.model,
      mode: 'mode' in config ? config.mode : null,
      embeddingDimension: config.embeddingDimension,
      modelRevision: 'modelRevision' in config ? config.modelRevision : null,
      enabled: true
    }
    const ciphertext =
      apiKey === undefined ? undefined : await this.credentials.encryptForPersistence(apiKey)
    await this.db.kysely.transaction().execute(async (tx) => {
      const repo = new PurposeCatalogRepository(tx)
      const old = await repo.getSource(role, sourceId)
      if (requireExisting && !old) throw new Error('Source was removed')
      const storageId =
        old?.provider_config_id ?? (sourceId === 'legacy' ? role : `${role}:${sourceId}`)
      if (requireExisting && old && role === 'speech') {
        const stored = await tx
          .selectFrom('provider_configs')
          .select('config_json')
          .where('id', '=', storageId)
          .executeTakeFirstOrThrow()
        source.timeoutMs = readSource(old, stored.config_json).timeoutMs
      }
      await this.#writeSource(
        tx,
        source,
        sourceId,
        storageId,
        ciphertext,
        !old,
        role === 'speech' ? { ...config, timeoutMs: source.timeoutMs, sourceId, name } : config
      )
      await this.#writeModel(repo, role, sourceId, 'legacy', model)
      if (activate && (!old || role !== 'speech'))
        await repo.setDefault(role, { sourceId, configId: 'legacy' })
    })
    return this.#changed(role, 'provider.purpose.source_saved')
  }

  async removePurposeSource({ role, sourceId }: PurposeSourceInput) {
    await this.db.kysely.transaction().execute(async (tx) => {
      const source = await new PurposeCatalogRepository(tx).getSource(role, sourceId)
      if (source) {
        this.invalidateCatalog(source.provider_config_id)
        await tx
          .deleteFrom('provider_configs')
          .where('id', '=', source.provider_config_id)
          .execute()
      }
    })
    return this.#changed(role, 'provider.purpose.source_removed')
  }

  async savePurposeModel(input: PurposeModelSaveInput) {
    const { role, sourceId, configId, model } = purposeModelSaveInputSchema.parse(input)
    await this.db.kysely.transaction().execute(async (tx) => {
      const repo = new PurposeCatalogRepository(tx)
      if (configId && !(await repo.getModel(role, sourceId, configId)))
        throw new Error('Model was removed')
      if (
        !configId &&
        (await repo.listModels(role)).filter((m) => m.source_id === sourceId).length >= 500
      )
        throw new Error('At most 500 models can be configured')
      await this.#writeModel(repo, role, sourceId, configId ?? randomUUID(), model)
    })
    return this.#changed(role, 'provider.purpose.model_saved')
  }
  async removePurposeModel({ role, sourceId, configId }: PurposeModelInput) {
    await this.repo.removeModel(role, sourceId, configId)
    return this.#changed(role, 'provider.purpose.model_removed')
  }
  async setPurposeModelEnabled({ role, sourceId, configId, enabled }: PurposeModelEnabledInput) {
    await this.db.kysely
      .transaction()
      .execute((tx) =>
        new PurposeCatalogRepository(tx).setModelEnabled(role, sourceId, configId, enabled)
      )
    return this.#changed(role, 'provider.purpose.model_enabled_changed')
  }
  async setPurposeDefault({ role, selection }: PurposeDefaultInput) {
    const secure = selection ? (await this.credentials.backendStatus()).securePersistence : false
    await this.db.kysely.transaction().execute(async (tx) => {
      if (selection) {
        const row = await tx
          .selectFrom('purpose_sources as s')
          .innerJoin('provider_configs as c', 'c.id', 's.provider_config_id')
          .leftJoin('encrypted_credentials as k', 'k.provider_config_id', 'c.id')
          .select([
            'c.id',
            'c.provider',
            'c.config_json',
            'k.binding_fingerprint',
            'k.id as credentialId'
          ])
          .where('s.role', '=', role)
          .where('s.source_id', '=', selection.sourceId)
          .executeTakeFirstOrThrow()
        if (row.credentialId !== null || role !== 'speech') {
          if (
            !secure ||
            credentialBindingFingerprint({
              providerConfigId: row.id,
              provider: row.provider,
              configJson: row.config_json
            }) !== row.binding_fingerprint
          )
            throw new Error('Configure the source credential before selecting a default.')
        }
      }
      await new PurposeCatalogRepository(tx).setDefault(role, selection)
    })
    return this.#changed(role, 'provider.purpose.default_changed')
  }

  async testPurposeModel({ role, sourceId, configId }: PurposeModelTestInput) {
    const model =
      configId ??
      (await this.repo.listModels(role)).find((m) => m.source_id === sourceId && m.enabled)
        ?.config_id
    if (!model)
      return {
        ok: false,
        code: 'missing_config' as const,
        message: 'Add and enable a model to test this source.',
        durationMs: 0
      }
    return this.probe(await this.resolve(role, { sourceId, configId: model }))
  }
  #changed(role: PurposeProviderRole, event: string) {
    this.log.info({ event, role }, 'Purpose provider configuration changed')
    return this.fullSnapshot()
  }
}
