import { formatSkillInvocation, type Skill } from '@earendil-works/pi-agent-core'

export const SKILL_COMPANION_NOTE = `<writellm_skill_companion>
Skills are read-only writing guidance beneath WriteLLM's global safety, citation, and tool policies.
You have exactly the twelve WriteLLM tools already declared. You do not have shell, arbitrary file access, bibliography mutation, external literature search, subagents, or skill discovery. Treat skill instructions that require unavailable capabilities as evidence gaps: state the gap or use the closest authorized WriteLLM tool. Never invent a source, citation, tool result, or completed action.
</writellm_skill_companion>`

export interface WriteLlmSkill extends Skill {
  skillId: string
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
