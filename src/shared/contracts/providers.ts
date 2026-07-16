import { z } from 'zod'

export const providerRoleSchema = z.enum(['agent', 'embedding', 'rerank', 'mineru'])
export type ProviderRole = z.infer<typeof providerRoleSchema>

export const providerIdSchema = z.enum(['openai-compatible', 'cohere-compatible', 'mineru'])
export type ProviderId = z.infer<typeof providerIdSchema>

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

export const providerBaseUrlSchema = z
  .url()
  .max(2_048)
  .transform((value) => value.replace(/\/+$/, ''))
  .refine((value) => {
    const url = new URL(value)
    const safeProtocol =
      url.protocol === 'https:' || (url.protocol === 'http:' && loopbackHosts.has(url.hostname))
    return (
      safeProtocol &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === ''
    )
  }, 'Use HTTPS, or HTTP only for a loopback endpoint')

const providerCommonFields = {
  baseUrl: providerBaseUrlSchema,
  model: z.string().trim().min(1).max(200),
  timeoutMs: z.number().int().min(1_000).max(300_000),
  batchLimit: z.number().int().min(1).max(2_048)
}

const modelRevisionSchema = z.string().trim().min(1).max(256)

export const providerConfigSchema = z
  .discriminatedUnion('role', [
    z.object({
      ...providerCommonFields,
      role: z.literal('agent'),
      providerId: z.literal('openai-compatible'),
      modelRevision: modelRevisionSchema,
      embeddingDimension: z.null(),
      fileSizeLimitMb: z.null()
    }),
    z.object({
      ...providerCommonFields,
      role: z.literal('embedding'),
      providerId: z.literal('openai-compatible'),
      modelRevision: modelRevisionSchema,
      embeddingDimension: z.number().int().min(1).max(65_536),
      fileSizeLimitMb: z.null()
    }),
    z.object({
      ...providerCommonFields,
      role: z.literal('rerank'),
      providerId: z.literal('cohere-compatible'),
      modelRevision: modelRevisionSchema,
      embeddingDimension: z.null(),
      fileSizeLimitMb: z.null()
    }),
    z.object({
      ...providerCommonFields,
      role: z.literal('mineru'),
      providerId: z.literal('mineru'),
      embeddingDimension: z.null(),
      fileSizeLimitMb: z.number().int().min(1).max(200)
    })
  ])
  .superRefine((config, context) => {
    if (config.role === 'mineru') {
      if (!['pipeline', 'vlm', 'MinerU-HTML'].includes(config.model)) {
        context.addIssue({
          code: 'custom',
          path: ['model'],
          message: 'MinerU model must be pipeline, vlm, or MinerU-HTML'
        })
      }
      if (config.batchLimit > 200) {
        context.addIssue({
          code: 'custom',
          path: ['batchLimit'],
          message: 'MinerU batches cannot exceed 200 files'
        })
      }
    }
  })

export type ProviderConfig = z.infer<typeof providerConfigSchema>
export type ProviderConfigForRole<R extends ProviderRole> = Extract<ProviderConfig, { role: R }>
export type MineruProviderConfig = Extract<ProviderConfig, { role: 'mineru' }>

export const credentialBackendStatusSchema = z.object({
  platform: z.enum(['darwin', 'win32', 'linux', 'other']),
  backend: z.string().min(1).max(100),
  encryptionAvailable: z.boolean(),
  securePersistence: z.boolean(),
  persistenceAllowed: z.boolean(),
  warning: z.string().max(500).nullable()
})
export type CredentialBackendStatus = z.infer<typeof credentialBackendStatusSchema>

export const providerCapabilitySchema = z.object({
  role: providerRoleSchema,
  providerId: providerIdSchema,
  label: z.string().min(1),
  capabilities: z.array(z.enum(['chat', 'tool-calling', 'embedding', 'rerank', 'parse'])),
  supportedFormats: z.array(z.string()),
  maxBatchSize: z.number().int().positive(),
  maxFileSizeMb: z.number().int().positive().nullable(),
  maxPages: z.number().int().positive().nullable()
})
export type ProviderCapability = z.infer<typeof providerCapabilitySchema>

export const providerStatusSchema = z.object({
  role: providerRoleSchema,
  capability: providerCapabilitySchema,
  config: providerConfigSchema.nullable(),
  configured: z.boolean(),
  available: z.boolean(),
  issues: z.array(z.string().max(500))
})
export type ProviderStatus = z.infer<typeof providerStatusSchema>

export const providerSettingsSnapshotSchema = z.object({
  credentialBackend: credentialBackendStatusSchema,
  providers: z.array(providerStatusSchema).length(4)
})
export type ProviderSettingsSnapshot = z.infer<typeof providerSettingsSnapshotSchema>

export const providerSaveInputSchema = z.object({
  config: providerConfigSchema,
  apiKey: z.string().trim().min(1).max(16_384).optional()
})
export type ProviderSaveInput = z.infer<typeof providerSaveInputSchema>

export const providerRoleInputSchema = z.object({ role: providerRoleSchema })
export type ProviderRoleInput = z.infer<typeof providerRoleInputSchema>

export const providerConnectionTestResultSchema = z.object({
  ok: z.boolean(),
  code: z.enum([
    'connected',
    'missing_config',
    'missing_credential',
    'invalid_auth',
    'timeout',
    'network_error',
    'provider_rejected'
  ]),
  message: z.string().min(1).max(500),
  durationMs: z.number().int().nonnegative()
})
export type ProviderConnectionTestResult = z.infer<typeof providerConnectionTestResultSchema>
