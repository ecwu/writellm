import { z } from 'zod'

export const WRITING_RULES_NAMESPACE = 'writingRulesV1'
export const MAX_WRITING_RULES = 100
export const MAX_ACTIVE_WRITING_RULES = 50
export const MAX_ACTIVE_WRITING_RULE_BYTES = 32 * 1024

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()
const optionalText = (maximum: number) => z.string().trim().min(1).max(maximum).nullable()

export const writingRuleCategorySchema = z.enum([
  'terminology',
  'translation',
  'style',
  'academic',
  'evidence',
  'other'
])

export const writingRuleSchema = strictObject({
  ruleId: z.uuid(),
  category: writingRuleCategorySchema,
  instruction: z.string().trim().min(1).max(4_096),
  preferredForm: optionalText(500),
  discouragedForms: z
    .array(z.string().trim().min(1).max(500))
    .max(20)
    .refine((values) => new Set(values.map(normalizeRuleText)).size === values.length, {
      message: 'Discouraged forms must be unique'
    }),
  rationale: optionalText(4_096),
  active: z.boolean()
})

export const writingRulesStateSchema = strictObject({
  schemaVersion: z.literal(1),
  rules: z
    .array(writingRuleSchema)
    .max(MAX_WRITING_RULES)
    .refine((rules) => new Set(rules.map((rule) => rule.ruleId)).size === rules.length, {
      message: 'Writing rule IDs must be unique'
    })
}).superRefine((state, context) => {
  const active = state.rules.filter((rule) => rule.active)
  if (active.length > MAX_ACTIVE_WRITING_RULES) {
    context.addIssue({ code: 'custom', message: 'Too many active writing rules' })
  }
  if (new TextEncoder().encode(JSON.stringify(active)).byteLength > MAX_ACTIVE_WRITING_RULE_BYTES) {
    context.addIssue({
      code: 'custom',
      message: 'Active writing rules exceed their context budget'
    })
  }
  const preferredByDiscouraged = new Map<string, string>()
  for (const rule of active) {
    const preferred = rule.preferredForm === null ? null : normalizeRuleText(rule.preferredForm)
    for (const discouraged of rule.discouragedForms) {
      const normalized = normalizeRuleText(discouraged)
      const previous = preferredByDiscouraged.get(normalized)
      if (previous !== undefined && previous !== preferred) {
        context.addIssue({
          code: 'custom',
          message: `Active writing rules conflict for discouraged form: ${discouraged}`
        })
      } else if (preferred !== null) {
        preferredByDiscouraged.set(normalized, preferred)
      }
    }
  }
  for (const rule of active) {
    if (
      rule.preferredForm !== null &&
      preferredByDiscouraged.has(normalizeRuleText(rule.preferredForm))
    ) {
      context.addIssue({
        code: 'custom',
        message: `An active preferred form is discouraged by another rule: ${rule.preferredForm}`
      })
    }
  }
})

const writingRuleFieldsSchema = strictObject({
  category: writingRuleCategorySchema,
  instruction: z.string().trim().min(1).max(4_096),
  preferredForm: optionalText(500).default(null),
  discouragedForms: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  rationale: optionalText(4_096).default(null),
  active: z.boolean().default(true)
})

const writingRuleChangesSchema = writingRuleFieldsSchema
  .partial()
  .strict()
  .refine(
    (changes) => Object.keys(changes).length > 0,
    'At least one writing rule field must change'
  )

export const modelWritingRuleOperationSchema = z.discriminatedUnion('type', [
  strictObject({
    type: z.literal('add'),
    clientRef: z.string().min(1).max(256),
    rule: writingRuleFieldsSchema
  }),
  strictObject({
    type: z.literal('update'),
    ruleId: z.uuid(),
    changes: writingRuleChangesSchema
  }),
  strictObject({ type: z.literal('setActive'), ruleId: z.uuid(), active: z.boolean() }),
  strictObject({ type: z.literal('remove'), ruleId: z.uuid() })
])

export const writingRuleOperationSchema = z.discriminatedUnion('type', [
  strictObject({ type: z.literal('add'), rule: writingRuleSchema }),
  strictObject({
    type: z.literal('update'),
    ruleId: z.uuid(),
    changes: writingRuleChangesSchema
  }),
  strictObject({ type: z.literal('setActive'), ruleId: z.uuid(), active: z.boolean() }),
  strictObject({ type: z.literal('remove'), ruleId: z.uuid() })
])

export const modelSubmitWritingRulesChangeArgsSchema = strictObject({
  operations: z.array(modelWritingRuleOperationSchema).min(1).max(50)
})

export const writingRulesChangeSchema = strictObject({
  schemaVersion: z.literal(1),
  baseBriefVersion: z.number().int().positive(),
  operations: z.array(writingRuleOperationSchema).min(1).max(50)
})

export const writingRulesChangeInputSchema = strictObject({
  baseBriefVersion: z.number().int().positive(),
  operations: z.array(modelWritingRuleOperationSchema).min(1).max(50)
})

export function readWritingRules(extensible: Record<string, unknown>): WritingRulesState {
  const value = extensible[WRITING_RULES_NAMESPACE]
  return value === undefined
    ? { schemaVersion: 1, rules: [] }
    : writingRulesStateSchema.parse(value)
}

export function writeWritingRules(
  extensible: Record<string, unknown>,
  state: WritingRulesState
): Record<string, unknown> {
  return { ...extensible, [WRITING_RULES_NAMESPACE]: writingRulesStateSchema.parse(state) }
}

export function applyWritingRuleOperations(
  current: WritingRulesState,
  operations: readonly WritingRuleOperation[]
): WritingRulesState {
  const rules = current.rules.map((rule) => ({
    ...rule,
    discouragedForms: [...rule.discouragedForms]
  }))
  for (const operation of operations) {
    if (operation.type === 'add') {
      if (rules.some((rule) => rule.ruleId === operation.rule.ruleId)) {
        throw new Error('Writing rule ID already exists')
      }
      rules.push(operation.rule)
      continue
    }
    const index = rules.findIndex((rule) => rule.ruleId === operation.ruleId)
    if (index < 0) throw new Error('Writing rule does not exist')
    if (operation.type === 'remove') {
      rules.splice(index, 1)
      continue
    }
    const existing = rules[index]
    if (existing === undefined) throw new Error('Writing rule does not exist')
    rules[index] =
      operation.type === 'setActive'
        ? { ...existing, active: operation.active }
        : writingRuleSchema.parse({ ...existing, ...operation.changes })
  }
  return writingRulesStateSchema.parse({ schemaVersion: 1, rules })
}

export function normalizeRuleText(value: string): string {
  return value.normalize('NFC').toLowerCase()
}

export type WritingRuleCategory = z.infer<typeof writingRuleCategorySchema>
export type WritingRule = z.infer<typeof writingRuleSchema>
export type WritingRulesState = z.infer<typeof writingRulesStateSchema>
export type ModelWritingRuleOperation = z.infer<typeof modelWritingRuleOperationSchema>
export type WritingRuleOperation = z.infer<typeof writingRuleOperationSchema>
export type WritingRulesChange = z.infer<typeof writingRulesChangeSchema>
