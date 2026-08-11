import { z } from 'zod'
import { googleGeminiImageSizeSchema, providerConfigSchema } from './providers'
import { projectSessionIdSchema } from './projects'
import { agentModelLimitsSchema, legacyAgentModelLimits } from './agent-model-limits'
import { agentRuntimeAuthSchema } from './agent-auth'

export const modelUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  cacheReadTokens: z.number().int().nonnegative().nullable(),
  cacheWriteTokens: z.number().int().nonnegative().nullable(),
  estimatedCostUsdMicros: z.number().int().nonnegative().nullable()
})
export type ModelUsage = z.infer<typeof modelUsageSchema>

export const modelExecutionMetadataSchema = z.object({
  usage: modelUsageSchema,
  responseIds: z.array(z.string().min(1).max(500)).max(100),
  retryCount: z.number().int().nonnegative().max(20),
  providerModelId: z.string().min(1).max(500),
  contextTokensUsed: z.number().int().nonnegative().nullable().optional(),
  contextTokensEstimated: z.boolean().optional()
})
export type ModelExecutionMetadata = z.infer<typeof modelExecutionMetadataSchema>

export const agentRunInputSchema = z.object({
  systemPrompt: z.string().max(65_536),
  prompt: z.string().min(1).max(262_144),
  maxOutputTokens: z.number().int().min(1).max(131_072).default(8_192),
  temperature: z.number().min(0).max(2).optional()
})
export type AgentRunInput = z.infer<typeof agentRunInputSchema>

export const agentStreamEventSchema = z.object({
  type: z.literal('text-delta'),
  delta: z.string().min(1).max(65_536)
})
export type AgentStreamEvent = z.infer<typeof agentStreamEventSchema>

export const agentRunResultSchema = z.object({
  text: z.string().max(2_097_152),
  stopReason: z.enum(['stop', 'length', 'toolUse']),
  metadata: modelExecutionMetadataSchema
})
export type AgentRunResult = z.infer<typeof agentRunResultSchema>

export const embeddingBatchInputSchema = z
  .object({
    values: z.array(z.string().min(1).max(131_072)).min(1).max(2_048)
  })
  .superRefine((input, context) => {
    const total = input.values.reduce((sum, value) => sum + value.length, 0)
    if (total > 2_097_152) {
      context.addIssue({
        code: 'custom',
        path: ['values'],
        message: 'Embedding batch is too large'
      })
    }
  })
export type EmbeddingBatchInput = z.infer<typeof embeddingBatchInputSchema>

export const embeddingBatchResultSchema = z.object({
  embeddings: z.array(z.array(z.number().finite()).min(1).max(65_536)).min(1).max(2_048),
  metadata: modelExecutionMetadataSchema
})
export type EmbeddingBatchResult = z.infer<typeof embeddingBatchResultSchema>

export const rerankInputSchema = z
  .object({
    query: z.string().min(1).max(131_072),
    documents: z.array(z.string().min(1).max(131_072)).min(1).max(2_048),
    topN: z.number().int().min(1).max(2_048)
  })
  .superRefine((input, context) => {
    if (input.topN > input.documents.length) {
      context.addIssue({ code: 'custom', path: ['topN'], message: 'topN exceeds document count' })
    }
    const total = input.query.length + input.documents.reduce((sum, value) => sum + value.length, 0)
    if (total > 2_097_152) {
      context.addIssue({
        code: 'custom',
        path: ['documents'],
        message: 'Rerank input is too large'
      })
    }
  })
export type RerankInput = z.infer<typeof rerankInputSchema>

export const rerankResultSchema = z
  .object({
    ranking: z
      .array(
        z.object({ originalIndex: z.number().int().nonnegative(), score: z.number().finite() })
      )
      .max(2_048)
      .superRefine((ranking, context) => {
        const indices = new Set<number>()
        for (const item of ranking) {
          if (indices.has(item.originalIndex)) {
            context.addIssue({
              code: 'custom',
              message: 'Reranker returned a duplicate document index'
            })
          }
          indices.add(item.originalIndex)
        }
      }),
    metadata: modelExecutionMetadataSchema
  })
  .strict()
export type RerankResult = z.infer<typeof rerankResultSchema>

