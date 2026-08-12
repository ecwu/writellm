import { ipcMain, type IpcMain } from 'electron'
import type { Logger } from 'pino'
import {
  agentArchiveSessionInputSchema,
  agentArchiveSessionResultSchema,
  agentCreateSessionInputSchema,
  agentCreateSessionResultSchema,
  agentCompactSessionInputSchema,
  agentCompactSessionResultSchema,
  agentEventPageInputSchema,
  agentEventPageSchema,
  agentListProposalsResultSchema,
  agentListRunsInputSchema,
  agentListRunsResultSchema,
  agentListSessionsInputSchema,
  agentListSessionsResultSchema,
  agentProjectActivitySnapshotSchema,
  agentProjectActivitySubscriptionInputSchema,
  agentGenerateSessionTitleInputSchema,
  agentGenerateSessionTitleResultSchema,
  agentQueueInputSchema,
  agentRestoreSessionInputSchema,
  agentRestoreSessionResultSchema,
  agentRunInputSchema,
  agentSetApprovalModeInputSchema,
  agentSetApprovalModeResultSchema,
  agentSetModelSelectionInputSchema,
  agentSetModelSelectionResultSchema,
  agentSetThinkingLevelInputSchema,
  agentSetThinkingLevelResultSchema,
  agentSetSkillSelectionInputSchema,
  agentSetSkillSelectionResultSchema,
  agentStartRunInputSchema,
  agentStartRunResultSchema,
  agentStopCompactionInputSchema,
  agentStopCompactionResultSchema,
  agentSubscriptionInputSchema
} from '../../shared/contracts/agent-ipc'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import type { AgentEventBroker } from '../agent/event-broker'
import {
  buildApprovalContinuationPrompt,
  buildRejectedProposalRevisionPrompt
} from '../agent/prompts/task-prompts'
import type { ProjectManager } from '../project/project-manager'
import {
  clampResolvedAgentThinkingLevel,
  type AgentProviderCatalogService
} from '../providers/agent-provider-catalog'
import { authorizeSender } from './authorize-sender'

export interface AgentIpcMain extends Pick<IpcMain, 'handle' | 'removeHandler'> {}

