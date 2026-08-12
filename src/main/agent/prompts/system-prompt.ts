import type { WritingContextResult } from '../../../shared/contracts/agent-tools'
import { formatPromptBlock } from './prompt-block'
import { SKILL_COMPANION_NOTE } from './skill-companion'

export function formatAgentSystemPrompt(input: {
  policy: string
  context: WritingContextResult
  mandatorySkill: string
  references: readonly { path: string; content: string }[]
}): string {
  const requirements = input.context.brief
  const manuscript = { ...input.context, brief: null }
  const skillActive = input.mandatorySkill.length > 0 || input.references.length > 0
  const skillSection = [
    skillActive ? SKILL_COMPANION_NOTE : '',
    input.mandatorySkill,
    ...input.references.map((reference) =>
      formatPromptBlock({
        tag: 'WRITING_SKILL_REFERENCE',
        content: reference.content,
        instructionSemantics: 'true',
        attributes: { location: reference.path }
      })
    )
  ]
    .filter((value) => value.length > 0)
    .join('\n\n')
  const trusted = formatPromptBlock({
    tag: 'TRUSTED_WRITING_REQUIREMENTS',
    content: JSON.stringify(requirements),
    instructionSemantics: 'true'
  })
  const data = formatPromptBlock({
    tag: 'MANUSCRIPT_DATA',
    content: JSON.stringify(manuscript),
    instructionSemantics: 'false'
  })
  return [input.policy, skillSection, trusted, data]
    .filter((value) => value.length > 0)
    .join('\n\n')
}
