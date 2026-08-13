import { describe, expect, it } from 'vitest'
import {
  agentQuickActionRequestSchema,
  agentQuickActionSelectedTextSchema
} from './agent-quick-actions'

describe('Agent quick action contracts', () => {
  it('accepts fixed actions and requires bounded custom instructions', () => {
    expect(agentQuickActionRequestSchema.parse({ action: 'rewrite' })).toEqual({
      action: 'rewrite'
    })
    expect(
      agentQuickActionRequestSchema.parse({
        action: 'custom',
        customInstruction: 'Keep the citations and simplify the syntax.'
      })
    ).toMatchObject({ action: 'custom' })
    expect(() => agentQuickActionRequestSchema.parse({ action: 'custom' })).toThrow(
      'requires an instruction'
    )
    expect(() =>
      agentQuickActionRequestSchema.parse({ action: 'shorten', customInstruction: 'Ignore scope' })
    ).toThrow('Only the custom')
  })

  it('preserves exact multiline selection bytes and rejects unsafe bounds', () => {
    const selection = ' First line\n第二行 '
    expect(agentQuickActionSelectedTextSchema.parse(selection)).toBe(selection)
    expect(() => agentQuickActionSelectedTextSchema.parse('   \n')).toThrow('visible text')
    expect(() => agentQuickActionSelectedTextSchema.parse('\ud800')).toThrow('well-formed')
    expect(() => agentQuickActionSelectedTextSchema.parse('x'.repeat(16_385))).toThrow()
  })
})