export const imageGenerationInputSchema = z
  .object({
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(16_384)
      .refine(
        (value) => new TextEncoder().encode(value).byteLength <= 16_384,
        'Image prompt exceeds 16 KiB'
      ),
    aspectRatio: z.enum(['auto', '1:1', '16:9']),
    imageSize: googleGeminiImageSizeSchema
  })
  .strict()
export type ImageGenerationInput = z.infer<typeof imageGenerationInputSchema>

export const imageGenerationResultSchema = z
  .object({
    dataBase64: z.string().min(4).max(28_000_000),
    mimeType: z.enum(['image/png', 'image/jpeg']),
    effectiveImageSize: googleGeminiImageSizeSchema,
    metadata: modelExecutionMetadataSchema
  })
  .strict()
export type ImageGenerationResult = z.infer<typeof imageGenerationResultSchema>

const diagnosticErrorSchema = z.object({
  name: z.string().max(200),
  message: z.string().max(4_096),
  stack: z.string().max(32_768).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  providerCode: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{1,127}$/)
    .optional()
})

export const agentUtilityRequestSchema = z.object({
  requestId: z.uuid(),
  projectSessionId: projectSessionIdSchema.nullable().optional(),
  config: providerConfigSchema.refine((config) => config.role === 'agent'),
  credential: agentRuntimeAuthSchema,
  modelLimits: agentModelLimitsSchema.default(legacyAgentModelLimits),
  input: agentRunInputSchema
})
export type AgentUtilityRequest = z.infer<typeof agentUtilityRequestSchema>

export const agentUtilityMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text-delta'),
    requestId: z.uuid(),
    projectSessionId: projectSessionIdSchema.nullable().optional(),
    delta: z.string().min(1).max(65_536)
  }),
  z.object({
    type: z.literal('result'),
    requestId: z.uuid(),
    projectSessionId: projectSessionIdSchema.nullable().optional(),
    result: agentRunResultSchema
  }),
  z.object({
    type: z.literal('error'),
    requestId: z.uuid(),
    projectSessionId: projectSessionIdSchema.nullable().optional(),
    error: diagnosticErrorSchema
  })
])
export type AgentUtilityMessage = z.infer<typeof agentUtilityMessageSchema>

export const auxiliaryUtilityRequestSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('embedding'),
    requestId: z.uuid(),
    projectSessionId: projectSessionIdSchema.nullable().optional(),
    config: providerConfigSchema.refine((config) => config.role === 'embedding'),
    credential: z.string().min(1).max(16_384),
    input: embeddingBatchInputSchema
  }),
  z.object({
    operation: z.literal('rerank'),
    requestId: z.uuid(),
    projectSessionId: projectSessionIdSchema.nullable().optional(),
    config: providerConfigSchema.refine((config) => config.role === 'rerank'),
    credential: z.string().min(1).max(16_384),
    input: rerankInputSchema
  }),
  z.object({
    operation: z.literal('image'),
    requestId: z.uuid(),
    projectSessionId: projectSessionIdSchema,
    config: providerConfigSchema.refine((config) => config.role === 'image'),
    credential: z.string().min(1).max(16_384),
    input: imageGenerationInputSchema
  })
])
export type AuxiliaryUtilityRequest = z.infer<typeof auxiliaryUtilityRequestSchema>

export const auxiliaryUtilityResponseSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('embedding-result'),
    requestId: z.uuid(),
    projectSessionId: projectSessionIdSchema.nullable().optional(),
    result: embeddingBatchResultSchema
  }),
  z.object({
    type: z.literal('rerank-result'),
    requestId: z.uuid(),
    projectSessionId: projectSessionIdSchema.nullable().optional(),
    result: rerankResultSchema
  }),
  z.object({
    type: z.literal('image-result'),
    requestId: z.uuid(),
    projectSessionId: projectSessionIdSchema,
    result: imageGenerationResultSchema
  }),
  z.object({
    type: z.literal('error'),
    requestId: z.uuid(),
    projectSessionId: projectSessionIdSchema.nullable().optional(),
    error: diagnosticErrorSchema
  })
])
export type AuxiliaryUtilityResponse = z.infer<typeof auxiliaryUtilityResponseSchema>

export const utilityCancelMessageSchema = z
  .object({
    type: z.literal('cancel'),
    requestId: z.uuid(),
    projectSessionId: projectSessionIdSchema.nullable().optional()
  })
  .strict()
export type UtilityCancelMessage = z.infer<typeof utilityCancelMessageSchema>
