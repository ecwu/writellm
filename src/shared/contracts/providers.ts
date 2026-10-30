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
const httpIpv4FirstOctets = new Set(['10', '100', '127', '192'])

function supportsMineruHttp(hostname: string): boolean {
  if (loopbackHosts.has(hostname)) return true
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false
  return httpIpv4FirstOctets.has(hostname.split('.')[0] ?? '')
}

export const GOOGLE_GEMINI_IMAGE_MODELS = [
  'gemini-3.1-flash-lite-image',
  'gemini-3.1-flash-image',
  'gemini-3-pro-image',
  'gemini-2.5-flash-image'
] as const
export const imageSizeSchema = z.enum(['1K', '2K'])
export type ImageSize = z.infer<typeof imageSizeSchema>
export const GOOGLE_VERTEX_IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-3-pro-image',
  'gemini-3.1-flash-image'
] as const
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
export const XAI_IMAGE_MODELS = ['grok-imagine-image-2.0'] as const

export const imageSourceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Use lowercase letters, digits, and hyphens')
export type ImageSourceId = z.infer<typeof imageSourceIdSchema>
export const imageModelIdSchema = z.string().trim().min(1).max(200)

export const imageModelSelectionSchema = z
  .object({ sourceId: imageSourceIdSchema, modelId: imageModelIdSchema })
  .strict()
export type ImageModelSelection = z.infer<typeof imageModelSelectionSchema>

const imageSizesSchema = z
  .array(imageSizeSchema)
  .min(1)
  .max(2)
  .refine(
    (sizes) => sizes.includes('1K') && new Set(sizes).size === sizes.length,
    'Image models must support 1K and list each size once'
  )

export const imageModelDefinitionSchema = z
  .object({
    id: imageModelIdSchema,
    name: z.string().trim().min(1).max(200),
    imageSizes: imageSizesSchema
  })
  .strict()
export type ImageModelDefinition = z.infer<typeof imageModelDefinitionSchema>

export const IMAGE_TRANSPORT_LABELS: Record<ImageProviderId, string> = {
  'google-gemini': 'Google Gemini',
  'google-vertex': 'Google Vertex AI',
  openai: 'OpenAI Images',
  xai: 'xAI'
}

/** Previously reviewed built-in models; instances can add manual model IDs (ADR 093). */
export const BUILTIN_IMAGE_MODELS: Record<ImageProviderId, readonly ImageModelDefinition[]> = {
  'google-gemini': [
    { id: 'gemini-3.1-flash-lite-image', name: 'gemini-3.1-flash-lite-image', imageSizes: ['1K'] },
    { id: 'gemini-3.1-flash-image', name: 'gemini-3.1-flash-image', imageSizes: ['1K', '2K'] },
    { id: 'gemini-3-pro-image', name: 'gemini-3-pro-image', imageSizes: ['1K', '2K'] },
    { id: 'gemini-2.5-flash-image', name: 'gemini-2.5-flash-image', imageSizes: ['1K'] }
  ],
  'google-vertex': [
    { id: 'gemini-2.5-flash-image', name: 'Nano Banana', imageSizes: ['1K'] },
    { id: 'gemini-3-pro-image', name: 'Nano Banana Pro', imageSizes: ['1K', '2K'] },
    { id: 'gemini-3.1-flash-image', name: 'Nano Banana 2', imageSizes: ['1K', '2K'] }
  ],
  openai: [{ id: 'gpt-image-2', name: 'gpt-image-2', imageSizes: ['1K', '2K'] }],
  xai: [{ id: 'grok-imagine-image-2.0', name: 'grok-imagine-image-2.0', imageSizes: ['1K', '2K'] }]
}

export const OFFICIAL_IMAGE_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  xai: 'https://api.x.ai/v1'
} as const

export function effectiveImageSize(
  supported: readonly ImageSize[],
  requested: ImageSize
): ImageSize {
  return supported.includes(requested) ? requested : '1K'
}

export const providerBaseUrlSchema = z
  .url()
  .max(2_048)
  .transform((value) => value.replace(/\/+$/, ''))
  .refine((value) => {
    const url = new URL(value)
    const safeProtocol = url.protocol === 'https:' || url.protocol === 'http:'
    return (
      safeProtocol &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === ''
    )
  }, 'Use HTTP or HTTPS without credentials, query parameters, or fragments')

