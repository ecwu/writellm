import { describe, expect, it } from 'vitest'
import {
  applyWritingRuleOperations,
  MAX_ACTIVE_WRITING_RULE_BYTES,
  writingRulesStateSchema
} from './writing-rules'

describe('Writing Rules contract', () => {
  it('applies typed operations and fails closed on conflicting terminology', () => {
    const first = '019d0000-0000-7000-8000-000000000001'
    const second = '019d0000-0000-7000-8000-000000000002'
    const current = writingRulesStateSchema.parse({ schemaVersion: 1, rules: [] })
    const withRule = applyWritingRuleOperations(current, [
      {
        type: 'add',
        rule: {
          ruleId: first,
          category: 'translation',
          instruction: 'Translate LLM consistently.',
          preferredForm: '大型语言模型',
          discouragedForms: ['大语言模型'],
          rationale: null,
          active: true
        }
      }
    ])
    expect(withRule.rules[0]?.preferredForm).toBe('大型语言模型')
    expect(() =>
      applyWritingRuleOperations(withRule, [
        {
          type: 'add',
          rule: {
            ruleId: second,
            category: 'terminology',
            instruction: 'Use another translation.',
            preferredForm: '语言大模型',
            discouragedForms: ['大语言模型'],
            rationale: null,
            active: true
          }
        }
      ])
    ).toThrow()
  })

  it('rejects active rule payloads above the complete-injection budget', () => {
    expect(() =>
      writingRulesStateSchema.parse({
        schemaVersion: 1,
        rules: Array.from({ length: 10 }, (_, index) => ({
          ruleId: `019d0000-0000-7000-8000-${String(index).padStart(12, '0')}`,
          category: 'style',
          instruction: 'x'.repeat(Math.ceil(MAX_ACTIVE_WRITING_RULE_BYTES / 10)),
          preferredForm: null,
          discouragedForms: [],
          rationale: null,
          active: true
        }))
      })
    ).toThrow()
  })
})
