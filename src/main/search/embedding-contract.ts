import {
  INDEX_CHUNKER_VERSION,
  type VectorGenerationContract
} from '../../shared/contracts/indexing'
import type { ProviderConfig } from '../../shared/contracts/providers'
import { sha256 } from '../../shared/hash'

function embeddingIdentity(config: ProviderConfig) {
  if (config.role !== 'embedding' || config.embeddingDimension === null) {
    throw new Error('Embedding provider contract is invalid')
  }
  return {
    baseUrl: config.baseUrl,
    fields: {
      providerId: config.providerId,
      modelId: config.model,
      modelRevision: config.modelRevision,
      dimension: config.embeddingDimension,
      metric: 'cosine',
      normalization: 'l2',
      chunkerVersion: INDEX_CHUNKER_VERSION
    }
  } as const
}

function hashEmbeddingIdentity({
  baseUrl,
  fields: { providerId, ...identity }
}: ReturnType<typeof embeddingIdentity>): string {
  return sha256(Buffer.from(JSON.stringify({ providerId, baseUrl, ...identity })))
}

export function embeddingContractSha256(config: ProviderConfig): string {
  return hashEmbeddingIdentity(embeddingIdentity(config))
}

export function assertEmbeddingProviderContract(
  config: ProviderConfig,
  expectedHash: string
): void {
  if (embeddingContractSha256(config) !== expectedHash) {
    throw new Error('Embedding provider changed before execution')
  }
}

export function createEmbeddingGenerationContract(
  config: ProviderConfig,
  current: { generationId: string; contentFingerprint: string }
): VectorGenerationContract {
  const identity = embeddingIdentity(config)
  const contractSha256 = hashEmbeddingIdentity(identity)
  return {
    embeddingGenerationId: `embedding-${sha256(
      Buffer.from(`${current.generationId}\0${contractSha256}`)
    ).slice(0, 40)}`,
    indexGenerationId: current.generationId,
    ...identity.fields,
    contractSha256,
    contentFingerprint: current.contentFingerprint
  }
}
