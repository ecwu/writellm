import { z } from 'zod'
import { publicationOptionsSchema } from './publication'

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()

export const publicationPresetIdSchema = z
  .string()
  .regex(
    /^(?:builtin:[a-z0-9-]{1,48}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u
  )

export const publicationPresetSchema = strictObject({
  schemaVersion: z.literal(1),
  presetId: publicationPresetIdSchema,
  name: z.string().trim().min(1).max(80),
  origin: z.enum(['application', 'user']),
  options: publicationOptionsSchema,
  isDefault: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})

export const publicationPresetSnapshotSchema = strictObject({
  schemaVersion: z.literal(1),
  defaultPresetId: publicationPresetIdSchema,
  presets: z.array(publicationPresetSchema).min(1).max(23)
}).superRefine((snapshot, context) => {
  const defaults = snapshot.presets.filter((preset) => preset.isDefault)
  if (defaults.length !== 1 || defaults[0]?.presetId !== snapshot.defaultPresetId) {
    context.addIssue({ code: 'custom', message: 'Publication preset default is inconsistent' })
  }
})

export const createPublicationPresetInputSchema = strictObject({
  name: z.string().trim().min(1).max(80),
  options: publicationOptionsSchema
})

export const updatePublicationPresetInputSchema = strictObject({
  presetId: publicationPresetIdSchema,
  name: z.string().trim().min(1).max(80),
  options: publicationOptionsSchema
})

export const publicationPresetIdInputSchema = strictObject({ presetId: publicationPresetIdSchema })

export type PublicationPreset = z.infer<typeof publicationPresetSchema>
export type PublicationPresetSnapshot = z.infer<typeof publicationPresetSnapshotSchema>
export type CreatePublicationPresetInput = z.infer<typeof createPublicationPresetInputSchema>
export type UpdatePublicationPresetInput = z.infer<typeof updatePublicationPresetInputSchema>
