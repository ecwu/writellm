import type {
  AgentEventRecord,
  AgentRendererEvent,
  AgentSessionRecord,
  AgentStartScope
} from '../../../../shared/contracts/agent-ipc'
import {
  generateImageArgsSchema,
  modelSubmitSectionChangeArgsSchema,
  normalizedGenerateImageArgsSchema,
  type MutationProposalRecord
} from '../../../../shared/contracts/agent-mutations'
import {
  agentCompactionSummaryPayloadSchema,
  type AgentApprovalMode
} from '../../../../shared/contracts/agent'
import { agentToolCallPayloadSchema } from '../../../../shared/contracts/agent-tools'
import type { InstalledSkill } from '../../../../shared/contracts/skills'
import type { WritingTaskView } from '../../../../shared/contracts/writing-task'
import { parseLeadingSkillMentions } from '../../../../shared/skill-mentions'
import type {
  AgentModelSelection,
  AgentProviderCatalog
} from '../../../../shared/contracts/providers'
import { findAgentModelSelection } from './agent-model-selection'

export interface AgentPanelSelection {
  sectionId: string
  activeBlockId: string | null
  selectedBlockIds: string[]
  selectedText?: string | null
  capturedAt?: number
  capturedRevisionId?: string
}

export type ComposerCommand = {
  id: string
  group: 'Context' | 'Conversation'
  label: string
  description: string
  disabled: boolean
  selected: boolean
  action: { kind: 'scope'; value: 'auto' | AgentStartScope } | { kind: 'compact' }
}

export interface SkillMentionCandidate {
  skillId: string
  name: string
  displayName: string
  description: string
  disabled: boolean
}

export function buildComposerCommands(input: {
  selectionAvailable: boolean
  sectionAvailable: boolean
  scopePreference: 'auto' | AgentStartScope
}): ComposerCommand[] {
  return [
    {
      id: 'scope-auto',
      group: 'Context',
      label: 'Auto context',
      description: 'Use selected text, this section, or the manuscript as available',
      disabled: false,
      selected: input.scopePreference === 'auto',
      action: { kind: 'scope', value: 'auto' }
    },
    {
      id: 'scope-selection',
      group: 'Context',
      label: 'Selected text',
      description: 'Use the current editor selection',
      disabled: !input.selectionAvailable,
      selected: input.scopePreference === 'selection',
      action: { kind: 'scope', value: 'selection' }
    },
    {
      id: 'scope-section',
      group: 'Context',
      label: 'This section',
      description: 'Use the active manuscript section',
      disabled: !input.sectionAvailable,
      selected: input.scopePreference === 'section',
      action: { kind: 'scope', value: 'section' }
    },
    {
      id: 'scope-project',
      group: 'Context',
      label: 'Whole manuscript',
      description: 'Let the Agent inspect the full manuscript through bounded tools',
      disabled: false,
      selected: input.scopePreference === 'project',
      action: { kind: 'scope', value: 'project' }
    }
  ]
}

export function buildSlashCommands(input: {
  selectionAvailable: boolean
  sectionAvailable: boolean
  scopePreference: 'auto' | AgentStartScope
  canCompact: boolean
}): ComposerCommand[] {
  return [
    ...buildComposerCommands(input),
    {
      id: 'compact',
      group: 'Conversation',
      label: 'Compact conversation',
      description: 'Summarize earlier conversation now',
      disabled: !input.canCompact,
      selected: false,
      action: { kind: 'compact' }
    }
  ]
}

export function slashCommandQuery(prompt: string): string | null {
  if (!prompt.startsWith('/') || /\s/u.test(prompt)) return null
  return prompt.slice(1)
}

export function filterComposerCommands(
  commands: readonly ComposerCommand[],
  query: string
): ComposerCommand[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (normalized.length === 0) return [...commands]
  return commands
    .map((command, index) => ({
      command,
      index,
      score: composerCommandMatchScore(command, normalized)
    }))
    .filter((match) => match.score !== null)
    .sort((left, right) => (left.score ?? 0) - (right.score ?? 0) || left.index - right.index)
    .map((match) => match.command)
}

