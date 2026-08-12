import { randomUUID } from 'node:crypto'
import type { AgentEditorContext } from '../../shared/contracts/agent'
import {
  getWritingContextArgsSchema,
  writingContextResultSchema,
  type GetWritingContextArgs,
  type WritingContextResult
} from '../../shared/contracts/agent-tools'
import type { ManuscriptService } from '../manuscript/manuscript-service'
import { buildAgentPolicy } from './prompts/agent-policy'
import { formatAgentSystemPrompt } from './prompts/system-prompt'

const MAX_CONTEXT_OUTLINE_SECTIONS = 200
const MAX_SYSTEM_OUTLINE_SECTIONS = 80
export const MAX_SYSTEM_PROMPT_BYTES = 65_536

export interface AgentSkillPromptInput {
  mode: 'auto' | 'explicit' | 'none'
  mandatory: string
  references: readonly { path: string; content: string }[]
}

export class SkillPromptBudgetError extends Error {
  readonly code = 'skill_prompt_budget_exceeded'

  constructor() {
    super('The selected writing skill cannot fit the system prompt budget')
    this.name = 'SkillPromptBudgetError'
  }
}

export interface WritingSnapshot {
  snapshotId: string
  observedAt: string
  workspace: ReturnType<ManuscriptService['getWorkspace']>
  sectionContents: ReadonlyMap<string, ReturnType<ManuscriptService['getRevision']>['content']>
  editorContext: AgentEditorContext
}

export class AgentContextBuilder {
  constructor(private readonly manuscript: ManuscriptService) {}

  capture(snapshotId: string, editorContext: AgentEditorContext): WritingSnapshot {
    const assembly = this.manuscript.assemble()
    const workspace: ReturnType<ManuscriptService['getWorkspace']> = {
      ...assembly,
      sections: assembly.sections.map(({ section, revision }) => {
        const { content: _content, ...summary } = revision
        return { section, revision: summary }
      })
    }
    return {
      snapshotId,
      observedAt: new Date().toISOString(),
      workspace,
      sectionContents: new Map(
        assembly.sections.map((entry) => [entry.revision.sectionRevisionId, entry.revision.content])
      ),
      editorContext
    }
  }

  getWritingContext(
    rawArgs: GetWritingContextArgs,
    snapshot: WritingSnapshot
  ): WritingContextResult {
    const args = getWritingContextArgsSchema.parse(rawArgs)
    const { workspace, editorContext } = snapshot
    const activeSectionId = args.activeSectionId ?? editorContext.activeSectionId
    const outline = workspace.sections.slice(0, MAX_CONTEXT_OUTLINE_SECTIONS).map(toSectionSummary)
    const activeEntry =
      activeSectionId === null || activeSectionId === undefined
        ? undefined
        : workspace.sections.find((entry) => entry.section.sectionId === activeSectionId)
    const currentRevisionId = activeEntry?.section.currentRevisionId ?? null
    const selectionStale =
      editorContext.capturedRevisionId !== null &&
      editorContext.capturedRevisionId !== undefined &&
      editorContext.capturedRevisionId !== currentRevisionId
    const warnings =
      activeSectionId !== null && activeSectionId !== undefined && activeEntry === undefined
        ? [
            {
              code: 'active_section_not_found',
              message: 'The captured active section no longer exists.'
            }
          ]
        : []

    return writingContextResultSchema.parse({
      snapshotId: snapshot.snapshotId,
      observedAt: snapshot.observedAt,
      manuscriptId: workspace.manuscriptId,
      outlineVersion: workspace.outlineVersion,
      brief: args.includeBrief ? toBriefSummary(workspace.brief) : null,
      outline: args.includeOutline ? outline : [],
      outlineTruncated:
        args.includeOutline && workspace.sections.length > MAX_CONTEXT_OUTLINE_SECTIONS,
      activeSection: activeEntry === undefined ? null : toSectionSummary(activeEntry),
      editorSelection: {
        capturedAt: editorContext.capturedAt ?? 0,
        capturedRevisionId: editorContext.capturedRevisionId ?? null,
        currentRevisionId,
        stale: selectionStale,
        selectedBlockIds: selectionStale ? [] : editorContext.selectedBlockIds,
        activeBlockId: selectionStale ? null : editorContext.activeBlockId
      },
      warnings,
      totalWordCount: workspace.wordCount,
      totalCharacterCount: workspace.characterCount
    })
  }

