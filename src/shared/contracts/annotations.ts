import { z } from 'zod'
import { projectSessionIdSchema } from './projects'

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()

export const annotationKindSchema = z.enum(['note', 'todo'])
export const annotationStatusSchema = z.enum(['open', 'resolved'])
export const annotationAnchorStatusSchema = z.enum(['current', 'orphaned'])
export const annotationBodySchema = z.string().trim().min(1).max(8_192)
export const annotationTextAnchorSchema = z.string().trim().min(1).max(512)

export const annotationRecordSchema = strictObject({
  annotationId: z.uuid(),
  kind: annotationKindSchema,
  status: annotationStatusSchema,
  body: annotationBodySchema,
  sectionId: z.uuid(),
  blockId: z.string().min(1).max(256),
  anchorRevisionId: z.uuid(),
  textAnchor: annotationTextAnchorSchema.nullable(),
  textAnchorFingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
  anchorStatus: annotationAnchorStatusSchema,
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable()
})

export const createAnnotationInputSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  kind: annotationKindSchema,
  body: annotationBodySchema,
  sectionId: z.uuid(),
  blockId: z.string().min(1).max(256),
  textAnchor: annotationTextAnchorSchema.optional()
})

export const listAnnotationsInputSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  statuses: z.array(annotationStatusSchema).max(2).default([]),
  kinds: z.array(annotationKindSchema).max(2).default([]),
  sectionId: z.uuid().optional(),
  cursor: z.string().min(1).max(128).optional(),
  limit: z.number().int().min(1).max(100).default(50)
})

export const listAnnotationsResultSchema = strictObject({
  annotations: z.array(annotationRecordSchema).max(100),
  nextCursor: z.string().min(1).max(128).nullable(),
  total: z.number().int().nonnegative()
})

export const annotationUserOperationSchema = z.discriminatedUnion('action', [
  strictObject({
    action: z.literal('edit'),
    annotationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    kind: annotationKindSchema,
    body: annotationBodySchema
  }),
  strictObject({
    action: z.literal('resolve'),
    annotationId: z.uuid(),
    expectedVersion: z.number().int().positive()
  }),
  strictObject({
    action: z.literal('reopen'),
    annotationId: z.uuid(),
    expectedVersion: z.number().int().positive()
  })
])

export const updateAnnotationInputSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  operation: annotationUserOperationSchema
})

export const annotationSelectionSchema = z.array(z.uuid()).max(10).default([])

export type AnnotationKind = z.infer<typeof annotationKindSchema>
export type AnnotationStatus = z.infer<typeof annotationStatusSchema>
export type AnnotationRecord = z.infer<typeof annotationRecordSchema>
export type AnnotationUserOperation = z.infer<typeof annotationUserOperationSchema>
export type CreateAnnotationInput = z.infer<typeof createAnnotationInputSchema>
export type ListAnnotationsInput = z.input<typeof listAnnotationsInputSchema>
export type ListAnnotationsResult = z.infer<typeof listAnnotationsResultSchema>
export type UpdateAnnotationInput = z.infer<typeof updateAnnotationInputSchema>
