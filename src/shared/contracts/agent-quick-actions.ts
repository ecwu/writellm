import { z } from 'zod'

export const AGENT_QUICK_ACTION_SELECTION_MAX_LENGTH = 16_384
export const AGENT_QUICK_ACTION_INSTRUCTION_MAX_LENGTH = 4_096

export const agentQuickActionIdSchema = z.enum([
  'rewrite',
  'shorten',
  'expand',
  'adjust_tone',
  'check_evidence',
  'align_manuscript',
  'custom'
])

export const AGENT_QUICK_ACTIONS = [
  { id: 'rewrite', label: 'Rewrite', description: 'Improve clarity and flow' },
  { id: 'shorten', label: 'Shorten', description: 'Make the selection more concise' },
  { id: 'expand', label: 'Expand', description: 'Add useful detail and explanation' },
  { id: 'adjust_tone', label: 'Adjust tone', description: 'Match the manuscript voice' },
  { id: 'check_evidence', label: 'Check evidence', description: 'Review support for the claims' },
  {
    id: 'align_manuscript',
    label: 'Align with manuscript',
    description: 'Check consistency with the wider draft'
  },
  { id: 'custom', label: 'Custom instruction', description: 'Tell the Agent what to do' }
] as const satisfies readonly {
  id: z.infer<typeof agentQuickActionIdSchema>
  label: string
  description: string
}[]

const wellFormedUtf16 = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) return false
  }
  return true
}

export const agentQuickActionSelectedTextSchema = z
  .string()
  .min(1)
  .max(AGENT_QUICK_ACTION_SELECTION_MAX_LENGTH)
  .refine((value) => value.trim().length > 0, 'Selection must contain visible text')
  .refine(wellFormedUtf16, 'Selection must contain well-formed UTF-16')

export const agentQuickActionInstructionSchema = z
  .string()
  .trim()
  .min(1)
  .max(AGENT_QUICK_ACTION_INSTRUCTION_MAX_LENGTH)
  .refine(wellFormedUtf16, 'Instruction must contain well-formed UTF-16')

export const agentQuickActionRequestSchema = z
  .object({
    action: agentQuickActionIdSchema,
    customInstruction: agentQuickActionInstructionSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action === 'custom' && value.customInstruction === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['customInstruction'],
        message: 'Custom quick action requires an instruction'
      })
    }
    if (value.action !== 'custom' && value.customInstruction !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['customInstruction'],
        message: 'Only the custom quick action accepts an instruction'
      })
    }
  })

export function quickActionDefinition(action: AgentQuickActionId) {
  const definition = AGENT_QUICK_ACTIONS.find((candidate) => candidate.id === action)
  if (definition === undefined) throw new Error('Unknown Agent quick action')
  return definition
}

export type AgentQuickActionId = z.infer<typeof agentQuickActionIdSchema>
export type AgentQuickActionRequest = z.infer<typeof agentQuickActionRequestSchema>