  build(input: {
    prompt: string
    editorContext: AgentEditorContext
    snapshotId?: string
    skillPrompt?: AgentSkillPromptInput
  }): {
    systemPrompt: string
    userRequest: string
    writingContext: WritingContextResult
    snapshot: WritingSnapshot
    includedSkillResources: string[]
    skillPromptDropped: boolean
  } {
    const userRequest = input.prompt.slice(0, 262_144)
    const snapshot = this.capture(input.snapshotId ?? randomUUID(), input.editorContext)
    const writingContext = this.getWritingContext(
      {
        includeBrief: true,
        includeOutline: true,
        ...(input.editorContext.activeSectionId === null
          ? {}
          : { activeSectionId: input.editorContext.activeSectionId })
      },
      snapshot
    )
    const systemContext: WritingContextResult = {
      ...writingContext,
      outline: writingContext.outline.slice(0, MAX_SYSTEM_OUTLINE_SECTIONS),
      outlineTruncated:
        writingContext.outlineTruncated ||
        writingContext.outline.length > MAX_SYSTEM_OUTLINE_SECTIONS
    }
    const policy = buildAgentPolicy()
    const selectedReferences = [...(input.skillPrompt?.references ?? [])]
    let mandatorySkill = input.skillPrompt?.mandatory ?? ''
    let systemPrompt = formatAgentSystemPrompt({
      policy,
      context: systemContext,
      mandatorySkill,
      references: selectedReferences
    })
    while (byteLength(systemPrompt) > MAX_SYSTEM_PROMPT_BYTES && selectedReferences.length > 0) {
      selectedReferences.pop()
      systemPrompt = formatAgentSystemPrompt({
        policy,
        context: systemContext,
        mandatorySkill,
        references: selectedReferences
      })
    }
    while (byteLength(systemPrompt) > MAX_SYSTEM_PROMPT_BYTES && systemContext.outline.length > 0) {
      systemContext.outline.pop()
      systemContext.outlineTruncated = true
      systemPrompt = formatAgentSystemPrompt({
        policy,
        context: systemContext,
        mandatorySkill,
        references: selectedReferences
      })
    }
    let skillPromptDropped = false
    if (
      byteLength(systemPrompt) > MAX_SYSTEM_PROMPT_BYTES &&
      mandatorySkill.length > 0 &&
      input.skillPrompt?.mode === 'auto'
    ) {
      mandatorySkill = ''
      selectedReferences.length = 0
      skillPromptDropped = true
      systemPrompt = formatAgentSystemPrompt({
        policy,
        context: systemContext,
        mandatorySkill,
        references: selectedReferences
      })
    }
    if (byteLength(systemPrompt) > MAX_SYSTEM_PROMPT_BYTES) {
      if (mandatorySkill.length > 0) throw new SkillPromptBudgetError()
      throw new Error('Bounded Agent context cannot fit the system prompt contract')
    }
    return {
      systemPrompt,
      userRequest,
      writingContext,
      snapshot,
      includedSkillResources: selectedReferences.map((reference) => reference.path),
      skillPromptDropped
    }
  }
}

function toBriefSummary(brief: ReturnType<ManuscriptService['getBrief']>) {
  return {
    version: brief.version,
    title: brief.title.slice(0, 500),
    description: brief.description.slice(0, 4_096),
    topic: brief.topic.slice(0, 4_096),
    targetAudience: brief.targetAudience.slice(0, 4_096),
    language: brief.language.slice(0, 256),
    styleTone: brief.styleTone.slice(0, 4_096),
    scopeExclusions: brief.scopeExclusions.slice(0, 4_096),
    targetLength: brief.targetLength.slice(0, 2_048),
    citationRequirements: brief.citationRequirements.slice(0, 4_096),
    additionalInstructions: brief.additionalInstructions.slice(0, 4_096)
  }
}

function toSectionSummary(
  entry: ReturnType<ManuscriptService['getWorkspace']>['sections'][number]
) {
  return {
    sectionId: entry.section.sectionId,
    parentSectionId: entry.section.parentSectionId,
    position: entry.section.position,
    level: entry.section.level,
    title: entry.section.title,
    objective: entry.section.objective?.slice(0, 8_192) ?? null,
    status: entry.section.status,
    currentRevisionId: entry.section.currentRevisionId,
    wordCount: entry.revision.wordCount,
    characterCount: entry.revision.characterCount
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
