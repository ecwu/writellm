import { z } from 'zod'
import { isModelsDevProviderLogoId } from '../models-dev-provider-logos'

export const providerRoleSchema = z.enum(['agent', 'embedding', 'rerank', 'mineru', 'image'])
export type ProviderRole = z.infer<typeof providerRoleSchema>

export const providerIdSchema = z.enum([
  'openai-compatible',
  'cohere-compatible',
  'mineru',
  'google-gemini'
])
export type ProviderId = z.infer<typeof providerIdSchema>

export const piApiSchema = z.enum([
  'openai-completions',
  'mistral-conversations',
  'openai-responses',
  'azure-openai-responses',
  'openai-codex-responses',
  'anthropic-messages',
  'bedrock-converse-stream',
  'google-generative-ai',
  'google-vertex',
  'pi-messages'
])
export type PiApi = z.infer<typeof piApiSchema>

export const customAgentPiApiSchema = z.enum([
  'openai-completions',
  'openai-responses',
  'azure-openai-responses',
  'anthropic-messages',
  'google-generative-ai',
  'mistral-conversations'
])
export type CustomAgentPiApi = z.infer<typeof customAgentPiApiSchema>

export const AGENT_THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
] as const
export const agentThinkingLevelSchema = z.enum(AGENT_THINKING_LEVELS)
export type AgentThinkingLevel = z.infer<typeof agentThinkingLevelSchema>
export const agentThinkingLevelMapSchema = z.partialRecord(
  agentThinkingLevelSchema,
  z.string().max(100).nullable()
)

export const agentPresetIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/)

export const agentModelSelectionSchema = z.object({
  presetId: agentPresetIdSchema,
  modelId: z.string().trim().min(1).max(500)
})
export type AgentModelSelection = z.infer<typeof agentModelSelectionSchema>

export const agentModelSummarySchema = z.object({
  id: z.string().trim().min(1).max(500),
  name: z.string().trim().min(1).max(500),
  api: piApiSchema,
  enabled: z.boolean(),
  source: z.enum(['packaged', 'discovered', 'manual']),
  reasoning: z.boolean(),
  supportedThinkingLevels: z.array(agentThinkingLevelSchema).min(1).max(7).default(['off']),
  input: z
    .array(z.enum(['text', 'image']))
    .min(1)
    .max(2),
  contextWindow: z.number().int().min(1).max(10_000_000),
  maxTokens: z.number().int().min(1).max(10_000_000),
  metadataVerified: z.boolean()
})
export type AgentModelSummary = z.infer<typeof agentModelSummarySchema>

export const modelsDevProviderLogoIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine(isModelsDevProviderLogoId, 'Unknown packaged Provider logo')

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

export const agentProviderPresetSummarySchema = z.object({
  presetId: agentPresetIdSchema,
  kind: z.enum(['builtin', 'custom']),
  providerId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  logoId: modelsDevProviderLogoIdSchema.nullable(),
  logoOverrideId: modelsDevProviderLogoIdSchema.nullable(),
  enabled: z.boolean(),
  canRefresh: z.boolean(),
  endpointEditable: z.boolean(),
  baseUrl: providerBaseUrlSchema.optional(),
  api: customAgentPiApiSchema.optional(),
  authMethods: z.array(z.enum(['api_key', 'oauth', 'ambient', 'none'])).max(4),
  authConfigured: z.boolean(),
  authSource: z.string().trim().min(1).max(200).nullable(),
  catalogStatus: z.enum(['packaged', 'current', 'stale', 'empty']),
  checkedAt: z.iso.datetime().nullable(),
  lastErrorCode: z.string().trim().min(1).max(100).nullable(),
  models: z.array(agentModelSummarySchema).max(2_000)
})
export type AgentProviderPresetSummary = z.infer<typeof agentProviderPresetSummarySchema>

export const agentProviderCatalogSchema = z.object({
  presets: z.array(agentProviderPresetSummarySchema).max(200),
  defaultSelection: agentModelSelectionSchema.nullable()
})
export type AgentProviderCatalog = z.infer<typeof agentProviderCatalogSchema>

export const agentCustomPresetInputSchema = z.object({
  presetId: agentPresetIdSchema.optional(),
  name: z.string().trim().min(1).max(200),
  logoOverrideId: modelsDevProviderLogoIdSchema.nullable().optional(),
  baseUrl: providerBaseUrlSchema,
  api: customAgentPiApiSchema,
  authMode: z.enum(['api_key', 'none']),
  timeoutMs: z.number().int().min(1_000).max(300_000).optional(),
  apiKey: z.string().trim().min(1).max(16_384).optional()
})
export type AgentCustomPresetInput = z.infer<typeof agentCustomPresetInputSchema>

