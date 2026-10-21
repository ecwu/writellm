import { describe, expect, it } from 'vitest'
import { validateAgentToolCallBatch } from './agent-tool-preflight'

const isMutationTool = (name: string) => name.startsWith('submit_')

describe('validateAgentToolCallBatch', () => {
  it('rejects unknown tools before applying batch rules', () => {
    expect(
      validateAgentToolCallBatch({
        toolName: 'unknown',
        calls: [{ id: '1', name: 'unknown' }],
        isMutationTool
      })
    ).toEqual({
      code: 'unknown_tool',
      message:
        'The requested tool is not authorized by WriteLLM. Choose one of the advertised tools.'
    })
  })

  it('requires clarification and activation to be the only tool', () => {
    expect(
      validateAgentToolCallBatch({
        toolName: 'ask_user',
        calls: [
          { id: '1', name: 'ask_user' },
          { id: '2', name: 'read_section' }
        ],
        isMutationTool
      })?.code
    ).toBe('invalid_arguments')
    expect(
      validateAgentToolCallBatch({
        toolName: 'activate_tool_groups',
        calls: [
          { id: '1', name: 'activate_tool_groups' },
          { id: '2', name: 'read_section' }
        ],
        isMutationTool
      })?.code
    ).toBe('invalid_arguments')
  })

  it('rejects multiple or mixed mutation calls', () => {
    expect(
      validateAgentToolCallBatch({
        toolName: 'submit_section_change',
        calls: [
          { id: '1', name: 'submit_section_change' },
          { id: '2', name: 'submit_outline_change' }
        ],
        isMutationTool
      })?.message
    ).toBe('Only one mutation may be submitted in an assistant message.')
    expect(
      validateAgentToolCallBatch({
        toolName: 'submit_section_change',
        calls: [
          { id: '1', name: 'submit_section_change' },
          { id: '2', name: 'read_section' }
        ],
        isMutationTool
      })?.message
    ).toContain('cannot be mixed')
  })

  it('allows a single advertised read tool', () => {
    expect(
      validateAgentToolCallBatch({
        toolName: 'read_section',
        calls: [{ id: '1', name: 'read_section' }],
        isMutationTool
      })
    ).toBeUndefined()
  })
})