export function registerAgentIpc(options: {
  manager: ProjectManager
  broker: AgentEventBroker
  logger: Pick<Logger, 'info' | 'error'>
  catalog?: Pick<
    AgentProviderCatalogService,
    'snapshot' | 'resolve' | 'setDefaultSelection' | 'getLastThinkingLevel' | 'setLastThinkingLevel'
  >
  developmentUrl?: string
  ipc?: AgentIpcMain
}): { revokeSession(projectSessionId: string): void; unregister(): void } {
  const ipc = options.ipc ?? ipcMain
  const readService = (projectSessionId: string) => {
    const context = options.manager.assertActiveSession(projectSessionId)
    if (context.agentSessions === null) throw new Error('Agent sessions are unavailable')
    return context.agentSessions
  }
  const mutationContext = (projectSessionId: string) => {
    const context = options.manager.assertMutationSession(projectSessionId)
    if (context.agentSessions === null) throw new Error('Agent sessions are unavailable')
    return context
  }
  const lifecycle = async <T>(event: string, operation: () => T | Promise<T>): Promise<T> => {
    const startedAt = Date.now()
    try {
      const result = await operation()
      options.logger.info(
        { event: `${event}.completed`, durationMs: Date.now() - startedAt },
        'Agent IPC operation completed'
      )
      return result
    } catch (err) {
      options.logger.error(
        { event: `${event}.failed`, err, durationMs: Date.now() - startedAt },
        'Agent IPC operation failed'
      )
      throw err
    }
  }

  ipc.handle(IPC_CHANNELS.agentListSessions, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentListSessionsInputSchema.parse(raw)
    return agentListSessionsResultSchema.parse(
      readService(input.projectSessionId).listSessions(input.status)
    )
  })
  ipc.handle(IPC_CHANNELS.agentCreateSession, async (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentCreateSessionInputSchema.parse(raw)
    return lifecycle('agent.session.create', async () => {
      const selection =
        input.modelSelection ??
        (options.catalog === undefined ? null : (await options.catalog.snapshot()).defaultSelection)
      const thinkingLevel =
        selection === null
          ? 'off'
          : clampResolvedAgentThinkingLevel(
              await requireCatalog(options.catalog).resolve(selection),
              await requireCatalog(options.catalog).getLastThinkingLevel()
            )
      return agentCreateSessionResultSchema.parse(
        mutationContext(input.projectSessionId).agentSessions?.createSession(
          input.title,
          undefined,
          selection,
          thinkingLevel
        )
      )
    })
  })
  ipc.handle(IPC_CHANNELS.agentGenerateSessionTitle, async (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentGenerateSessionTitleInputSchema.parse(raw)
    return lifecycle('agent.session.generate_title', async () => {
      const service = mutationContext(input.projectSessionId).agentSessions
      if (service === null) throw new Error('Agent sessions are unavailable')
      return agentGenerateSessionTitleResultSchema.parse(
        await service.generateSessionTitle(input.agentSessionId)
      )
    })
  })
  ipc.handle(IPC_CHANNELS.agentArchiveSession, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentArchiveSessionInputSchema.parse(raw)
    return lifecycle('agent.session.archive', () =>
      agentArchiveSessionResultSchema.parse(
        mutationContext(input.projectSessionId).agentSessions?.archiveSession(input.agentSessionId)
      )
    )
  })
  ipc.handle(IPC_CHANNELS.agentRestoreSession, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentRestoreSessionInputSchema.parse(raw)
    return lifecycle('agent.session.restore', () =>
      agentRestoreSessionResultSchema.parse(
        mutationContext(input.projectSessionId).agentSessions?.restoreSession(input.agentSessionId)
      )
    )
  })
  ipc.handle(IPC_CHANNELS.agentSetModelSelection, async (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentSetModelSelectionInputSchema.parse(raw)
    return lifecycle('agent.session.set_model_selection', async () => {
      if (options.catalog === undefined) throw new Error('Agent provider catalog is unavailable')
      const catalog = requireCatalog(options.catalog)
      const resolved = await catalog.resolve(input.selection)
      const service = mutationContext(input.projectSessionId).agentSessions
      if (service === null) throw new Error('Agent sessions are unavailable')
      const current = service
        .listSessions()
        .find((session) => session.agentSessionId === input.agentSessionId)
      if (current === undefined) throw new Error('Agent session does not exist')
      const requestedLevel =
        current.modelSelection === null
          ? await catalog.getLastThinkingLevel()
          : current.thinkingLevel
      const thinkingLevel = clampResolvedAgentThinkingLevel(resolved, requestedLevel)
      const result = agentSetModelSelectionResultSchema.parse(
        service.setModelSelection(input.agentSessionId, input.selection, thinkingLevel)
      )
      await catalog.setDefaultSelection(input.selection)
      return result
    })
  })
  ipc.handle(IPC_CHANNELS.agentSetThinkingLevel, async (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentSetThinkingLevelInputSchema.parse(raw)
    return lifecycle('agent.session.set_thinking_level', async () => {
      const catalog = requireCatalog(options.catalog)
      const service = mutationContext(input.projectSessionId).agentSessions
      if (service === null) throw new Error('Agent sessions are unavailable')
      const session = service
        .listSessions()
        .find((candidate) => candidate.agentSessionId === input.agentSessionId)
      if (session === undefined) throw new Error('Agent session does not exist')
      if (session.modelSelection === null) throw new Error('Choose an Agent model first')
      const resolved = await catalog.resolve(session.modelSelection)
      if (clampResolvedAgentThinkingLevel(resolved, input.level) !== input.level) {
        throw new Error('Selected Thinking level is unavailable for this Agent model')
      }
      const result = agentSetThinkingLevelResultSchema.parse(
        service.setThinkingLevel(input.agentSessionId, input.level)
      )
      await catalog.setLastThinkingLevel(input.level)
      return result
    })
  })
  ipc.handle(IPC_CHANNELS.agentSetApprovalMode, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentSetApprovalModeInputSchema.parse(raw)
    return lifecycle('agent.session.set_approval_mode', () =>
      agentSetApprovalModeResultSchema.parse(
        mutationContext(input.projectSessionId).agentSessions?.setApprovalMode(
          input.agentSessionId,
          input.mode
        )
      )
    )
  })
  ipc.handle(IPC_CHANNELS.agentSetSkillSelection, async (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentSetSkillSelectionInputSchema.parse(raw)
    return lifecycle('agent.session.set_skill_selection', async () => {
      const service = mutationContext(input.projectSessionId).agentSessions
      if (service === null) throw new Error('Agent sessions are unavailable')
      return agentSetSkillSelectionResultSchema.parse(
        await service.setSkillSelection(input.agentSessionId, input.selection)
      )
    })
  })
  ipc.handle(IPC_CHANNELS.agentListEvents, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentEventPageInputSchema.parse(raw)
    return agentEventPageSchema.parse(
      readService(input.projectSessionId).listEventPage(
        input.agentSessionId,
        input.afterSequence,
        input.limit
      )
    )
  })
  ipc.handle(IPC_CHANNELS.agentListRuns, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentListRunsInputSchema.parse(raw)
    return agentListRunsResultSchema.parse(
      readService(input.projectSessionId).listRuns(input.agentSessionId, input.limit)
    )
  })
  ipc.handle(IPC_CHANNELS.agentListProposals, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentListRunsInputSchema.omit({ limit: true }).parse(raw)
    const context = options.manager.assertActiveSession(input.projectSessionId)
    if (context.agentMutations === null) throw new Error('Agent proposals are unavailable')
    return agentListProposalsResultSchema.parse(context.agentMutations.list(input.agentSessionId))
  })
  ipc.handle(IPC_CHANNELS.agentStartRun, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentStartRunInputSchema.parse(raw)
    return lifecycle('agent.run.start', async () => {
      const context = mutationContext(input.projectSessionId)
      const service = context.agentSessions
      if (service === null) throw new Error('Agent sessions are unavailable')
      let prompt = input.prompt
      let reuseSkillFromRunId = input.reuseSkillFromRunId
      let presentation:
        | { kind: 'approval_continuation' }
        | { kind: 'review_feedback'; displayContent: string }
        | undefined
      if (input.approvedProposalId !== undefined) {
        if (context.agentMutations === null) throw new Error('Agent proposals are unavailable')
        const proposal = context.agentMutations
          .list(input.agentSessionId)
          .find((candidate) => candidate.proposalId === input.approvedProposalId)
        if (proposal === undefined || !['applied', 'satisfied'].includes(proposal.status)) {
          throw new Error('Approved proposal continuation is not authorized')
        }
        const blocker = context.agentMutations
          .list(input.agentSessionId)
          .find((candidate) => ['pending', 'generating'].includes(candidate.status))
        if (blocker !== undefined) {
          throw new Error(
            blocker.status === 'generating'
              ? 'Agent conversation is waiting for image generation'
              : 'Agent conversation is waiting for review'
          )
        }
        await service.recordApprovalDecision({
          agentSessionId: input.agentSessionId,
          agentRunId: proposal.agentRunId,
          proposalId: proposal.proposalId,
          decision: 'approved',
          continueRequested: true
        })
        reuseSkillFromRunId ??= proposal.agentRunId
        prompt = buildApprovalContinuationPrompt(proposal, input.prompt)
        presentation = { kind: 'approval_continuation' }
        options.logger.info(
          {
            event: 'agent.run.review_continuation_authorized',
            agentSessionId: input.agentSessionId,
            proposalId: proposal.proposalId,
            sourceRunId: proposal.agentRunId,
            decision: 'approved'
          },
          'Authorized Agent review continuation'
        )
      } else if (input.rejectedProposalId !== undefined) {
        if (context.agentMutations === null) throw new Error('Agent proposals are unavailable')
        const proposal = context.agentMutations
          .list(input.agentSessionId)
          .find((candidate) => candidate.proposalId === input.rejectedProposalId)
        if (
          proposal === undefined ||
          proposal.status !== 'rejected' ||
          proposal.rejectedReason === null
        ) {
          throw new Error('Rejected proposal revision is not authorized')
        }
        const blocker = context.agentMutations
          .list(input.agentSessionId)
          .find((candidate) => ['pending', 'generating'].includes(candidate.status))
        if (blocker !== undefined) {
          throw new Error(
            blocker.status === 'generating'
              ? 'Agent conversation is waiting for image generation'
              : 'Agent conversation is waiting for review'
          )
        }
        reuseSkillFromRunId = proposal.agentRunId
        prompt = buildRejectedProposalRevisionPrompt(proposal)
        presentation = {
          kind: 'review_feedback',
          displayContent: proposal.rejectedReason
        }
        options.logger.info(
          {
            event: 'agent.run.review_continuation_authorized',
            agentSessionId: input.agentSessionId,
            proposalId: proposal.proposalId,
            sourceRunId: proposal.agentRunId,
            decision: 'rejected'
          },
          'Authorized Agent review continuation'
        )
      }
      const reuseRun =
        reuseSkillFromRunId === undefined ? undefined : service.requireRun(reuseSkillFromRunId)
      if (reuseRun !== undefined && reuseRun.agentSessionId !== input.agentSessionId) {
        throw new Error('The writing skill snapshot belongs to another Agent conversation')
      }
      const reuseSkillSnapshot = reuseRun?.skillSnapshot
      const started = await service.startRun({
        agentSessionId: input.agentSessionId,
        prompt,
        editorContext: input.editorContext,
        reuseSkillSnapshot,
        presentation
      })
      return agentStartRunResultSchema.parse({ run: service.requireRun(started.agentRunId) })
    })
  })
  ipc.handle(IPC_CHANNELS.agentSteerRun, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentQueueInputSchema.parse(raw)
    return lifecycle('agent.run.steer', () =>
      mutationContext(input.projectSessionId).agentSessions?.steer(input.agentRunId, input.content)
    )
  })
  ipc.handle(IPC_CHANNELS.agentFollowUpRun, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentQueueInputSchema.parse(raw)
    return lifecycle('agent.run.follow_up', () =>
      mutationContext(input.projectSessionId).agentSessions?.followUp(
        input.agentRunId,
        input.content
      )
    )
  })
  ipc.handle(IPC_CHANNELS.agentAbortRun, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentRunInputSchema.parse(raw)
    return lifecycle('agent.run.abort', () =>
      mutationContext(input.projectSessionId).agentSessions?.abort(input.agentRunId)
    )
  })
  ipc.handle(IPC_CHANNELS.agentCompactSession, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentCompactSessionInputSchema.parse(raw)
    return lifecycle('agent.compaction.start', async () => {
      const service = mutationContext(input.projectSessionId).agentSessions
      if (service === null) throw new Error('Agent sessions are unavailable')
      return agentCompactSessionResultSchema.parse(
        await service.compactSession(input.agentSessionId)
      )
    })
  })
  ipc.handle(IPC_CHANNELS.agentStopCompaction, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentStopCompactionInputSchema.parse(raw)
    return lifecycle('agent.compaction.stop', async () => {
      const service = mutationContext(input.projectSessionId).agentSessions
      if (service === null) throw new Error('Agent sessions are unavailable')
      await service.stopCompaction(input.agentSessionId, input.compactionId)
      return agentStopCompactionResultSchema.parse({})
    })
  })
  ipc.handle(IPC_CHANNELS.agentSubscribeEvents, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentSubscriptionInputSchema.parse(raw)
    const service = readService(input.projectSessionId)
    options.broker.subscribe({
      sender: event.sender,
      projectSessionId: input.projectSessionId,
      agentSessionId: input.agentSessionId,
      subscriptionId: input.subscriptionId
    })
    try {
      return agentEventPageSchema.parse(
        service.listEventPage(input.agentSessionId, input.afterSequence)
      )
    } catch (err) {
      options.broker.unsubscribe(event.sender.id, input.subscriptionId)
      throw err
    }
  })
  ipc.handle(IPC_CHANNELS.agentCompleteReplay, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentSubscriptionInputSchema.parse(raw)
    options.manager.assertActiveSession(input.projectSessionId)
    options.broker.completeReplay(event.sender.id, input.subscriptionId)
  })
  ipc.handle(IPC_CHANNELS.agentUnsubscribeEvents, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentSubscriptionInputSchema.parse(raw)
    options.broker.unsubscribe(event.sender.id, input.subscriptionId)
  })
  ipc.handle(IPC_CHANNELS.agentSubscribeActivity, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentProjectActivitySubscriptionInputSchema.parse(raw)
    const service = readService(input.projectSessionId)
    options.broker.subscribeActivity({
      sender: event.sender,
      projectSessionId: input.projectSessionId,
      subscriptionId: input.subscriptionId
    })
    try {
      return agentProjectActivitySnapshotSchema.parse(service.projectActivitySnapshot())
    } catch (err) {
      options.broker.unsubscribe(event.sender.id, input.subscriptionId)
      throw err
    }
  })
  ipc.handle(IPC_CHANNELS.agentCompleteActivitySnapshot, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentProjectActivitySubscriptionInputSchema.parse(raw)
    options.manager.assertActiveSession(input.projectSessionId)
    options.broker.completeActivitySnapshot(event.sender.id, input.subscriptionId)
  })
  ipc.handle(IPC_CHANNELS.agentUnsubscribeActivity, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentProjectActivitySubscriptionInputSchema.parse(raw)
    options.broker.unsubscribe(event.sender.id, input.subscriptionId)
  })

  const channels = [
    IPC_CHANNELS.agentListSessions,
    IPC_CHANNELS.agentCreateSession,
    IPC_CHANNELS.agentGenerateSessionTitle,
    IPC_CHANNELS.agentArchiveSession,
    IPC_CHANNELS.agentRestoreSession,
    IPC_CHANNELS.agentSetApprovalMode,
    IPC_CHANNELS.agentSetModelSelection,
    IPC_CHANNELS.agentSetThinkingLevel,
    IPC_CHANNELS.agentSetSkillSelection,
    IPC_CHANNELS.agentListEvents,
    IPC_CHANNELS.agentListRuns,
    IPC_CHANNELS.agentListProposals,
    IPC_CHANNELS.agentStartRun,
    IPC_CHANNELS.agentSteerRun,
    IPC_CHANNELS.agentFollowUpRun,
    IPC_CHANNELS.agentAbortRun,
    IPC_CHANNELS.agentCompactSession,
    IPC_CHANNELS.agentStopCompaction,
    IPC_CHANNELS.agentSubscribeEvents,
    IPC_CHANNELS.agentCompleteReplay,
    IPC_CHANNELS.agentUnsubscribeEvents,
    IPC_CHANNELS.agentSubscribeActivity,
    IPC_CHANNELS.agentCompleteActivitySnapshot,
    IPC_CHANNELS.agentUnsubscribeActivity
  ]
  return {
    revokeSession(projectSessionId) {
      options.broker.revokeSession(projectSessionId)
    },
    unregister() {
      options.broker.clear()
      for (const channel of channels) ipc.removeHandler(channel)
    }
  }
}

function requireCatalog(
  catalog: Parameters<typeof registerAgentIpc>[0]['catalog']
): NonNullable<Parameters<typeof registerAgentIpc>[0]['catalog']> {
  if (catalog === undefined) throw new Error('Agent provider catalog is unavailable')
  return catalog
}