const mineruBaseUrlSchema = providerBaseUrlSchema.refine((value) => {
  const url = new URL(value)
  return url.protocol === 'https:' || supportsMineruHttp(url.hostname)
}, 'Use HTTPS, or HTTP for localhost and 10.*, 100.*, 127.*, or 192.* IPv4 endpoints')

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
    baseUrl: mineruBaseUrlSchema,
    providerId: z.literal('mineru'),
    embeddingDimension: z.null(),
    fileSizeLimitMb: z.number().int().min(1).max(200)
  })
])

const imageProviderCommonFields = {
  timeoutMs: providerCommonFields.timeoutMs,
  batchLimit: providerCommonFields.batchLimit,
  role: z.literal('image'),
  sourceId: imageSourceIdSchema,
  embeddingDimension: z.null(),
  fileSizeLimitMb: z.null(),
  defaultAspectRatio: z.enum(['auto', '1:1', '16:9']),
  defaultImageSize: imageSizeSchema
}

const imageSourceCommonFields = {
  ...imageProviderCommonFields,
  name: z.string().trim().min(1).max(100),
  manualModels: z.array(imageModelDefinitionSchema).max(100),
  disabledModelIds: z.array(imageModelIdSchema).max(200)
}

/** One persisted image source instance (ADR 093). */
export const imageSourceConfigSchema = z
  .discriminatedUnion('providerId', [
    z.object({ ...imageSourceCommonFields, providerId: z.literal('google-gemini') }).strict(),
    z
      .object({
        ...imageSourceCommonFields,
        providerId: z.literal('google-vertex'),
        projectId: googleCloudProjectIdSchema,
        location: googleVertexLocationSchema
      })
      .strict(),
    z
      .object({
        ...imageSourceCommonFields,
        providerId: z.literal('openai'),
        baseUrl: providerBaseUrlSchema.optional()
      })
      .strict(),
    z
      .object({
        ...imageSourceCommonFields,
        providerId: z.literal('xai'),
        baseUrl: providerBaseUrlSchema.optional()
      })
      .strict()
  ])
  .superRefine((config, context) => {
    const builtins = new Set(BUILTIN_IMAGE_MODELS[config.providerId].map((model) => model.id))
    const seen = new Set<string>()
    for (const [index, model] of config.manualModels.entries()) {
      if (builtins.has(model.id) || seen.has(model.id)) {
        context.addIssue({
          code: 'custom',
          path: ['manualModels', index, 'id'],
          message: 'Image model IDs must be unique within a source'
        })
      }
      seen.add(model.id)
    }
  })
export type ImageSourceConfig = z.infer<typeof imageSourceConfigSchema>

const imageRuntimeCommonFields = {
  ...imageProviderCommonFields,
  model: imageModelIdSchema,
  imageSizes: imageSizesSchema
}

