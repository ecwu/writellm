import { formatSkillInvocation, type Skill } from '@earendil-works/pi-agent-core'

export interface WriteLlmSkill extends Skill {
  skillId: string
  displayName: string
  commit: string
  license: string | null
  source: 'curated' | 'github'
  dependencies: readonly string[]
  files: readonly WriteLlmSkillFile[]
}

export interface WriteLlmSkillFile {
  path: string
  byteSize: number
  gitBlobSha: string
  sha256: string
}

export function formatWriteLlmSkill(skill: Skill): string {
  return formatSkillInvocation(skill)
}

export function virtualSkillPath(
  skillId: string,
  commit: string,
  relativePath = 'SKILL.md'
): string {
  return `writellm://skills/${encodeURIComponent(skillId)}/${commit}/${relativePath
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`
}
