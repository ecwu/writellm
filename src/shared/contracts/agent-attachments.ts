import { z } from 'zod'
import { projectSessionIdSchema } from './projects'

export const AGENT_IMAGE_MAX_BYTES = 20 * 1024 * 1024
export const AGENT_IMAGE_MAX_BASE64 = Math.floor(4.5 * 1024 * 1024)
export const AGENT_IMAGES_MAX_BASE64 = 32 * 1024 * 1024
export const agentAttachmentIdsSchema = z
  .array(z.uuid())
  .max(4)
  .refine((ids) => new Set(ids).size === ids.length, 'Image attachments must be unique')
export const agentImageMimeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp'])
export const agentImageContentSchema = z
  .object({
    type: z.literal('image'),
    data: z
      .string()
      .min(4)
      .max(AGENT_IMAGE_MAX_BASE64 - 1),
    mimeType: agentImageMimeSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().positive().max(2000),
    height: z.number().int().positive().max(2000)
  })
  .strict()
export const agentImagesSchema = z.array(agentImageContentSchema).max(4)
export const agentSummaryImagesSchema = z
  .array(agentImageContentSchema)
  .refine((images) => imageDataBytes(images) <= AGENT_IMAGES_MAX_BASE64, 'Images exceed 32 MiB')
export type AgentImageContent = z.infer<typeof agentImageContentSchema>

export const agentAttachmentScopeSchema = z
  .object({
    projectSessionId: projectSessionIdSchema,
    agentSessionId: z.uuid()
  })
  .strict()
export const agentAttachmentImportSchema = agentAttachmentScopeSchema.extend({
  dataBase64: z
    .string()
    .min(4)
    .max(Math.ceil(AGENT_IMAGE_MAX_BYTES / 3) * 4)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  mimeType: agentImageMimeSchema,
  name: z.string().min(1).max(500)
})
export const agentAttachmentActionSchema = agentAttachmentScopeSchema.extend({
  attachmentId: z.uuid()
})
export const agentAttachmentSchema = z
  .object({
    attachmentId: z.uuid(),
    name: z.string().min(1).max(500),
    mimeType: agentImageMimeSchema,
    byteSize: z.number().int().positive().max(AGENT_IMAGE_MAX_BYTES),
    width: z.number().int().positive().max(2000),
    height: z.number().int().positive().max(2000),
    previewUrl: z.string().url().max(2048)
  })
  .strict()
export const agentAttachmentSelectSchema = agentAttachmentScopeSchema.extend({
  remaining: z.number().int().min(1).max(4)
})
export const agentAttachmentSelectionSchema = z
  .object({
    attachments: z.array(agentAttachmentSchema).max(4),
    errors: z.array(z.string().max(1000)).max(4)
  })
  .strict()
export type AgentAttachment = z.infer<typeof agentAttachmentSchema>

export const agentImageProcessRequestSchema = z
  .object({
    operation: z.literal('process_agent_image'),
    requestId: z.uuid(),
    projectSessionId: projectSessionIdSchema,
    dataBase64: agentAttachmentImportSchema.shape.dataBase64,
    mimeType: agentImageMimeSchema
  })
  .strict()
export const agentImageProcessResultSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('agent-image-result'),
      requestId: z.uuid(),
      projectSessionId: projectSessionIdSchema,
      image: agentImageContentSchema
    })
    .strict(),
  z
    .object({
      type: z.literal('agent-image-error'),
      requestId: z.uuid(),
      projectSessionId: projectSessionIdSchema,
      error: z.object({ name: z.string().max(200), message: z.string().max(1000) }).strict()
    })
    .strict()
])

export function imageDataBytes(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((total, entry) => total + imageDataBytes(entry), 0)
  if (value === null || typeof value !== 'object') return 0
  const record = value as Record<string, unknown>
  if (record['type'] === 'image' && typeof record['data'] === 'string') return record['data'].length
  return Object.values(record).reduce<number>((total, entry) => total + imageDataBytes(entry), 0)
}

export function imageMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(imageMetadata)
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (record['type'] === 'image' && typeof record['data'] === 'string') {
    const { data, ...metadata } = record
    return { ...metadata, base64Bytes: (data as string).length }
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, imageMetadata(entry)])
  )
}

export function agentMessageTextBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(imageMetadata(value))).byteLength
}
