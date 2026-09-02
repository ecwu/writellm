import { describe, expect, it } from 'vitest'
import { buildAgentPolicy } from '../agent/prompts/agent-policy'
import { formatPromptBlock } from '../agent/prompts/prompt-block'
import { SKILL_COMPANION_NOTE } from '../agent/prompts/skill-companion'
import { MAX_SYSTEM_PROMPT_BYTES } from '../agent/context'
import { formatWriteLlmSkill } from './prompt'

describe('writing skill prompt budget baseline', () => {
  it('describes explicit injection and non-blocking automatic Skill reads', () => {
    expect(SKILL_COMPANION_NOTE).toContain(
      'Leading $skill-name requests are resolved by WriteLLM before the first model call'
    )
    expect(SKILL_COMPANION_NOTE).toContain('Do not reread those injected entrypoints')
    expect(SKILL_COMPANION_NOTE).toContain('optional automatic discovery')
    expect(SKILL_COMPANION_NOTE).toContain(
      'Automatic Skill reads return ordinary tool results and do not add their content to the mandatory system prompt.'
    )
    expect(SKILL_COMPANION_NOTE).toContain(
      'An unread or failed dependency does not block a final answer.'
    )
    expect(SKILL_COMPANION_NOTE).toContain(
      'Read only task-relevant advertised references from loaded Skills; do not attempt to read every reference.'
    )
    expect(SKILL_COMPANION_NOTE).toContain(
      'Multiple independent Skill reads are allowed in one assistant response and may be combined with other read-only tools.'
    )
    expect(SKILL_COMPANION_NOTE).toContain('Never mix a Skill read with a mutation or effect tool')
    expect(SKILL_COMPANION_NOTE).not.toContain('at most one new')
    expect(SKILL_COMPANION_NOTE).not.toContain('up to twelve')
    expect(SKILL_COMPANION_NOTE).not.toContain('32 KiB total')
    expect(SKILL_COMPANION_NOTE).not.toContain('Once any non-Skill tool is called')
    expect(SKILL_COMPANION_NOTE).not.toContain('requested_writing_skills')
    expect(SKILL_COMPANION_NOTE).not.toContain('before downstream work or a final answer')
  })

  it('keeps the fixed prompt layers inside the generic system-prompt bound', () => {
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
    expect(MAX_SYSTEM_PROMPT_BYTES).toBe(65_536)
    expect(Buffer.byteLength(buildAgentPolicy())).toBeLessThan(MAX_SYSTEM_PROMPT_BYTES)
    expect(Buffer.byteLength(SKILL_COMPANION_NOTE)).toBeLessThan(MAX_SYSTEM_PROMPT_BYTES)
    expect(Buffer.byteLength(wrapper)).toBeLessThan(MAX_SYSTEM_PROMPT_BYTES)
    expect(Buffer.byteLength(entrypoint)).toBeLessThan(MAX_SYSTEM_PROMPT_BYTES)
  })
})
