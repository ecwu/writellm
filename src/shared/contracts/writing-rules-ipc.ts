import { z } from 'zod'
import { projectSessionIdSchema } from './projects'
import { modelWritingRuleOperationSchema } from './writing-rules'

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()

export const updateWritingRulesIpcInputSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  baseBriefVersion: z.number().int().positive(),
  operations: z.array(modelWritingRuleOperationSchema).min(1).max(50)
})

export type UpdateWritingRulesIpcInput = z.input<typeof updateWritingRulesIpcInputSchema>
