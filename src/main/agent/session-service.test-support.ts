import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, expect } from 'vitest'
import type { AgentRuntimeEvent, WritingToolGroup } from '../../shared/contracts/agent'
import type { AgentToolRequest, AgentToolResponse } from '../../shared/contracts/agent-tools'
import type { ProviderConfig } from '../../shared/contracts/providers'
import type {
  AgentSessionRunHandle,
  AgentSessionRunInput,
  AgentSessionRuntime
} from '../providers/gateways'
import { initializeProjectDatabase, type ProjectDatabase } from '../project/project-database'
import { AgentSessionService, type AgentSessionServiceOptions } from './session-service'

export const temporaryDirectories: string[] = []

export const log = pino({ level: 'silent' })

export const config: Extract<ProviderConfig, { role: 'agent' }> = {
  role: 'agent',
  providerId: 'openai-compatible',
  baseUrl: 'https://agent.example.test/v1',
  model: 'writer',
  modelRevision: 'writer-r1',
  timeoutMs: 30_000,
  embeddingDimension: null,
  batchLimit: 1,
  fileSizeLimitMb: null
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

export type TitleResult = {
  text: string
  stopReason: 'stop'
  metadata: ReturnType<typeof metadata>
}

export type TitleGenerationInput = Parameters<
  NonNullable<AgentSessionServiceOptions['generateTitle']>
>[0]

export function titleResult(text: string, responseId: string): TitleResult {
  return { text, stopReason: 'stop', metadata: metadata(responseId) }
}

export interface FakeActiveRun {
  config: ProviderConfig
  credential: string
  input: AgentSessionRunInput
  commands: Array<{
    operation: 'steer' | 'follow_up'
    modelRequestId: string
    pendingMessageId?: string
  }>
  authorizations: Array<{
    continuationId: string
    modelRequestId: string
    systemPrompt: string
    activeToolGroups?: WritingToolGroup[]
    runtimeMessageBudgetTokens?: number
    finalize?: boolean
  }>
  retryAuthorizations: Array<{
    capabilityId: string
    sourceModelRequestId: string
    targetModelRequestId: string
  }>
  requestTool: (request: AgentToolRequest) => Promise<AgentToolResponse>
  emit: (event: AgentRuntimeEvent) => Promise<void>
  resolve: (outcome?: 'finished' | 'awaiting_review') => void
  reject: (error: Error) => void
}

export async function activateToolGroups(
  active: FakeActiveRun,
  groups: readonly WritingToolGroup[]
): Promise<void> {
  await expect(
    active.requestTool({
      type: 'tool_request',
      requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc4a0',
      projectSessionId: active.input.projectSessionId,
      agentSessionId: active.input.agentSessionId,
      agentRunId: active.input.agentRunId,
      toolCallId: 'tool-activate-groups',
      modelRequestId: active.input.modelRequestId,
      toolName: 'activate_tool_groups',
      args: { groups: [...groups] }
    })
  ).resolves.toMatchObject({
    ok: true,
    data: { activeGroups: groups }
  })
}

export class FakeAgentRuntime implements AgentSessionRuntime {
  readonly #active = new Map<string, FakeActiveRun>()
  #latestRunId: string | undefined

  beginSessionRun(
    _config: ProviderConfig,
    credential: string,
    input: AgentSessionRunInput,
    signal: AbortSignal,
    onEvent: (event: AgentRuntimeEvent) => void | Promise<void>,
    onToolRequest?: (request: AgentToolRequest, signal: AbortSignal) => Promise<AgentToolResponse>
  ): AgentSessionRunHandle {
    if (_config.role === 'agent' && _config.presetId === undefined) {
      expect(credential).toBe('agent-secret')
    }
    let resolve: (outcome?: 'finished' | 'awaiting_review') => void = () => undefined
    let reject: (error: Error) => void = () => undefined
    const completion = new Promise<{ outcome: 'finished' | 'awaiting_review' }>(
      (resolvePromise, rejectPromise) => {
        resolve = (outcome = 'finished') => resolvePromise({ outcome })
        reject = rejectPromise
      }
    )
    signal.addEventListener(
      'abort',
      () => {
        const error = new Error('Agent run aborted')
        error.name = 'AbortError'
        reject(error)
      },
      { once: true }
    )
    const commands: FakeActiveRun['commands'] = []
    const authorizations: FakeActiveRun['authorizations'] = []
    const retryAuthorizations: FakeActiveRun['retryAuthorizations'] = []
    const active = {
      config: _config,
      credential,
      input,
      commands,
      authorizations,
      retryAuthorizations,
      requestTool: (request) => {
        if (onToolRequest === undefined) throw new Error('No fake Agent tool handler')
        return onToolRequest(request, signal)
      },
      emit: async (event) => onEvent(event),
      resolve,
      reject
    }
    this.#active.set(input.agentRunId, active)
    this.#latestRunId = input.agentRunId
    return {
      requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc431',
      completion,
      steer: (command) =>
        commands.push({ operation: 'steer', modelRequestId: command.modelRequestId }),
      followUp: (command) =>
        commands.push({
          operation: 'follow_up',
          modelRequestId: command.modelRequestId,
          pendingMessageId: command.pendingMessageId
        }),
      queueAction: () => Promise.resolve('completed'),
      authorizeFollowUpConsumption: () => undefined,
      authorizeModelCall: (command) =>
        authorizations.push({
          continuationId: command.continuationId,
          modelRequestId: command.modelRequestId,
          systemPrompt: command.systemPrompt,
          ...(command.activeToolGroups === undefined
            ? {}
            : { activeToolGroups: command.activeToolGroups }),
          ...(command.runtimeMessageBudgetTokens === undefined
            ? {}
            : { runtimeMessageBudgetTokens: command.runtimeMessageBudgetTokens }),
          ...(command.finalize === undefined ? {} : { finalize: command.finalize })
        }),
      authorizeModelRetry: (command) =>
        retryAuthorizations.push({
          capabilityId: command.capabilityId,
          sourceModelRequestId: command.sourceModelRequestId,
          targetModelRequestId: command.targetModelRequestId
        })
    }
  }

  active(agentRunId = this.#latestRunId): FakeActiveRun {
    const active = agentRunId === undefined ? undefined : this.#active.get(agentRunId)
    if (active === undefined) throw new Error('No fake Agent run is active')
    return active
  }
}

export function createService(
  database: ProjectDatabase,
  runtime: AgentSessionRuntime,
  publishEvent?: AgentSessionServiceOptions['publishEvent'],
  overrides: Partial<
    Pick<
      AgentSessionServiceOptions,
      | 'agentCatalog'
      | 'contextBuilder'
      | 'log'
      | 'tools'
      | 'summarizeHistory'
      | 'messageTokenBudget'
      | 'publishDelta'
      | 'publishSession'
      | 'publishActivity'
      | 'generateTitle'
      | 'resolveModelLimits'
      | 'skillRouter'
    >
  > = {}
): AgentSessionService {
  return new AgentSessionService({
    projectId: '019c6a5c-8d34-7a8e-a602-3d37a52dc421',
    projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc422',
    database,
    runtime,
    providers: {
      withConfiguredProvider: async (_role, operation) => operation(config, 'agent-secret')
    } as never,
    log,
    ...(typeof publishEvent === 'function' ? { publishEvent } : {}),
    ...overrides
  })
}

export async function createDatabase(): Promise<ProjectDatabase> {
  const parent = await mkdtemp(join(tmpdir(), 'writellm-agent-session-'))
  temporaryDirectories.push(parent)
  const root = join(parent, 'Agent.writellm')
  await mkdir(root)
  return initializeProjectDatabase({
    projectRoot: root,
    manifest: {
      format: 'writellm-project',
      formatVersion: 1,
      projectId: '019c6a5c-8d34-7a8e-a602-3d37a52dc421',
      createdAt: '2026-07-21T00:00:00.000Z'
    },
    applicationVersion: '1.0.0-test',
    log
  })
}

export function faultNextImmediate(database: ProjectDatabase): {
  database: ProjectDatabase
  failNext(error: Error): void
} {
  let nextFailure: Error | null = null
  const faulting = Object.create(database) as ProjectDatabase
  faulting.immediate = <T>(operation: Parameters<ProjectDatabase['immediate']>[0]): T => {
    const failure = nextFailure
    nextFailure = null
    if (failure !== null) throw failure
    return database.immediate(operation) as T
  }
  return {
    database: faulting,
    failNext(error) {
      nextFailure = error
    }
  }
}

export function metadata(
  responseId: string
): Extract<AgentRuntimeEvent, { type: 'model_call_finished' }>['metadata'] {
  return {
    usage: {
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsdMicros: null
    },
    responseIds: [responseId],
    retryCount: 0,
    providerModelId: 'writer-resolved'
  }
}

export function assistant(content: string, responseId: string) {
  return {
    content,
    stopReason: 'stop' as const,
    provider: 'openai-compatible',
    model: 'writer',
    responseId,
    metadata: metadata(responseId),
    timestamp: Date.now(),
    interrupted: false
  }
}

export function contextOverflowError(): Error & { code: string; status: number } {
  return Object.assign(new Error('Maximum context length exceeded'), {
    code: 'context_length_exceeded',
    status: 400
  })
}

export function proposalToolResult(kind: 'brief_update' | 'outline_patch' | 'section_patch') {
  return {
    proposalId: '019c6a5c-8d34-7a8e-a602-3d37a52dc491',
    kind,
    status: 'pending' as const,
    preview: {
      summary: 'Proposed change',
      affectedSectionIds: [],
      beforeText: 'before',
      afterText: 'after',
      beforeTextTruncated: false,
      afterTextTruncated: false,
      citedSources: []
    }
  }
}

export function proposalOutcome(
  kind: 'brief_update' | 'outline_patch' | 'section_patch',
  outcome: 'applied' | 'rejected'
) {
  return {
    outcome,
    proposalId: '019c6a5c-8d34-7a8e-a602-3d37a52dc491',
    effectiveProposalId: '019c6a5c-8d34-7a8e-a602-3d37a52dc491',
    kind,
    message: null
  }
}

export function workerExitError(): Error {
  return new Error('writellm-agent-worker exited before responding (1)')
}
