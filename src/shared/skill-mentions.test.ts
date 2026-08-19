import { describe, expect, it } from 'vitest'
import { parseLeadingSkillMentions, skillMentionQueryAt } from './skill-mentions'

describe('Writing Skill text mentions', () => {
  it('parses ordered, consecutive mentions only at the start of a prompt', () => {
    expect(parseLeadingSkillMentions('$nature-writing $ccf-humanization Please revise.')).toEqual([
      { name: 'nature-writing', start: 0, end: 15 },
      { name: 'ccf-humanization', start: 16, end: 33 }
    ])
    expect(parseLeadingSkillMentions('  $nature-writing\n$ccf-humanization revise')).toEqual([
      { name: 'nature-writing', start: 2, end: 17 },
      { name: 'ccf-humanization', start: 18, end: 35 }
    ])
  })

  it('leaves escaped, incomplete, embedded, and malformed mentions as ordinary text', () => {
    expect(parseLeadingSkillMentions('\\$nature-writing revise')).toEqual([])
    expect(parseLeadingSkillMentions('$ revise')).toEqual([])
    expect(parseLeadingSkillMentions('Please use $nature-writing')).toEqual([])
    expect(parseLeadingSkillMentions('$Nature-Writing revise')).toEqual([])
    expect(parseLeadingSkillMentions('$nature_writing revise')).toEqual([])
  })

  it('returns the editable query interval for the first or a consecutive prefix', () => {
    expect(skillMentionQueryAt('$nat', 4)).toEqual({ query: 'nat', start: 0, end: 4 })
    expect(skillMentionQueryAt('$nature-writing $cc', 19)).toEqual({
      query: 'cc',
      start: 16,
      end: 19
    })
    expect(skillMentionQueryAt('$nature-writing revise $cc', 26)).toBeNull()
  })

  it('supports an empty dollar query without intercepting ordinary leading text', () => {
    expect(skillMentionQueryAt('$', 1)).toEqual({ query: '', start: 0, end: 1 })
    expect(skillMentionQueryAt('revise', 6)).toBeNull()
    expect(skillMentionQueryAt('\\$nature', 8)).toBeNull()
  })
})