export const agentPresetInputSchema = z.object({ presetId: agentPresetIdSchema })
export type AgentPresetInput = z.infer<typeof agentPresetInputSchema>
export const agentPresetCredentialInputSchema = z.object({
  presetId: agentPresetIdSchema,
  apiKey: z.string().trim().min(1).max(16_384)
})
export type AgentPresetCredentialInput = z.infer<typeof agentPresetCredentialInputSchema>

export const agentProviderEnabledInputSchema = z
  .object({
    presetId: agentPresetIdSchema,
    enabled: z.boolean()
  })
  .strict()
export type AgentProviderEnabledInput = z.infer<typeof agentProviderEnabledInputSchema>

export const agentModelEnabledInputSchema = z
  .object({
    presetId: agentPresetIdSchema,
    modelId: z.string().trim().min(1).max(500),
    enabled: z.boolean()
  })
  .strict()
export type AgentModelEnabledInput = z.infer<typeof agentModelEnabledInputSchema>

export const agentManualModelSchema = z
  .object({
    id: z.string().trim().min(1).max(500),
    name: z.string().trim().min(1).max(500),
    api: piApiSchema,
    reasoning: z.boolean(),
    input: z
      .array(z.enum(['text', 'image']))
      .min(1)
      .max(2),
    contextWindow: z.number().int().min(8_192).max(10_000_000),
    maxTokens: z.number().int().min(1).max(10_000_000)
  })
  .strict()
export type AgentManualModel = z.infer<typeof agentManualModelSchema>

export const agentManualModelInputSchema = z
  .object({
    presetId: agentPresetIdSchema,
    model: agentManualModelSchema
  })
  .strict()
export type AgentManualModelInput = z.infer<typeof agentManualModelInputSchema>

export const agentManualModelRemoveInputSchema = z
  .object({
    presetId: agentPresetIdSchema,
    modelId: z.string().trim().min(1).max(500)
  })
  .strict()
export type AgentManualModelRemoveInput = z.infer<typeof agentManualModelRemoveInputSchema>

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
      providerId: z.string().trim().min(1).max(200),
      api: piApiSchema.optional(),
      presetId: agentPresetIdSchema.optional(),
      providerName: z.string().trim().min(1).max(200).optional(),
      modelName: z.string().trim().min(1).max(500).optional(),
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
  providers: z.array(providerStatusSchema).length(5),
  agentCatalog: agentProviderCatalogSchema.default({ presets: [], defaultSelection: null })
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

export const agentPresetAuthTypeSchema = z.enum(['api_key', 'oauth'])
export const agentPresetLoginInputSchema = z.object({
  flowId: z.uuid(),
  presetId: agentPresetIdSchema,
  type: agentPresetAuthTypeSchema
})
export type AgentPresetLoginInput = z.infer<typeof agentPresetLoginInputSchema>

const agentAuthPromptSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.enum(['text', 'secret', 'manual_code']),
    message: z.string().min(1).max(2_000),
    placeholder: z.string().max(500).optional()
  }),
  z.object({
    type: z.literal('select'),
    message: z.string().min(1).max(2_000),
    options: z
      .array(
        z.object({
          id: z.string().min(1).max(500),
          label: z.string().min(1).max(500),
          description: z.string().max(1_000).optional()
        })
      )
      .min(1)
      .max(50)
  })
])

const agentAuthNoticeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('info'),
    message: z.string().min(1).max(2_000),
    links: z
      .array(z.object({ url: z.url().max(2_048), label: z.string().max(500).optional() }))
      .max(10)
      .optional()
  }),
  z.object({
    type: z.literal('auth_url'),
    url: z.url().max(2_048),
    instructions: z.string().max(2_000).optional()
  }),
  z.object({
    type: z.literal('device_code'),
    userCode: z.string().min(1).max(500),
    verificationUri: z.url().max(2_048),
    intervalSeconds: z.number().positive().max(3_600).optional(),
    expiresInSeconds: z.number().positive().max(86_400).optional()
  }),
  z.object({ type: z.literal('progress'), message: z.string().min(1).max(2_000) })
])

export const agentAuthInteractionEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('prompt'),
    flowId: z.uuid(),
    promptId: z.uuid(),
    prompt: agentAuthPromptSchema
  }),
  z.object({
    kind: z.literal('notice'),
    flowId: z.uuid(),
    notice: agentAuthNoticeSchema
  })
])
export type AgentAuthInteractionEvent = z.infer<typeof agentAuthInteractionEventSchema>

export const agentAuthPromptResponseSchema = z.object({
  flowId: z.uuid(),
  promptId: z.uuid(),
  value: z.string().max(16_384)
})
export type AgentAuthPromptResponse = z.infer<typeof agentAuthPromptResponseSchema>

export const agentAuthFlowInputSchema = z.object({ flowId: z.uuid() })
export type AgentAuthFlowInput = z.infer<typeof agentAuthFlowInputSchema>
