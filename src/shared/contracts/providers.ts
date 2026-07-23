import { z } from 'zod'

export const providerRoleSchema = z.enum(['agent', 'embedding', 'rerank', 'mineru', 'image'])
export type ProviderRole = z.infer<typeof providerRoleSchema>

export const providerIdSchema = z.enum([
  'openai-compatible',
  'cohere-compatible',
  'mineru',
  'google-gemini'
])
export type ProviderId = z.infer<typeof providerIdSchema>

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

export const GOOGLE_GEMINI_IMAGE_MODELS = [
  'gemini-3.1-flash-lite-image',
  'gemini-3.1-flash-image',
  'gemini-3-pro-image',
  'gemini-2.5-flash-image'
] as const
export const googleGeminiImageModelSchema = z.enum(GOOGLE_GEMINI_IMAGE_MODELS)
export type GoogleGeminiImageModel = z.infer<typeof googleGeminiImageModelSchema>
export const googleGeminiImageSizeSchema = z.enum(['1K', '2K'])
export type GoogleGeminiImageSize = z.infer<typeof googleGeminiImageSizeSchema>
export const GOOGLE_GEMINI_IMAGE_MODEL_SIZES = {
  'gemini-3.1-flash-lite-image': ['1K'],
  'gemini-3.1-flash-image': ['1K', '2K'],
  'gemini-3-pro-image': ['1K', '2K'],
  'gemini-2.5-flash-image': ['1K']
} as const satisfies Record<GoogleGeminiImageModel, readonly GoogleGeminiImageSize[]>

export function effectiveGoogleGeminiImageSize(
  model: GoogleGeminiImageModel,
  requested: GoogleGeminiImageSize
): GoogleGeminiImageSize {
  const supported: readonly GoogleGeminiImageSize[] = GOOGLE_GEMINI_IMAGE_MODEL_SIZES[model]
  return supported.includes(requested) ? requested : '1K'
}

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
  model: z.string().trim().min(1).max(200),
  timeoutMs: z.number().int().min(1_000).max(300_000),
  batchLimit: z.number().int().min(1).max(2_048)
}

const endpointProviderCommonFields = {
  ...providerCommonFields,
  baseUrl: providerBaseUrlSchema
}

const modelRevisionSchema = z.string().trim().min(1).max(256)

export const providerConfigSchema = z
  .discriminatedUnion('role', [
    z.object({
      ...endpointProviderCommonFields,
      role: z.literal('agent'),
      providerId: z.literal('openai-compatible'),
      modelRevision: modelRevisionSchema,
      contextWindowTokens: z.number().int().min(8_192).max(10_000_000).nullable().optional(),
      embeddingDimension: z.null(),
      fileSizeLimitMb: z.null()
    }),
    z.object({
      ...endpointProviderCommonFields,
      role: z.literal('embedding'),
      providerId: z.literal('openai-compatible'),
      modelRevision: modelRevisionSchema,
      embeddingDimension: z.number().int().min(1).max(65_536),
      fileSizeLimitMb: z.null()
    }),
    z.object({
      ...endpointProviderCommonFields,
      role: z.literal('rerank'),
      providerId: z.literal('cohere-compatible'),
      modelRevision: modelRevisionSchema,
      embeddingDimension: z.null(),
      fileSizeLimitMb: z.null()
    }),
    z.object({
      ...endpointProviderCommonFields,
      role: z.literal('mineru'),
      providerId: z.literal('mineru'),
      embeddingDimension: z.null(),
      fileSizeLimitMb: z.number().int().min(1).max(200)
    }),
    z.object({
      ...providerCommonFields,
      baseUrl: z
        .enum([
          'https://generativelanguage.googleapis.com',
          'https://generativelanguage.googleapis.com/v1beta'
        ])
        .optional(),
      model: googleGeminiImageModelSchema,
      role: z.literal('image'),
      providerId: z.literal('google-gemini'),
      embeddingDimension: z.null(),
      fileSizeLimitMb: z.null(),
      defaultAspectRatio: z.enum(['auto', '1:1', '16:9']),
      defaultImageSize: googleGeminiImageSizeSchema
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
  .transform((config) => {
    if (config.role !== 'image') return config
    const { baseUrl: _legacyBaseUrl, ...current } = config
    return current
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
  capabilities: z.array(
    z.enum(['chat', 'tool-calling', 'embedding', 'rerank', 'parse', 'image-generation'])
  ),
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
  providers: z.array(providerStatusSchema).length(5)
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
