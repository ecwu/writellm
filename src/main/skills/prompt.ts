export interface Skill {
  name: string
  description: string
  content: string
  filePath: string
  disableModelInvocation?: boolean
}

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
  const directory = skill.filePath.slice(0, skill.filePath.lastIndexOf('/'))
  return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${directory}.\n\n${skill.content}\n</skill>`
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

export function formatSkillsForSystemPrompt(skills: readonly Skill[]): string {
  const visible = skills.filter((skill) => !skill.disableModelInvocation)
  if (visible.length === 0) return ''
  const escapeXml = (text: string): string =>
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  return [
    'The following skills provide specialized instructions for specific tasks.',
    'Read the full skill file when the task matches its description.',
    'When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.',
    '',
    '<available_skills>',
    ...visible.flatMap((skill) => [
      '  <skill>',
      `    <name>${escapeXml(skill.name)}</name>`,
      `    <description>${escapeXml(skill.description)}</description>`,
      `    <location>${escapeXml(skill.filePath)}</location>`,
      '  </skill>'
    ]),
    '</available_skills>'
  ].join('\n')
}
