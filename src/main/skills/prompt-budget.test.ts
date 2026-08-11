import { describe, expect, it } from 'vitest'
import { buildAgentPolicy } from '../agent/writing-policy'
import { MAX_SYSTEM_PROMPT_BYTES } from '../agent/context'
import { formatWriteLlmSkill, SKILL_COMPANION_NOTE } from './prompt'

describe('writing skill prompt budget baseline', () => {
  it('requires an explicit review when fixed prompt layers drift', () => {
    const wrapper = formatWriteLlmSkill({
      name: 'x',
      description: 'x',
      content: '',
      filePath: `writellm://skills/x/${'0'.repeat(40)}/SKILL.md`
    })
    expect({
      max: MAX_SYSTEM_PROMPT_BYTES,
      policy: Buffer.byteLength(buildAgentPolicy()),
      companion: Buffer.byteLength(SKILL_COMPANION_NOTE),
      emptyInvocation: Buffer.byteLength(wrapper),
      fixedEnvelope: Buffer.byteLength(
        '<TRUSTED_WRITING_REQUIREMENTS instructionSemantics="true">\nnull\n</TRUSTED_WRITING_REQUIREMENTS>\n\n<MANUSCRIPT_DATA instructionSemantics="false">\n{}\n</MANUSCRIPT_DATA>'
      )
    }).toEqual({
      max: 65_536,
      policy: 5_218,
      companion: 641,
      emptyInvocation: 197,
      fixedEnvelope: 165
    })
  })
})
