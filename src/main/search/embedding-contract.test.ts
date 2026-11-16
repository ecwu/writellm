import { expect, it } from 'vitest'
import type { ProviderConfig } from '../../shared/contracts/providers'
import { createEmbeddingGenerationContract, embeddingContractSha256 } from './embedding-contract'

it('keeps the existing embedding identity and binds the hash to the endpoint', () => {
  const config: ProviderConfig = {
    role: 'embedding',
    providerId: 'openai-compatible',
    baseUrl: 'https://embedding.example.test/v1',
    model: 'embedding-v1',
    modelRevision: 'embedding-rev-1',
    timeoutMs: 10_000,
    embeddingDimension: 3,
    batchLimit: 2,
    fileSizeLimitMb: null
  }
  const current = { generationId: 'generation-test', contentFingerprint: 'a'.repeat(64) }
  const contract = createEmbeddingGenerationContract(config, current)
  expect(contract).toEqual({
    embeddingGenerationId: 'embedding-879de61785fc62e91becc4dab573bcdd6765aa6b',
    indexGenerationId: current.generationId,
    providerId: config.providerId,
    modelId: config.model,
    modelRevision: config.modelRevision,
    dimension: 3,
    metric: 'cosine',
    normalization: 'l2',
    chunkerVersion: 1,
    contractSha256: '52c80a202c300f375d5b9f3cff65cffd5669498af9483ea2e7f440f9e3415738',
    contentFingerprint: current.contentFingerprint
  })
  expect(embeddingContractSha256(config)).toBe(contract.contractSha256)
  expect(embeddingContractSha256({ ...config, baseUrl: 'https://other.example.test/v1' })).not.toBe(
    contract.contractSha256
  )
})
