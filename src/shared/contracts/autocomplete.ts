import { z } from 'zod'
import { logContextSchema } from '../observability/log-schema'
import { projectSessionIdSchema } from './projects'

export const AUTOCOMPLETE_MODELS = ['deepseek-flash', 'deepseek-v4-pro'] as const
export const autocompleteModelSchema = z.enum(AUTOCOMPLETE_MODELS)
export const autocompleteSelectionSchema = z
  .object({
    providerPresetId: z.literal('builtin:deepseek'),
    modelId: autocompleteModelSchema
  })
  .strict()
export const autocompleteStyleSchema = z.enum(['word', 'sentence', 'paragraph'])
export type AutocompleteStyle = z.infer<typeof autocompleteStyleSchema>
export const autocompleteChangeSchema = z
  .object({ reason: z.enum(['model', 'provider', 'style']) })
  .strict()
export type AutocompleteChange = z.infer<typeof autocompleteChangeSchema>
export const autocompleteTriggerSchema = z.enum([
  'edit',
  'cursor',
  'accept',
  'focus',
  'composition',
  'configuration'
])
export const autocompleteCancelReasonSchema = z.enum([
  'edit',
  'cursor',
  'dismiss',
  'history',
  'blur',
  'menu',
  'composition',
  'configuration',
  'disabled',
  'revoked',
  'superseded',
  'consumed',
  'destroy'
])
export type AutocompleteTrigger = z.infer<typeof autocompleteTriggerSchema>
export type AutocompleteCancelReason = z.infer<typeof autocompleteCancelReasonSchema>
export const autocompleteSettingsSchema = z
  .object({
    selection: autocompleteSelectionSchema.nullable(),
    style: autocompleteStyleSchema,
    available: z.boolean()
  })
  .strict()
export const autocompleteSessionInputSchema = z
  .object({ projectSessionId: projectSessionIdSchema })
  .strict()
export const autocompleteToggleInputSchema = autocompleteSessionInputSchema.extend({
  enabled: z.boolean()
})
export const autocompleteSessionSchema = autocompleteSettingsSchema.extend({ enabled: z.boolean() })
const text = (maximum: number) =>
  z
    .string()
    .max(maximum * 2)
    .refine((value) => [...value].length <= maximum)
export const autocompleteRequestSchema = autocompleteSessionInputSchema
  .extend({
    requestId: z.uuid(),
    sectionId: z.uuid(),
    blockId: z.string().min(1).max(128),
    generation: z.number().int().nonnegative(),
    trigger: autocompleteTriggerSchema.optional(),
    prefix: text(8_000).refine((value) => value.length > 0),
    suffix: text(2_000),
    atBlockEnd: z.boolean()
  })
  .refine((value) => !value.atBlockEnd || value.suffix === '', 'Block-end requests have no suffix')
export const autocompleteRequestIdentitySchema = autocompleteSessionInputSchema.extend({
  requestId: z.uuid()
})
export const autocompleteCancelSchema = autocompleteRequestIdentitySchema.extend({
  reason: autocompleteCancelReasonSchema.optional()
})
export const autocompleteResultSchema = z
  .object({
    requestId: z.uuid(),
    generation: z.number().int().nonnegative(),
    status: z.enum([
      'suggestion',
      'empty',
      'cancelled',
      'unavailable',
      'paused',
      'cooldown',
      'failed'
    ]),
    text: z.string().max(4_096),
    retryAt: z.number().finite().nonnegative().optional()
  })
  .strict()
export const autocompleteUsageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative()
})
export const autocompleteWorkerRequestSchema = z
  .object({
    operation: z.literal('autocomplete'),
    requestId: z.uuid(),
    projectSessionId: projectSessionIdSchema,
    context: logContextSchema,
    modelId: autocompleteModelSchema,
    credential: z.string().min(1).max(16_384),
    style: autocompleteStyleSchema,
    input: autocompleteRequestSchema
  })
  .strict()
  .refine(
    (value) =>
      value.requestId === value.input.requestId &&
      value.projectSessionId === value.input.projectSessionId
  )
export const autocompleteWorkerResultSchema = z
  .object({
    type: z.literal('autocomplete-result'),
    requestId: z.uuid(),
    projectSessionId: projectSessionIdSchema,
    text: z.string().max(4_096),
    usage: autocompleteUsageSchema.optional(),
    originalCharacters: z.number().int().nonnegative().max(16_384).optional(),
    displayedCharacters: z.number().int().nonnegative().max(480).optional(),
    error: z
      .object({
        name: z.string().max(128),
        message: z.string().max(256),
        stack: z.string().max(16_384).optional(),
        httpStatus: z.number().int().optional(),
        retryAt: z.number().finite().nonnegative().optional()
      })
      .strict()
      .optional()
  })
  .strict()
export type AutocompleteSelection = z.infer<typeof autocompleteSelectionSchema>
export type AutocompleteSettings = z.infer<typeof autocompleteSettingsSchema>
export type AutocompleteSession = z.infer<typeof autocompleteSessionSchema>
export type AutocompleteRequest = z.infer<typeof autocompleteRequestSchema>
export type AutocompleteResult = z.infer<typeof autocompleteResultSchema>
export type AutocompleteWorkerRequest = z.infer<typeof autocompleteWorkerRequestSchema>
export type AutocompleteWorkerResult = z.infer<typeof autocompleteWorkerResultSchema>
export interface AutocompleteApi {
  settings(): Promise<AutocompleteSettings>
  select(input: AutocompleteSelection | null): Promise<AutocompleteSettings>
  setStyle(input: AutocompleteStyle): Promise<AutocompleteSettings>
  session(input: z.infer<typeof autocompleteSessionInputSchema>): Promise<AutocompleteSession>
  toggle(input: z.infer<typeof autocompleteToggleInputSchema>): Promise<AutocompleteSession>
  complete(input: AutocompleteRequest): Promise<AutocompleteResult>
  cancel(input: z.infer<typeof autocompleteCancelSchema>): Promise<void>
  accepted(input: z.infer<typeof autocompleteRequestIdentitySchema>): Promise<void>
  subscribeChanges(listener: (change: AutocompleteChange) => void): () => void
}
