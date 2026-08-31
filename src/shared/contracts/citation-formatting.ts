import { z } from 'zod'
import { citationKeySchema, cslItemSchema } from './references'

export const citationLocatorSchema = z
  .object({
    label: z.literal('page'),
    startPageIndex: z.number().int().nonnegative().max(1_000_000),
    endPageIndex: z.number().int().nonnegative().max(1_000_000)
  })
  .strict()
  .refine((locator) => locator.endPageIndex >= locator.startPageIndex)

export const citationFormatterClusterSchema = z
  .object({
    clusterId: z.string().min(1).max(256),
    items: z
      .array(
        z
          .object({ citationKey: citationKeySchema, locator: citationLocatorSchema.optional() })
          .strict()
      )
      .min(1)
      .max(100)
  })
  .strict()

export const citationFormatterStyleSchema = z
  .object({
    styleId: z.string().min(1).max(256),
    customXml: z
      .string()
      .max(1024 * 1024)
      .optional()
  })
  .strict()

export const citationFormatterRequestSchema = z
  .object({
    operation: z.literal('format_citations'),
    requestId: z.uuid(),
    projectSessionId: z.uuid(),
    snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
    style: citationFormatterStyleSchema,
    locale: z.string().min(2).max(35),
    items: z.array(cslItemSchema).max(10_000),
    clusters: z.array(citationFormatterClusterSchema).max(50_000)
  })
  .strict()

const citationFormatterSuccessSchema = z
  .object({
    type: z.literal('citation-format-result'),
    requestId: z.uuid(),
    projectSessionId: z.uuid(),
    snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
    citations: z
      .array(
        z
          .object({ clusterId: z.string().min(1).max(256), formatted: z.string().max(64_000) })
          .strict()
      )
      .max(50_000),
    bibliography: z
      .array(
        z.object({ citationKey: citationKeySchema, formatted: z.string().max(256_000) }).strict()
      )
      .max(10_000)
  })
  .strict()

const citationFormatterErrorSchema = z
  .object({
    type: z.literal('citation-format-error'),
    requestId: z.uuid(),
    projectSessionId: z.uuid(),
    snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
    error: z
      .object({
        name: z.string().min(1).max(100),
        message: z.string().min(1).max(1000)
      })
      .strict()
  })
  .strict()

export const citationFormatterResponseSchema = z.discriminatedUnion('type', [
  citationFormatterSuccessSchema,
  citationFormatterErrorSchema
])

export type CitationFormatterRequest = z.infer<typeof citationFormatterRequestSchema>
export type CitationFormatterCluster = z.infer<typeof citationFormatterClusterSchema>
export type CitationFormatterResponse = z.infer<typeof citationFormatterResponseSchema>
export type CitationFormatterResult = z.infer<typeof citationFormatterSuccessSchema>