/** The resolved source and model sent to the worker for one request. */
export const imageProviderConfigSchema = z.discriminatedUnion('providerId', [
  z.object({ ...imageRuntimeCommonFields, providerId: z.literal('google-gemini') }).strict(),
  z
    .object({
      ...imageRuntimeCommonFields,
      providerId: z.literal('google-vertex'),
      projectId: googleCloudProjectIdSchema,
      location: googleVertexLocationSchema
    })
    .strict(),
  z
    .object({
      ...imageRuntimeCommonFields,
      providerId: z.literal('openai'),
      baseUrl: providerBaseUrlSchema.optional()
    })
    .strict(),
  z
    .object({
      ...imageRuntimeCommonFields,
      providerId: z.literal('xai'),
      baseUrl: providerBaseUrlSchema.optional()
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

export const imageModelSummarySchema = imageModelDefinitionSchema.extend({
  source: z.enum(['builtin', 'manual']),
  enabled: z.boolean()
})
export type ImageModelSummary = z.infer<typeof imageModelSummarySchema>

export const imageSourceStatusSchema = z.object({
  sourceId: imageSourceIdSchema,
  providerId: imageProviderIdSchema,
  name: z.string().trim().min(1).max(100),
  label: z.string().min(1).max(100),
  config: imageSourceConfigSchema.nullable(),
  models: z.array(imageModelSummarySchema).max(300),
  configured: z.boolean(),
  available: z.boolean(),
  issues: z.array(z.string().max(500))
})
export type ImageSourceStatus = z.infer<typeof imageSourceStatusSchema>

export const imageProviderCatalogSchema = z
  .object({
    defaultSelection: imageModelSelectionSchema.nullable(),
    sources: z.array(imageSourceStatusSchema).max(50)
  })
  .superRefine((catalog, context) => {
    const seen = new Set<string>()
    for (const [index, source] of catalog.sources.entries()) {
      if (seen.has(source.sourceId)) {
        context.addIssue({
          code: 'custom',
          path: ['sources', index, 'sourceId'],
          message: 'Image source IDs must be unique'
        })
      }
      seen.add(source.sourceId)
      if (
        source.config !== null &&
        (source.config.providerId !== source.providerId ||
          source.config.sourceId !== source.sourceId)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['sources', index, 'config'],
          message: 'Image source configuration does not match its catalog entry'
        })
      }
      if (source.available && (source.config === null || !source.configured)) {
        context.addIssue({
          code: 'custom',
          path: ['sources', index, 'available'],
          message: 'An available image source must have configuration and authentication'
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
    config: providerConfigSchema.refine(
      (config) => config.role !== 'image',
      'Image sources are saved through the image source catalog'
    ),
    apiKey: z.string().trim().min(1).max(16_384).optional()
  })
  .strict()
export type ProviderSaveInput = z.infer<typeof providerSaveInputSchema>

export const providerRoleInputSchema = z
  .object({ role: z.enum(['agent', 'embedding', 'rerank', 'mineru']) })
  .strict()
export type ProviderRoleInput = z.infer<typeof providerRoleInputSchema>

const imageSourceNameSchema = z.string().trim().min(1).max(100)

export const imageSourceDraftSchema = z.discriminatedUnion('providerId', [
  z.object({ providerId: z.literal('google-gemini'), name: imageSourceNameSchema }).strict(),
  z
    .object({
      providerId: z.literal('google-vertex'),
      name: imageSourceNameSchema,
      projectId: googleCloudProjectIdSchema
    })
    .strict(),
  z
    .object({
      providerId: z.literal('openai'),
      name: imageSourceNameSchema,
      baseUrl: providerBaseUrlSchema.optional()
    })
    .strict(),
  z
    .object({
      providerId: z.literal('xai'),
      name: imageSourceNameSchema,
      baseUrl: providerBaseUrlSchema.optional()
    })
    .strict()
])
export type ImageSourceDraft = z.infer<typeof imageSourceDraftSchema>

export const imageSourceSaveInputSchema = z
  .object({
    sourceId: imageSourceIdSchema.optional(),
    source: imageSourceDraftSchema,
    apiKey: z.string().trim().min(1).max(16_384).optional()
  })
  .strict()
  .superRefine((input, context) => {
    if (input.source.providerId === 'google-vertex' && input.apiKey !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['apiKey'],
        message: 'Google Vertex AI uses local Application Default Credentials'
      })
    }
  })
export type ImageSourceSaveInput = z.infer<typeof imageSourceSaveInputSchema>

export const imageSourceInputSchema = z.object({ sourceId: imageSourceIdSchema }).strict()
export type ImageSourceInput = z.infer<typeof imageSourceInputSchema>

export const imageSourceTestInputSchema = z
  .object({ sourceId: imageSourceIdSchema, modelId: imageModelIdSchema.optional() })
  .strict()
export type ImageSourceTestInput = z.infer<typeof imageSourceTestInputSchema>

export const imageManualModelInputSchema = z
  .object({ sourceId: imageSourceIdSchema, model: imageModelDefinitionSchema })
  .strict()
export type ImageManualModelInput = z.infer<typeof imageManualModelInputSchema>

export const imageModelInputSchema = z
  .object({ sourceId: imageSourceIdSchema, modelId: imageModelIdSchema })
  .strict()
export type ImageModelInput = z.infer<typeof imageModelInputSchema>

export const imageModelEnabledInputSchema = z
  .object({ sourceId: imageSourceIdSchema, modelId: imageModelIdSchema, enabled: z.boolean() })
  .strict()
export type ImageModelEnabledInput = z.infer<typeof imageModelEnabledInputSchema>

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
