import { z } from 'zod'
import { publicationPresetIdSchema } from './publication-presets'
import { sectionStatusSchema } from './manuscript'
import { writingRuleCategorySchema } from './writing-rules'

export const PROJECT_TEMPLATE_FORMAT = 'writellm-project-template'
export const PROJECT_TEMPLATE_FORMAT_VERSION = 1
export const MAX_USER_PROJECT_TEMPLATES = 50

const boundedText = (maximum: number) => z.string().trim().max(maximum)

export const projectTemplateBriefSchema = z
  .object({
    description: boundedText(10_000),
    topic: boundedText(2_000),
    targetAudience: boundedText(2_000),
    language: boundedText(200),
    styleTone: boundedText(2_000),
    scopeExclusions: boundedText(5_000),
    targetLength: boundedText(500),
    citationRequirements: boundedText(5_000),
    additionalInstructions: boundedText(10_000)
  })
  .strict()

export const projectTemplateOutlineItemSchema = z
  .object({
    templateKey: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    parentTemplateKey: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
      .nullable(),
    title: z.string().trim().min(1).max(500),
    objective: z.string().trim().max(5_000).nullable(),
    status: sectionStatusSchema
  })
  .strict()

export const projectTemplateWritingRuleSchema = z
  .object({
    category: writingRuleCategorySchema,
    instruction: z.string().trim().min(1).max(4_096),
    preferredForm: z.string().trim().min(1).max(500).nullable(),
    discouragedForms: z.array(z.string().trim().min(1).max(500)).max(20),
    rationale: z.string().trim().min(1).max(4_096).nullable(),
    active: z.boolean()
  })
  .strict()

export const projectTemplateSchema = z
  .object({
    format: z.literal(PROJECT_TEMPLATE_FORMAT),
    formatVersion: z.literal(PROJECT_TEMPLATE_FORMAT_VERSION),
    templateId: z.uuid(),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(1_000),
    brief: projectTemplateBriefSchema,
    outline: z.array(projectTemplateOutlineItemSchema).min(1).max(100),
    writingRules: z.array(projectTemplateWritingRuleSchema).max(100),
    publicationPresetId: publicationPresetIdSchema.nullable()
  })
  .strict()
  .superRefine((template, context) => {
    const keys = new Set(template.outline.map((item) => item.templateKey))
    if (keys.size !== template.outline.length) {
      context.addIssue({ code: 'custom', message: 'Template outline keys must be unique' })
    }
    const seen = new Set<string>()
    for (const [index, item] of template.outline.entries()) {
      if (item.parentTemplateKey !== null && !seen.has(item.parentTemplateKey)) {
        context.addIssue({
          code: 'custom',
          path: ['outline', index, 'parentTemplateKey'],
          message: 'Template parents must precede their children'
        })
      }
      seen.add(item.templateKey)
    }
  })

export const projectTemplateSummarySchema = z
  .object({
    templateId: z.uuid(),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(1_000),
    origin: z.enum(['application', 'user']),
    integrity: z.enum(['ready', 'integrity_failed']),
    sectionCount: z.number().int().min(1).max(100),
    writingRuleCount: z.number().int().min(0).max(100),
    hasPublicationPreset: z.boolean()
  })
  .strict()

export const projectTemplateCatalogSchema = z.array(projectTemplateSummarySchema).max(60)

export const projectTemplateExtractionPreviewSchema = z
  .object({
    briefFields: z.array(z.string().min(1).max(100)).max(9),
    outlineTitles: z.array(z.string().min(1).max(500)).min(1).max(100),
    writingRuleCount: z.number().int().min(0).max(100),
    publicationPresetId: publicationPresetIdSchema.nullable(),
    excluded: z.array(z.string().min(1).max(200)).min(1).max(20)
  })
  .strict()

export const saveUserProjectTemplateInputSchema = z
  .object({
    projectSessionId: z.uuid(),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(1_000),
    includePublicationPreset: z.boolean()
  })
  .strict()

export const deleteUserProjectTemplateInputSchema = z.object({ templateId: z.uuid() }).strict()

export type ProjectTemplate = z.infer<typeof projectTemplateSchema>
export type ProjectTemplateSummary = z.infer<typeof projectTemplateSummarySchema>
export type ProjectTemplateExtractionPreview = z.infer<
  typeof projectTemplateExtractionPreviewSchema
>
