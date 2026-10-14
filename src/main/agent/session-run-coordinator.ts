import type { AgentImageContent } from '../../shared/contracts/agent-attachments'
import type {
  AgentApprovalMode,
  AgentEditorContext,
  AgentInteractionMode,
  AgentModelLimits,
  AgentRuntimeModel,
  WritingToolGroup
} from '../../shared/contracts/agent'
import type { AskUserArgs, AskUserResult } from '../../shared/contracts/agent-tools'
import type { AgentThinkingLevel, ProviderConfig } from '../../shared/contracts/providers'
import type { SkillRunSnapshot } from '../../shared/contracts/skills'
import type { AgentSessionRunHandle } from '../providers/gateways'
import type { SkillRunState } from '../skills/skill-router'
import type { AgentSkillPromptInput, WritingSnapshot } from './context'
import type { StartedAgentRun } from './session-service'

export interface ActiveRun {
  readonly agentSessionId: string
  readonly agentRunId: string
  readonly operationId: string
  readonly controller: AbortController
  handle: AgentSessionRunHandle | null
  phase: 'routing' | 'compacting' | 'running' | 'awaiting_input'
  readonly config: Extract<ProviderConfig, { role: 'agent' }>
  readonly editorContext: AgentEditorContext
  readonly approvalMode: AgentApprovalMode
  readonly interactionMode: AgentInteractionMode
  readonly thinkingLevel: AgentThinkingLevel
  readonly runtimeModel: AgentRuntimeModel
  readonly modelLimits: AgentModelLimits
  readonly credential: string
  currentRequest: string
  currentImages?: AgentImageContent[]
  readonly maxOutputTokens: number
  readonly temperature?: number
  readonly authorizedModelRequestIds: Set<string>
  readonly pendingModelRequestIds: Set<string>
  readonly pendingMessages: PendingFollowUpMessage[]
  activeToolGroups: WritingToolGroup[]
  citationRecoveryState: 'none' | 'searched' | 'expanded'
  readonly snapshots: Map<string, WritingSnapshot>
  skillSnapshot: SkillRunSnapshot
  skillState: SkillRunState | null
  skillPrompt: AgentSkillPromptInput
  skillTraceToolCallId?: string
  systemPrompt: string
  partialText: string
  reviewPause: { proposalId: string; kind: string } | null
  pendingQuestion: PendingUserQuestion | null
  overflowRetryAttempted: boolean
  completion: Promise<void>
}

export interface PendingUserQuestion {
  readonly toolCallId: string
  readonly modelRequestId: string
  readonly args: AskUserArgs
  readonly startedAt: string
  submitting: boolean
  readonly resolveAnswers: (result: AskUserResult) => void
  readonly rejectAnswers: (error: Error) => void
  readonly completion: Promise<{ ok: boolean }>
  readonly complete: (result: { ok: boolean }) => void
}

export interface PendingFollowUpMessage {
  readonly attachmentIds?: string[]
  readonly images?: AgentImageContent[]
  readonly pendingMessageId: string
  readonly modelRequestId: string
  readonly content: string
  readonly timestamp: number
  readonly queuedAt: string
  readonly systemPrompt: string
  readonly snapshot?: WritingSnapshot
}

export interface ActiveCompaction {
  readonly compactionId: string
  readonly agentSessionId: string
  readonly trigger: 'manual'
  phase: 'planning' | 'summarizing'
  readonly startedAt: string
  readonly controller: AbortController
  completion: Promise<void>
}

export interface StartingRun {
  readonly agentSessionId: string
  readonly agentRunId: string
  readonly startedAt: string
  readonly controller: AbortController
  completion: Promise<StartedAgentRun>
}

export class AgentRunCoordinator {
  readonly #starting = new Map<string, StartingRun>()
  readonly #runs = new Map<string, ActiveRun>()
  readonly #compactions = new Map<string, ActiveCompaction>()
  readonly #workBySession = new Map<string, string>()

  get starting(): ReadonlyMap<string, StartingRun> {
    return this.#starting
  }
  get runs(): ReadonlyMap<string, ActiveRun> {
    return this.#runs
  }
  get compactions(): ReadonlyMap<string, ActiveCompaction> {
    return this.#compactions
  }
  get activeCount(): number {
    return this.#workBySession.size
  }
  isBusy(agentSessionId: string): boolean {
    return this.#workBySession.has(agentSessionId)
  }

  registerStarting(starting: StartingRun): void {
    this.#starting.set(starting.agentRunId, starting)
  }
  finishStarting(starting: StartingRun): void {
    if (this.#starting.get(starting.agentRunId) === starting)
      this.#starting.delete(starting.agentRunId)
  }
  registerRun(active: ActiveRun): void {
    this.#runs.set(active.agentRunId, active)
  }
  finishRun(active: ActiveRun): void {
    if (this.#runs.get(active.agentRunId) === active) this.#runs.delete(active.agentRunId)
  }
  registerCompaction(active: ActiveCompaction): void {
    this.#compactions.set(active.compactionId, active)
  }
  finishCompaction(active: ActiveCompaction): void {
    if (this.#compactions.get(active.compactionId) === active)
      this.#compactions.delete(active.compactionId)
  }
  reserve(agentSessionId: string, workId: string, signal: AbortSignal): void {
    if (this.isBusy(agentSessionId))
      throw new Error('Agent work is already active in this conversation')
    signal.throwIfAborted()
    this.#workBySession.set(agentSessionId, workId)
  }
  release(agentSessionId: string, workId: string): boolean {
    if (this.#workBySession.get(agentSessionId) !== workId) return false
    this.#workBySession.delete(agentSessionId)
    return true
  }
}
