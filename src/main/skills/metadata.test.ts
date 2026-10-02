import { describe, expect, it } from 'vitest'
import { parseSkillDocument } from './skill-service'
import { formatWriteLlmSkill, formatSkillsForSystemPrompt } from './prompt'

describe('application-owned Writing Skill parsing', () => {
  it('normalizes CRLF and folded YAML with the existing metadata parser', () => {
    expect(
      parseSkillDocument(
        '---\r\nname: academic-style\r\ndescription: >\r\n  Clear claims.\r\n  Direct prose.\r\n---\r\nBody.\r\n',
        'academic-style'
      )
    ).toEqual({
      name: 'academic-style',
      description: 'Clear claims. Direct prose.',
      body: 'Body.',
      disableModelInvocation: false
    })
  })

  it('preserves invocation wrappers and escapes catalog metadata', () => {
    const skill = {
      name: 'academic-style',
      description: 'A < B & C',
      content: 'Body.',
      filePath: 'writellm://skills/academic-style/commit/SKILL.md'
    }
    expect(formatWriteLlmSkill(skill)).toBe(
      '<skill name="academic-style" location="writellm://skills/academic-style/commit/SKILL.md">\nReferences are relative to writellm://skills/academic-style/commit.\n\nBody.\n</skill>'
    )
    expect(formatSkillsForSystemPrompt([skill])).toContain(
      '<description>A &lt; B &amp; C</description>'
    )
    expect(formatSkillsForSystemPrompt([{ ...skill, disableModelInvocation: true }])).toBe('')
  })

  it.each([
    'name: different-name\ndescription: Invalid directory match.',
    'name: academic-style\ndescription: []',
    'name: academic-style\ndescription: text\ndisable-model-invocation: yes',
    'name: AcademicStyle\ndescription: Invalid name.'
  ])('rejects invalid metadata: %s', (metadata) => {
    expect(() => parseSkillDocument(`---\n${metadata}\n---\nBody.`, 'academic-style')).toThrow()
  })
})
