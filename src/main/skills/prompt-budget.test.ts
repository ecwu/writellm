import { describe, expect, it } from 'vitest'
import { buildAgentPolicy } from '../agent/writing-policy'
import { MAX_SYSTEM_PROMPT_BYTES } from '../agent/context'
import { formatWriteLlmSkill, SKILL_COMPANION_NOTE } from './prompt'

describe('writing skill prompt budget baseline', () => {
  it('stages bounded Skill preparation before downstream tools', () => {
    expect(SKILL_COMPANION_NOTE).toContain(
      'If a complete <skill> block is already present, do not call read_writing_skill for its SKILL.md again.'
    )
    expect(SKILL_COMPANION_NOTE).toContain(
      'read exactly one candidate SKILL.md and make no other tool calls in that assistant response.'
    )
    expect(SKILL_COMPANION_NOTE).toContain(
      'read only the task-relevant references you need, up to four'
    )
    expect(SKILL_COMPANION_NOTE).toContain(
      'do not mix them with non-Skill tool calls in the same assistant response.'
    )
    expect(SKILL_COMPANION_NOTE).toContain(
      'Wait for all selected reference results before planning downstream work'
    )
  })

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
      companion: 1_305,
      emptyInvocation: 197,
      fixedEnvelope: 165
    })
  })
})