function composerCommandMatchScore(command: ComposerCommand, query: string): number | null {
  const label = command.label.toLocaleLowerCase()
  const description = command.description.toLocaleLowerCase()
  if (label === query) return 0
  if (label.startsWith(query)) return 1
  if (label.split(/\s+/u).some((word) => word.startsWith(query))) return 2
  if (label.includes(query)) return 3
  if (description.includes(query)) return 4
  return null
}

export function buildSkillMentionCandidates(input: {
  installed: readonly InstalledSkill[]
  prompt: string
  query: string
  queryStart?: number
}): SkillMentionCandidate[] {
  const mentioned = new Set(
    parseLeadingSkillMentions(input.prompt)
      .filter((mention) => mention.end <= (input.queryStart ?? input.prompt.length))
      .map((mention) => mention.name)
  )
  if (mentioned.size >= 4) return []
  const byName = new Map<string, InstalledSkill[]>()
  for (const skill of input.installed) {
    const group = byName.get(skill.name) ?? []
    group.push(skill)
    byName.set(skill.name, group)
  }
  const normalizedQuery = input.query.toLocaleLowerCase()
  return [...byName.entries()]
    .flatMap(([name, skills]): SkillMentionCandidate[] => {
      if (mentioned.has(name)) return []
      const loadable = skills.filter((skill) => skill.enabled && skill.integrityStatus === 'ready')
      if (loadable.length === 0) return []
      if (loadable.length > 1) {
        return [
          {
            skillId: `ambiguous:${name}`,
            name,
            displayName: name,
            description: `Name is shared by ${loadable.length} available Skills; resolve it in Settings.`,
            disabled: true
          }
        ]
      }
      const skill = loadable[0]
      if (skill === undefined) return []
      return [
        {
          skillId: skill.skillId,
          name: skill.name,
          displayName: skill.displayName,
          description: skill.description,
          disabled: false
        }
      ]
    })
    .map((candidate) => ({
      candidate,
      score: skillMentionMatchScore(candidate, normalizedQuery)
    }))
    .filter((match) => match.score !== null)
    .sort(
      (left, right) =>
        (left.score ?? 0) - (right.score ?? 0) ||
        left.candidate.name.localeCompare(right.candidate.name) ||
        left.candidate.skillId.localeCompare(right.candidate.skillId)
    )
    .map((match) => match.candidate)
}

function skillMentionMatchScore(candidate: SkillMentionCandidate, query: string): number | null {
  if (query.length === 0) return 0
  const name = candidate.name.toLocaleLowerCase()
  const displayName = candidate.displayName.toLocaleLowerCase()
  const description = candidate.description.toLocaleLowerCase()
  if (name === query) return 0
  if (name.startsWith(query)) return 1
  if (displayName.startsWith(query)) return 2
  if (name.includes(query) || displayName.includes(query)) return 3
  if (description.includes(query)) return 4
  return null
}

export function writingTaskDockSummary(task: WritingTaskView): {
  label: string
  ariaLabel: string
  complete: boolean
} {
  const total = task.plan.steps.length
  if (task.progress.remainingCount === 0) {
    return {
      label: 'Plan complete',
      ariaLabel: 'Writing task, plan complete, open details',
      complete: true
    }
  }
  const currentIndex = task.plan.steps.findIndex(
    (step) => step.stepId === task.progress.currentStepId
  )
  if (currentIndex >= 0) {
    return {
      label: `Step ${currentIndex + 1} / ${total}`,
      ariaLabel: `Writing task, Step ${currentIndex + 1} of ${total}, open details`,
      complete: false
    }
  }
  return {
    label: 'Plan needs attention',
    ariaLabel: 'Writing task, plan needs attention, open details',
    complete: false
  }
}

export function writingTaskNeedsAttention(task: WritingTaskView): boolean {
  if (task.progress.hasDisagreement) return true
  if (task.progress.remainingCount === 0) return false
  const current = task.progress.steps.find(
    (progress) => progress.stepId === task.progress.currentStepId
  )
  if (current === undefined) return true
  return (
    current.state === 'awaiting_review' ||
    current.state === 'blocked' ||
    current.state === 'stopped' ||
    current.state === 'failed' ||
    current.state === 'disagreement'
  )
}

