const SKILL_NAME_CHARACTER = /^[a-z0-9-]$/u

export interface LeadingSkillMention {
  name: string
  start: number
  end: number
}

export interface SkillMentionQuery {
  query: string
  start: number
  end: number
}

export function parseLeadingSkillMentions(prompt: string): LeadingSkillMention[] {
  const mentions: LeadingSkillMention[] = []
  let offset = skipWhitespace(prompt, 0)
  while (offset < prompt.length && prompt[offset] === '$') {
    const start = offset
    offset += 1
    const nameStart = offset
    while (offset < prompt.length && isSkillNameCharacter(prompt[offset] ?? '')) offset += 1
    if (offset === nameStart) break
    if (offset < prompt.length && !isWhitespace(prompt[offset] ?? '')) break
    mentions.push({ name: prompt.slice(nameStart, offset), start, end: offset })
    offset = skipWhitespace(prompt, offset)
  }
  return mentions
}

export function skillMentionQueryAt(prompt: string, caret: number): SkillMentionQuery | null {
  if (!Number.isInteger(caret) || caret < 0 || caret > prompt.length) return null
  let offset = skipWhitespace(prompt, 0)
  while (offset <= caret && offset < prompt.length && prompt[offset] === '$') {
    const start = offset
    offset += 1
    const nameStart = offset
    while (offset < prompt.length && isSkillNameCharacter(prompt[offset] ?? '')) offset += 1
    const end = offset
    if (caret >= nameStart && caret <= end) {
      return { query: prompt.slice(nameStart, caret), start, end }
    }
    if (end === nameStart || (offset < prompt.length && !isWhitespace(prompt[offset] ?? ''))) {
      return null
    }
    offset = skipWhitespace(prompt, offset)
  }
  return null
}

function skipWhitespace(value: string, offset: number): number {
  let next = offset
  while (next < value.length && isWhitespace(value[next] ?? '')) next += 1
  return next
}

function isWhitespace(value: string): boolean {
  return /\s/u.test(value)
}

function isSkillNameCharacter(value: string): boolean {
  return SKILL_NAME_CHARACTER.test(value)
}
