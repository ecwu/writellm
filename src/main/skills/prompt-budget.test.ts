import { describe, expect, it } from 'vitest'
import { buildAgentPolicy } from '../agent/prompts/agent-policy'
import { formatPromptBlock } from '../agent/prompts/prompt-block'
import { SKILL_COMPANION_NOTE } from '../agent/prompts/skill-companion'
import { MAX_SYSTEM_PROMPT_BYTES } from '../agent/context'
import { formatWriteLlmSkill } from './prompt'

describe('writing skill prompt budget baseline', () => {
  it('stages bounded Skill preparation before downstream tools', () => {
    expect(SKILL_COMPANION_NOTE).toContain(
      'The catalogs contain metadata only; even when the user names a Skill, call read_writing_skill'
    )
    expect(SKILL_COMPANION_NOTE).toContain(
      'A requested_writing_skills block is mandatory: load every listed entrypoint in order'
    )
    expect(SKILL_COMPANION_NOTE).toContain(
      'Load at most one new top-level or dependency entrypoint and make no other tool calls in that assistant response.'
    )
    expect(SKILL_COMPANION_NOTE).toContain(
      'load every listed dependency through read_writing_skill before references or downstream work.'
    )
    expect(SKILL_COMPANION_NOTE).toContain(
      'Read only task-relevant advertised references from loaded Skills, up to twelve complete files and 32 KiB total'
    )
    expect(SKILL_COMPANION_NOTE).toContain(
      'never mix them with non-Skill tool calls in the same assistant response.'
    )
    expect(SKILL_COMPANION_NOTE).toContain(
      'Wait for all Skill results before planning downstream work'
    )
    expect(SKILL_COMPANION_NOTE).toContain(
      'Once any non-Skill tool is called, do not load another Skill in that run.'
    )
  })

  it('requires an explicit review when fixed prompt layers drift', () => {
    const wrapper = formatWriteLlmSkill({
      name: 'x',
      description: 'x',
      content: '',
      filePath: `writellm://skills/x/${'0'.repeat(40)}/SKILL.md`
    })
    const entrypoint = formatPromptBlock({
      tag: 'WRITING_SKILL_ENTRYPOINT',
      content: wrapper,
      instructionSemantics: 'true'
    })
    expect({
      max: MAX_SYSTEM_PROMPT_BYTES,
      policy: Buffer.byteLength(buildAgentPolicy()),
      companion: Buffer.byteLength(SKILL_COMPANION_NOTE),
      emptyInvocation: Buffer.byteLength(wrapper),
      wrappedEntrypoint: Buffer.byteLength(entrypoint),
      fixedEnvelope: Buffer.byteLength(
        '<TRUSTED_WRITING_REQUIREMENTS instructionSemantics="true">\nnull\n</TRUSTED_WRITING_REQUIREMENTS>\n\n<MANUSCRIPT_DATA instructionSemantics="false">\n{}\n</MANUSCRIPT_DATA>'
      )
    }).toEqual({
      max: 65_536,
      policy: 13_264,
      companion: 1_899,
      emptyInvocation: 197,
      wrappedEntrypoint: 292,
      fixedEnvelope: 165
    })
  })
})