export function humanizeSkillId(skillId: string): string {
  const name = skillId.split(':').at(-1) ?? skillId
  return name
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toLocaleUpperCase()}${part.slice(1)}`)
    .join(' ')
}

export function upsertSession(
  sessions: AgentSessionRecord[],
  updated: AgentSessionRecord
): AgentSessionRecord[] {
  return sessions.some((session) => session.agentSessionId === updated.agentSessionId)
    ? sessions.map((session) =>
        session.agentSessionId === updated.agentSessionId ? updated : session
      )
    : [updated, ...sessions]
}

export function updateSet(current: Set<string>, value: string, included: boolean): Set<string> {
  const next = new Set(current)
  if (included) next.add(value)
  else next.delete(value)
  return next
}

export function selectionAvailable(props: {
  activeSectionId: string | null
  selection: AgentPanelSelection | null
}): boolean {
  return (
    props.activeSectionId !== null &&
    props.selection?.sectionId === props.activeSectionId &&
    props.selection.selectedBlockIds.length > 0
  )
}

export function editorContextForScope(
  scope: AgentStartScope,
  activeSectionId: string | null,
  selection: AgentPanelSelection | null,
  currentRevisionIds: Readonly<Record<string, string>>
) {
  if (scope === 'project') {
    return {
      activeSectionId: null,
      activeBlockId: null,
      selectedBlockIds: [],
      selectedText: null,
      capturedAt: Date.now(),
      capturedRevisionId: null
    }
  }
  if (activeSectionId === null) throw new Error('No active section is available')
  const capturedRevisionId = currentRevisionIds[activeSectionId] ?? null
  if (scope === 'section') {
    return {
      activeSectionId,
      activeBlockId: null,
      selectedBlockIds: [],
      selectedText: null,
      capturedAt: Date.now(),
      capturedRevisionId
    }
  }
  if (selection?.sectionId !== activeSectionId || selection.selectedBlockIds.length === 0) {
    throw new Error('No active block selection is available')
  }
  return {
    activeSectionId,
    activeBlockId: selection.activeBlockId,
    selectedBlockIds: selection.selectedBlockIds,
    selectedText: selection.selectedText ?? null,
    capturedAt: selection.capturedAt ?? Date.now(),
    capturedRevisionId: selection.capturedRevisionId ?? capturedRevisionId
  }
}

export function deliveryLabel(
  delivery: 'prompt' | 'steer' | 'follow_up' | 'clarification'
): string {
  if (delivery === 'steer') return 'Steered'
  if (delivery === 'follow_up') return 'Queued'
  if (delivery === 'clarification') return 'Clarified'
  return 'You'
}

export function blockOperationDisplays(
  proposal: MutationProposalRecord
): Array<{ label: string; raw: string }> {
  if (proposal.payload.kind === 'generated_image_insert') {
    const iteration = proposal.payload.mutation.iteration
    return [
      {
        label:
          iteration === null
            ? `Generate ${proposal.payload.mutation.imageSize} image`
            : iteration.disposition === 'replace'
              ? `Generate ${proposal.payload.mutation.imageSize} replacement candidate`
              : `Generate ${proposal.payload.mutation.imageSize} candidate to insert`,
        raw: JSON.stringify(proposal.payload.mutation)
      }
    ]
  }
  if (proposal.payload.kind !== 'section_patch') return []
  return proposal.payload.mutation.operations.map((operation) => {
    let label: string
    switch (operation.type) {
      case 'insertBlocks':
        label = `Insert ${blockCountLabel(operation.blocks.length)}`
        break
      case 'updateBlock':
        label = 'Update 1 block'
        break
      case 'removeBlocks':
        label = `Remove ${blockCountLabel(operation.blockIds.length)}`
        break
      case 'replaceBlocks':
        label = `Replace ${blockCountLabel(operation.blockIds.length)}`
        break
      case 'moveBlocks':
        label = `Move ${blockCountLabel(operation.blockIds.length)}`
        break
    }
    return { label, raw: JSON.stringify(operation) }
  })
}

function blockCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'block' : 'blocks'}`
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The Agent operation failed.'
}

export function approvalModeLabel(mode: AgentApprovalMode): string {
  if (mode === 'manual') return 'Manual'
  if (mode === 'section_auto') return 'Write Auto'
  return 'YOLO'
}

