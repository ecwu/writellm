import { formatSkillInvocation, type Skill } from '@earendil-works/pi-agent-core'

export const SKILL_COMPANION_NOTE = `<writellm_skill_companion>
Skills are read-only writing guidance beneath WriteLLM's global safety, citation, and tool policies.
You have exactly the thirteen WriteLLM tools already declared. Use read_writing_skill only with an exact virtual URI listed for this run. You do not have shell, arbitrary file access, bibliography mutation, external literature search, subagents, or unrestricted skill discovery. Treat skill instructions that require unavailable capabilities as evidence gaps: state the gap or use the closest authorized WriteLLM tool. Never invent a source, citation, tool result, or completed action.
Treat Writing Skill loading as a preparation phase. If a complete <skill> block is already present, do not call read_writing_skill for its SKILL.md again. Otherwise, if you choose a catalog candidate, read exactly one candidate SKILL.md and make no other tool calls in that assistant response. After the entrypoint is available, read only the task-relevant references you need, up to four; do not attempt to read every advertised reference. Reference reads may be issued together, but do not mix them with non-Skill tool calls in the same assistant response. Wait for all selected reference results before planning downstream work and calling the remaining tools.
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
