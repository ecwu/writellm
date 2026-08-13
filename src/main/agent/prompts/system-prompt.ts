import type { WritingContextResult } from '../../../shared/contracts/agent-tools'
import { formatPromptBlock } from './prompt-block'
import { SKILL_COMPANION_NOTE } from './skill-companion'
import type { WritingRule } from '../../../shared/contracts/writing-rules'

export function formatAgentSystemPrompt(input: {
  policy: string
  context: WritingContextResult
  writingRules: readonly WritingRule[]
  mandatorySkill: string
  references: readonly { path: string; content: string }[]
}): string {
  const requirements = input.context.brief
  const manuscript = { ...input.context, brief: null }
  const skillActive = input.mandatorySkill.length > 0 || input.references.length > 0
  const mandatorySkill =
    input.mandatorySkill.length === 0
      ? ''
      : formatPromptBlock({
          tag: 'WRITING_SKILL_ENTRYPOINT',
          content: input.mandatorySkill,
          instructionSemantics: 'true'
        })
  const skillSection = [
    skillActive ? SKILL_COMPANION_NOTE : '',
    mandatorySkill,
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
  const writingRules = formatPromptBlock({
    tag: 'TRUSTED_WRITING_RULES',
    content: JSON.stringify(input.writingRules),
    instructionSemantics: 'true'
  })
  const data = formatPromptBlock({
    tag: 'MANUSCRIPT_DATA',
    content: JSON.stringify(manuscript),
    instructionSemantics: 'false'
  })
  return [input.policy, skillSection, trusted, writingRules, data]
    .filter((value) => value.length > 0)
    .join('\n\n')
}