export function approvalModeDescription(mode: AgentApprovalMode): string {
  if (mode === 'manual') return 'Review every proposed manuscript change'
  if (mode === 'section_auto') return 'Apply writing changes automatically; review Brief and rules'
  return 'Apply every proposed change automatically without review'
}

export function selectAttentionSession(active: AgentSessionRecord[]): AgentSessionRecord | null {
  return (
    active.find((session) => session.workflowState === 'awaiting_input') ??
    active.find(
      (session) => session.workflowState === 'running' || session.workflowState === 'compacting'
    ) ??
    active.find(
      (session) =>
        session.workflowState === 'generating' || session.workflowState === 'awaiting_review'
    ) ??
    active[0] ??
    null
  )
}

export function hasManualCompactionHead(events: readonly AgentEventRecord[]): boolean {
  let coveredThroughSequence = 0
  for (const event of events) {
    if (event.type !== 'compaction_summary') continue
    const checkpoint = agentCompactionSummaryPayloadSchema.safeParse(event.payload)
    if (checkpoint.success) coveredThroughSequence = checkpoint.data.coveredThroughSequence
  }
  return (
    events.filter(
      (event) =>
        event.sequence > coveredThroughSequence &&
        (event.type === 'run_completed' || event.type === 'run_interrupted')
    ).length >= 2
  )
}

export function sectionFollowTargetForAgentEvent(
  rendererEvent: AgentRendererEvent,
  activeSessionId: string | null
): string | null {
  if (
    activeSessionId === null ||
    rendererEvent.kind !== 'durable' ||
    rendererEvent.event.agentSessionId !== activeSessionId ||
    rendererEvent.event.type !== 'tool_call'
  ) {
    return null
  }
  const call = agentToolCallPayloadSchema.safeParse(rendererEvent.event.payload)
  if (!call.success) return null
  if (call.data.toolName === 'submit_section_change') {
    const args = modelSubmitSectionChangeArgsSchema.safeParse(call.data.args)
    return args.success ? args.data.sectionId : null
  }
  if (call.data.toolName === 'generate_image') {
    const args = generateImageArgsSchema.safeParse(call.data.args)
    if (args.success) return args.data.sectionId
    const legacy = normalizedGenerateImageArgsSchema.safeParse(call.data.args)
    return legacy.success ? legacy.data.sectionId : null
  }
  return null
}

export function effectiveScope(
  preference: 'auto' | AgentStartScope,
  selectionIsAvailable: boolean,
  activeSectionId: string | null
): AgentStartScope {
  if (preference === 'selection') {
    if (selectionIsAvailable) return 'selection'
    return activeSectionId === null ? 'project' : 'section'
  }
  if (preference === 'section') return activeSectionId === null ? 'project' : 'section'
  if (preference === 'project') return 'project'
  if (selectionIsAvailable) return 'selection'
  return activeSectionId === null ? 'project' : 'section'
}

export function agentComposerKeyAction(input: {
  key: string
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  isComposing: boolean
  running: boolean
}): 'none' | 'newline' | 'send' | 'follow_up' | 'steer' {
  if (input.key !== 'Enter' || input.isComposing) return 'none'
  if (input.shiftKey) return 'newline'
  if (!input.running) return 'send'
  return input.metaKey || input.ctrlKey ? 'steer' : 'follow_up'
}

export function agentComposerRunningAction(prompt: string): 'stop' | 'follow_up' {
  return prompt.trim().length === 0 ? 'stop' : 'follow_up'
}

export function sessionStatusLabel(session: AgentSessionRecord): string {
  if (session.status === 'archived') return 'Archived'
  if (
    session.workflowState === 'running' ||
    session.workflowState === 'generating' ||
    session.workflowState === 'compacting'
  ) {
    return 'Working'
  }
  if (session.workflowState === 'awaiting_input') return 'Needs answer'
  if (session.workflowState === 'awaiting_review') return 'Review'
  return 'Ready'
}

export function resolveSelectedModel(
  catalog: AgentProviderCatalog,
  selection: AgentModelSelection | null
) {
  return findAgentModelSelection(catalog.presets, selection)
}
