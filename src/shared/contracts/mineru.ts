import { z } from 'zod'
import { providerConfigSchema } from './providers'

export const mineruRemoteStateSchema = z.enum([
  'waiting-file',
  'pending',
  'running',
  'converting',
  'done',
  'failed'
])
export type MineruRemoteState = z.infer<typeof mineruRemoteStateSchema>

const mineruConfigSchema = providerConfigSchema.refine((config) => config.role === 'mineru')
const credentialSchema = z.string().min(1).max(16_384)
const identifierSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
const internalPathSchema = z.string().min(1).max(32_768)
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const rawFileSchema = z.object({
  relativePath: z.string().min(1).max(1_024),
  sha256: sha256Schema,
  byteSize: z.number().int().nonnegative()
})
const normalizedAssetRecordSchema = z.object({
  relativePath: z.string().regex(/^images\/[a-f0-9]{64}\.[a-z0-9]+$/),
  sha256: sha256Schema,
  byteSize: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']),
  sourceRelativePath: z.string().min(1).max(1_024)
})
const signedUrlSchema = z
  .url()
  .max(16_384)
  .refine((value) => {
    const url = new URL(value)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    return (
      (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) &&
      url.username === '' &&
      url.password === '' &&
      url.hash === ''
    )
  }, 'Signed URL must use HTTPS or loopback HTTP')

export const mineruUtilityRequestSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('allocate'),
    requestId: z.uuid(),
    config: mineruConfigSchema,
    credential: credentialSchema,
    parseTaskId: identifierSchema,
    fileName: z.string().min(1).max(200)
  }),
  z.object({
    operation: z.literal('upload'),
    requestId: z.uuid(),
    uploadUrl: signedUrlSchema,
    sourcePath: internalPathSchema,
    expectedBytes: z
      .number()
      .int()
      .positive()
      .max(200 * 1024 * 1024)
  }),
  z.object({
    operation: z.literal('poll'),
    requestId: z.uuid(),
    config: mineruConfigSchema,
    credential: credentialSchema,
    parseTaskId: identifierSchema,
    remoteTaskId: identifierSchema
  }),
  z.object({
    operation: z.literal('download'),
    requestId: z.uuid(),
    downloadUrl: signedUrlSchema,
    destinationPath: internalPathSchema,
    maxBytes: z
      .number()
      .int()
      .positive()
      .max(512 * 1024 * 1024)
  }),
  z.object({
    operation: z.literal('normalize'),
    requestId: z.uuid(),
    rawRoot: internalPathSchema,
    stagingPath: internalPathSchema,
    parseRevisionId: z.uuid(),
    normalizerVersion: z.number().int().positive().max(1_000_000),
    files: z.array(rawFileSchema).min(1).max(5_000)
  })
])
export type MineruUtilityRequest = z.infer<typeof mineruUtilityRequestSchema>

const diagnosticSchema = z.object({
  name: z.string().min(1).max(200),
  message: z.string().min(1).max(500),
  stack: z.string().max(32_768).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  providerCode: z.string().max(100).optional(),
  retryable: z.boolean()
})

export const mineruUtilityResponseSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('allocated'),
    requestId: z.uuid(),
    remoteTaskId: identifierSchema,
    uploadUrl: signedUrlSchema,
    traceId: z.string().min(1).max(256).nullable()
  }),
  z.object({
    type: z.literal('uploaded'),
    requestId: z.uuid(),
    byteSize: z.number().int().positive()
  }),
  z.object({
    type: z.literal('polled'),
    requestId: z.uuid(),
    remoteState: mineruRemoteStateSchema,
    downloadUrl: signedUrlSchema.optional(),
    traceId: z.string().min(1).max(256).nullable(),
    extractedPages: z.number().int().nonnegative().nullable(),
    totalPages: z.number().int().positive().nullable(),
    remoteErrorCode: z.string().min(1).max(100).nullable()
  }),
  z.object({
    type: z.literal('downloaded'),
    requestId: z.uuid(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    byteSize: z.number().int().positive(),
    contentType: z.string().max(200).nullable()
  }),
  z.object({
    type: z.literal('normalized'),
    requestId: z.uuid(),
    blocksSha256: sha256Schema,
    documentSha256: sha256Schema,
    blockCount: z.number().int().positive().max(20_000),
    assets: z.array(normalizedAssetRecordSchema).max(5_000)
  }),
  z.object({ type: z.literal('error'), requestId: z.uuid(), error: diagnosticSchema })
])
export type MineruUtilityResponse = z.infer<typeof mineruUtilityResponseSchema>

export const mineruRawManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    parseRevisionId: z.uuid(),
    knowledgeItemId: z.uuid(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    providerId: z.literal('mineru'),
    providerApiVersion: z.literal('v4'),
    providerFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    modelVersion: z.enum(['pipeline', 'vlm', 'MinerU-HTML']),
    remoteTaskId: identifierSchema,
    archive: z.object({
      relativePath: z.literal('raw/provider-result.zip'),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      byteSize: z.number().int().positive()
    }),
    files: z
      .array(
        z.object({
          relativePath: z.string().min(1).max(1_024),
          sha256: sha256Schema,
          byteSize: z.number().int().nonnegative()
        })
      )
      .max(5_000),
    createdAt: z.iso.datetime()
  })
  .strict()
export type MineruRawManifest = z.infer<typeof mineruRawManifestSchema>
