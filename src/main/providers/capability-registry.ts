import type { ProviderCapability, ProviderRole } from '../../shared/contracts/providers'

const capabilities: Record<ProviderRole, ProviderCapability> = {
  agent: {
    role: 'agent',
    providerId: 'openai-compatible',
    label: 'Agent model',
    capabilities: ['chat', 'tool-calling'],
    supportedFormats: [],
    maxBatchSize: 1,
    maxFileSizeMb: null,
    maxPages: null
  },
  embedding: {
    role: 'embedding',
    providerId: 'openai-compatible',
    label: 'Embeddings',
    capabilities: ['embedding'],
    supportedFormats: [],
    maxBatchSize: 2_048,
    maxFileSizeMb: null,
    maxPages: null
  },
  rerank: {
    role: 'rerank',
    providerId: 'cohere-compatible',
    label: 'Reranking',
    capabilities: ['rerank'],
    supportedFormats: [],
    maxBatchSize: 2_048,
    maxFileSizeMb: null,
    maxPages: null
  },
  mineru: {
    role: 'mineru',
    providerId: 'mineru',
    label: 'MinerU parser',
    capabilities: ['parse'],
    // MinerU supports more formats, but this list deliberately matches the current import slice.
    // TIFF is intentionally part of the import/parser contract and is validated by Main before a parse job is created.
    supportedFormats: [
      'pdf',
      'docx',
      'pptx',
      'png',
      'jpg',
      'jpeg',
      'webp',
      'gif',
      'tif',
      'tiff',
      'bmp'
    ],
    maxBatchSize: 200,
    maxFileSizeMb: 200,
    maxPages: 200
  }
}

export const providerRoles: readonly ProviderRole[] = ['agent', 'embedding', 'rerank', 'mineru']

export function getProviderCapability(role: ProviderRole): ProviderCapability {
  return capabilities[role]
}

export function listProviderCapabilities(): ProviderCapability[] {
  return providerRoles.map((role) => capabilities[role])
}
