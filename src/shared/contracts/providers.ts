import { z } from 'zod'
import { isModelsDevProviderLogoId } from '../models-dev-provider-logos'

export const providerRoleSchema = z.enum(['agent', 'embedding', 'rerank', 'mineru', 'image'])
export type ProviderRole = z.infer<typeof providerRoleSchema>

export const providerIdSchema = z.enum([
  'openai-compatible',
  'cohere-compatible',
  'mineru',
  'google-gemini',
  'google-vertex',
  'openai',
  'xai'
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
export const imageSizeSchema = googleGeminiImageSizeSchema
export type ImageSize = z.infer<typeof imageSizeSchema>
export const GOOGLE_VERTEX_IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-3-pro-image',
  'gemini-3.1-flash-image'
] as const
export const googleVertexImageModelSchema = z.enum(GOOGLE_VERTEX_IMAGE_MODELS)
export type GoogleVertexImageModel = z.infer<typeof googleVertexImageModelSchema>
export const googleCloudProjectIdSchema = z
  .string()
  .trim()
  .min(6)
  .max(30)
  .regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, 'Use a valid Google Cloud Project ID')
export const googleVertexLocationSchema = z.literal('global')
export const IMAGE_PROVIDER_IDS = ['google-gemini', 'google-vertex', 'openai', 'xai'] as const
export const imageProviderIdSchema = z.enum(IMAGE_PROVIDER_IDS)
export type ImageProviderId = z.infer<typeof imageProviderIdSchema>
export const OPENAI_IMAGE_MODELS = ['gpt-image-2'] as const
export const openAiImageModelSchema = z.enum(OPENAI_IMAGE_MODELS)
export const XAI_IMAGE_MODELS = ['grok-imagine-image-2.0'] as const
export const xAiImageModelSchema = z.enum(XAI_IMAGE_MODELS)
export const GOOGLE_GEMINI_IMAGE_MODEL_SIZES = {
  'gemini-3.1-flash-lite-image': ['1K'],
  'gemini-3.1-flash-image': ['1K', '2K'],
  'gemini-3-pro-image': ['1K', '2K'],
  'gemini-2.5-flash-image': ['1K']
} as const satisfies Record<GoogleGeminiImageModel, readonly GoogleGeminiImageSize[]>
export const GOOGLE_VERTEX_IMAGE_MODEL_SIZES = {
  'gemini-2.5-flash-image': ['1K'],
  'gemini-3-pro-image': ['1K', '2K'],
  'gemini-3.1-flash-image': ['1K', '2K']
} as const satisfies Record<GoogleVertexImageModel, readonly GoogleGeminiImageSize[]>

export function effectiveGoogleGeminiImageSize(
  model: GoogleGeminiImageModel,
  requested: GoogleGeminiImageSize
): GoogleGeminiImageSize {
  const supported: readonly GoogleGeminiImageSize[] = GOOGLE_GEMINI_IMAGE_MODEL_SIZES[model]
  return supported.includes(requested) ? requested : '1K'
}

export function effectiveGoogleVertexImageSize(
  model: GoogleVertexImageModel,
  requested: GoogleGeminiImageSize
): GoogleGeminiImageSize {
  const supported: readonly GoogleGeminiImageSize[] = GOOGLE_VERTEX_IMAGE_MODEL_SIZES[model]
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
  defaultSelection: agentModelSelectionSchema.nullable(),
  defaultThinkingLevel: agentThinkingLevelSchema.optional()
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

const nonImageProviderConfigSchema = z.discriminatedUnion('role', [
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
  })
])

const imageProviderCommonFields = {
  timeoutMs: providerCommonFields.timeoutMs,
  batchLimit: providerCommonFields.batchLimit,
  role: z.literal('image'),
  embeddingDimension: z.null(),
  fileSizeLimitMb: z.null(),
  defaultAspectRatio: z.enum(['auto', '1:1', '16:9']),
  defaultImageSize: imageSizeSchema
}

export const imageProviderConfigSchema = z.discriminatedUnion('providerId', [
  z
    .object({
      ...imageProviderCommonFields,
      baseUrl: z
        .enum([
          'https://generativelanguage.googleapis.com',
          'https://generativelanguage.googleapis.com/v1beta'
        ])
        .optional(),
      model: googleGeminiImageModelSchema,
      providerId: z.literal('google-gemini')
    })
    .strict()
    .transform(({ baseUrl: _legacyBaseUrl, ...current }) => current),
  z
    .object({
      ...imageProviderCommonFields,
      providerId: z.literal('google-vertex'),
      projectId: googleCloudProjectIdSchema,
      location: googleVertexLocationSchema,
      model: googleVertexImageModelSchema
    })
    .strict(),
  z
    .object({
      ...imageProviderCommonFields,
      providerId: z.literal('openai'),
      model: openAiImageModelSchema
    })
    .strict(),
  z
    .object({
      ...imageProviderCommonFields,
      providerId: z.literal('xai'),
      model: xAiImageModelSchema
    })
    .strict()
])

