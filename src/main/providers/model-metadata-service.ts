import { createHash } from 'node:crypto'
import type { Logger } from 'pino'
import { agentModelLimitsSchema, type AgentModelLimits } from '../../shared/contracts/agent'
import type { ProviderConfig } from '../../shared/contracts/providers'
import type { AppSettingsRepository } from '../app-db/repositories/app-settings'
import type { ModelMetadataClient } from './model-metadata-client'

const CACHE_TTL_MS = 24 * 60 * 60 * 1_000
const LEGACY_LIMITS: AgentModelLimits = {
  contextWindowTokens: 131_072,
  inputLimitTokens: null,
  outputLimitTokens: null,
  source: 'legacy_fallback',
  catalogModelKey: null,
  resolvedAt: null
}

export class ModelMetadataService {
  constructor(
    private readonly settings: AppSettingsRepository,
    private readonly client: ModelMetadataClient,
    private readonly log: Pick<Logger, 'info' | 'warn' | 'error'>,
    private readonly now: () => Date = () => new Date()
  ) {}

  async resolve(
    config: Extract<ProviderConfig, { role: 'agent' }>,
    signal: AbortSignal
  ): Promise<AgentModelLimits> {
    if (config.contextWindowTokens != null) {
      return agentModelLimitsSchema.parse({
        contextWindowTokens: config.contextWindowTokens,
        inputLimitTokens: null,
        outputLimitTokens: null,
        source: 'manual_override',
        catalogModelKey: null,
        resolvedAt: this.now().toISOString()
      })
    }
    const fingerprint = createHash('sha256')
      .update(`${config.providerId}\0${config.baseUrl}\0${config.model}`)
      .digest('hex')
    const cache = await this.settings.getModelLimitsCache()
    const cached = cache[fingerprint]
    const cachedAge =
      cached === undefined
        ? Number.POSITIVE_INFINITY
        : this.now().getTime() - Date.parse(cached.refreshedAt)
    if (cached !== undefined && cachedAge < CACHE_TTL_MS) {
      return { ...cached.limits, source: 'cache' }
    }
    try {
      const refreshSignal = AbortSignal.any([signal, AbortSignal.timeout(5_000)])
      const resolved = await this.client.resolve(config.baseUrl, config.model, refreshSignal)
      if (resolved !== null) {
        await this.settings.setModelLimitsCache({
          [fingerprint]: { limits: resolved, refreshedAt: this.now().toISOString() }
        })
        this.log.info(
          {
            event: 'agent.model_limits.resolved',
            source: resolved.source,
            catalogModelKey: resolved.catalogModelKey
          },
          'Agent model limits resolved'
        )
        return resolved
      }
      this.log.warn(
        { event: 'agent.model_limits.unmatched', providerId: config.providerId },
        'Configured Agent model did not match models.dev'
      )
    } catch (err) {
      this.log.warn(
        { event: 'agent.model_limits.refresh_failed', err, providerId: config.providerId },
        'Agent model limits refresh failed; using cached or fallback limits'
      )
    }
    return cached === undefined ? LEGACY_LIMITS : { ...cached.limits, source: 'cache' }
  }
}

export { LEGACY_LIMITS as LEGACY_AGENT_MODEL_LIMITS }