export const providerConfigSchema = z
  .union([nonImageProviderConfigSchema, imageProviderConfigSchema])
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
export type ImageProviderConfig = z.infer<typeof imageProviderConfigSchema>

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

export const imageProviderStatusSchema = z.object({
  providerId: imageProviderIdSchema,
  label: z.string().min(1).max(100),
  models: z.array(z.string().min(1).max(200)).min(1).max(4),
  config: imageProviderConfigSchema.nullable(),
  configured: z.boolean(),
  available: z.boolean(),
  active: z.boolean(),
  issues: z.array(z.string().max(500))
})
export type ImageProviderStatus = z.infer<typeof imageProviderStatusSchema>

const fixedImageCatalog = [
  {
    providerId: 'google-gemini',
    label: 'Google Gemini',
    models: GOOGLE_GEMINI_IMAGE_MODELS
  },
  {
    providerId: 'google-vertex',
    label: 'Google Vertex AI',
    models: GOOGLE_VERTEX_IMAGE_MODELS
  },
  { providerId: 'openai', label: 'OpenAI', models: OPENAI_IMAGE_MODELS },
  { providerId: 'xai', label: 'xAI', models: XAI_IMAGE_MODELS }
] as const

export const imageProviderCatalogSchema = z
  .object({
    activeProviderId: imageProviderIdSchema.nullable(),
    sources: z.tuple([
      imageProviderStatusSchema,
      imageProviderStatusSchema,
      imageProviderStatusSchema,
      imageProviderStatusSchema
    ])
  })
  .superRefine((catalog, context) => {
    for (const [index, expected] of fixedImageCatalog.entries()) {
      const source = catalog.sources[index]
      if (
        source.providerId !== expected.providerId ||
        source.label !== expected.label ||
        source.models.length !== expected.models.length ||
        source.models.some((model, modelIndex) => model !== expected.models[modelIndex])
      ) {
        context.addIssue({
          code: 'custom',
          path: ['sources', index],
          message: 'Image provider catalog entry does not match the fixed directory'
        })
      }
      if (source.config !== null && source.config.providerId !== source.providerId) {
        context.addIssue({
          code: 'custom',
          path: ['sources', index, 'config'],
          message: 'Image provider configuration does not match its catalog entry'
        })
      }
      if (source.active !== (catalog.activeProviderId === source.providerId)) {
        context.addIssue({
          code: 'custom',
          path: ['sources', index, 'active'],
          message: 'Image provider active state does not match the catalog selection'
        })
      }
      if (source.available && (source.config === null || !source.configured)) {
        context.addIssue({
          code: 'custom',
          path: ['sources', index, 'available'],
          message: 'An available image provider must have configuration and authentication'
        })
      }
    }
  })
export type ImageProviderCatalog = z.infer<typeof imageProviderCatalogSchema>

export const providerSettingsSnapshotSchema = z.object({
  credentialBackend: credentialBackendStatusSchema,
  providers: z.array(providerStatusSchema).length(5),
  imageCatalog: imageProviderCatalogSchema,
  agentCatalog: agentProviderCatalogSchema.default({ presets: [], defaultSelection: null })
})
export type ProviderSettingsSnapshot = z.infer<typeof providerSettingsSnapshotSchema>

export const providerSaveInputSchema = z
  .object({
    config: providerConfigSchema,
    apiKey: z.string().trim().min(1).max(16_384).optional()
  })
  .superRefine((input, context) => {
    if (
      input.config.role === 'image' &&
      input.config.providerId === 'google-vertex' &&
      input.apiKey !== undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['apiKey'],
        message: 'Google Vertex AI uses local Application Default Credentials'
      })
    }
  })
export type ProviderSaveInput = z.infer<typeof providerSaveInputSchema>

export const providerRoleInputSchema = z.union([
  z.object({ role: z.enum(['agent', 'embedding', 'rerank', 'mineru']) }).strict(),
  z.object({ role: z.literal('image'), providerId: imageProviderIdSchema }).strict()
])
export type ProviderRoleInput = z.infer<typeof providerRoleInputSchema>

export const imageProviderSelectionInputSchema = z
  .object({ providerId: imageProviderIdSchema })
  .strict()
export type ImageProviderSelectionInput = z.infer<typeof imageProviderSelectionInputSchema>

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
