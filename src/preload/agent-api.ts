import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/contracts/channels'
import {
  agentArchiveSessionInputSchema,
  agentArchiveSessionResultSchema,
  agentAnswerUserQuestionInputSchema,
  agentAnswerUserQuestionResultSchema,
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
  agentPendingMessageActionInputSchema,
  agentQueueInputSchema,
  agentRendererEventSchema,
  agentRestoreSessionInputSchema,
  agentRestoreSessionResultSchema,
  agentRunInputSchema,
  agentSetApprovalModeInputSchema,
  agentSetApprovalModeResultSchema,
  agentSetModelSelectionInputSchema,
  agentSetModelSelectionResultSchema,
  agentSetThinkingLevelInputSchema,
  agentSetThinkingLevelResultSchema,
  agentStartRunInputSchema,
  agentStartRunResultSchema,
  agentStopCompactionInputSchema,
  agentStopCompactionResultSchema,
  agentSubscriptionInputSchema,
  type AgentRendererEvent
} from '../shared/contracts/agent-ipc'
import {
  userUpdateWritingTaskInputSchema,
  userUpdateWritingTaskResultSchema
} from '../shared/contracts/writing-task'
import {
  changeSetBatchInputSchema,
  changeSetBatchResultSchema
} from '../shared/contracts/agent-change-set'
import {
  approveMutationProposalInputSchema,
  approveMutationProposalResultSchema,
  cancelImageGenerationInputSchema,
  cancelImageGenerationResultSchema,
  mutationProposalActionResultSchema,
  mutationProposalChangedSchema,
  mutationSubscriptionInputSchema,
  rejectMutationProposalInputSchema,
  undoMutationProposalInputSchema
} from '../shared/contracts/agent-mutations'
import type { DesktopApi } from './desktop-api'

export const agentApi: DesktopApi['agent'] = {
  async listSessions(input) {
    return agentListSessionsResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.agentListSessions,
        agentListSessionsInputSchema.parse(input)
      )
    )
  },
  async createSession(input) {
    return agentCreateSessionResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.agentCreateSession,
        agentCreateSessionInputSchema.parse(input)
      )
    )
  },
  async generateSessionTitle(input) {
    return agentGenerateSessionTitleResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.agentGenerateSessionTitle,
        agentGenerateSessionTitleInputSchema.parse(input)
      )
    )
  },
  async archiveSession(input) {
    return agentArchiveSessionResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.agentArchiveSession,
        agentArchiveSessionInputSchema.parse(input)
      )
    )
  },
  async restoreSession(input) {
    return agentRestoreSessionResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.agentRestoreSession,
        agentRestoreSessionInputSchema.parse(input)
      )
    )
  },
  async setApprovalMode(input) {
    return agentSetApprovalModeResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.agentSetApprovalMode,
        agentSetApprovalModeInputSchema.parse(input)
      )
    )
  },
  async setModelSelection(input) {
    return agentSetModelSelectionResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.agentSetModelSelection,
        agentSetModelSelectionInputSchema.parse(input)
      )
    )
  },
  async setThinkingLevel(input) {
    return agentSetThinkingLevelResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.agentSetThinkingLevel,
        agentSetThinkingLevelInputSchema.parse(input)
      )
    )
  },
  async updateWritingTask(input) {
    return userUpdateWritingTaskResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.agentUpdateWritingTask,
        userUpdateWritingTaskInputSchema.parse(input)
      )
    )
  },
  async listEvents(input) {
    return agentEventPageSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.agentListEvents, agentEventPageInputSchema.parse(input))
    )
  },
  async listRuns(input) {
    return agentListRunsResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.agentListRuns, agentListRunsInputSchema.parse(input))
    )
  },
  async listProposals(input) {
    return agentListProposalsResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.agentListProposals,
        agentListRunsInputSchema.omit({ limit: true }).parse(input)
      )
    )
  },
  async startRun(input) {
    return agentStartRunResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.agentStartRun, agentStartRunInputSchema.parse(input))
    ).run
  },
  async steerRun(input) {
    await ipcRenderer.invoke(IPC_CHANNELS.agentSteerRun, agentQueueInputSchema.parse(input))
  },
  async followUpRun(input) {
    await ipcRenderer.invoke(IPC_CHANNELS.agentFollowUpRun, agentQueueInputSchema.parse(input))
  },
  async steerPendingFollowUp(input) {
    await ipcRenderer.invoke(
      IPC_CHANNELS.agentSteerPendingFollowUp,
      agentPendingMessageActionInputSchema.parse(input)
    )
  },
  async deletePendingFollowUp(input) {
    await ipcRenderer.invoke(
      IPC_CHANNELS.agentDeletePendingFollowUp,
      agentPendingMessageActionInputSchema.parse(input)
    )
  },
  async abortRun(input) {
    await ipcRenderer.invoke(IPC_CHANNELS.agentAbortRun, agentRunInputSchema.parse(input))
  },
  async answerUserQuestion(input) {
    agentAnswerUserQuestionResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.agentAnswerUserQuestion,
        agentAnswerUserQuestionInputSchema.parse(input)
      )
    )
  },
  async compactSession(input) {
    return agentCompactSessionResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.agentCompactSession,
        agentCompactSessionInputSchema.parse(input)
      )
    )
  },
  async stopCompaction(input) {
    agentStopCompactionResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.agentStopCompaction,
        agentStopCompactionInputSchema.parse(input)
      )
    )
  },
  async subscribeEvents(input, listener) {
    const subscription = agentSubscriptionInputSchema.parse({
      ...input,
      subscriptionId: globalThis.crypto.randomUUID(),
      afterSequence: input.afterSequence ?? 0
    })
    let lastSequence = subscription.afterSequence
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const parsed = agentRendererEventSchema.parse(value)
      if (parsed.projectSessionId !== subscription.projectSessionId) return
      if (parsed.kind === 'activity') return
      const sessionId =
        parsed.kind === 'durable'
          ? parsed.event.agentSessionId
          : parsed.kind === 'session'
            ? parsed.session.agentSessionId
            : parsed.agentSessionId
      if (sessionId !== subscription.agentSessionId) return
      if (parsed.kind === 'durable') {
        if (parsed.event.sequence <= lastSequence) return
        lastSequence = parsed.event.sequence
      }
      listener(parsed)
    }
    ipcRenderer.on(IPC_CHANNELS.agentEvent, handler)
    try {
      let page = agentEventPageSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.agentSubscribeEvents, subscription)
      )
      while (true) {
        for (const event of page.events) {
          if (event.sequence <= lastSequence) continue
          lastSequence = event.sequence
          listener(
            agentRendererEventSchema.parse({
              kind: 'durable',
              projectSessionId: subscription.projectSessionId,
              event
            })
          )
        }
        if (!page.hasMore) break
        page = agentEventPageSchema.parse(
          await ipcRenderer.invoke(
            IPC_CHANNELS.agentListEvents,
            agentEventPageInputSchema.parse({
              projectSessionId: subscription.projectSessionId,
              agentSessionId: subscription.agentSessionId,
              afterSequence: page.nextAfterSequence
            })
          )
        )
      }
      await ipcRenderer.invoke(IPC_CHANNELS.agentCompleteReplay, {
        ...subscription,
        afterSequence: lastSequence
      })
    } catch (err) {
      ipcRenderer.removeListener(IPC_CHANNELS.agentEvent, handler)
      void ipcRenderer.invoke(IPC_CHANNELS.agentUnsubscribeEvents, subscription)
      throw err
    }
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.agentEvent, handler)
      void ipcRenderer.invoke(IPC_CHANNELS.agentUnsubscribeEvents, subscription)
    }
  },
  async subscribeActivity(input, listener) {
    const subscription = agentProjectActivitySubscriptionInputSchema.parse({
      ...input,
      subscriptionId: globalThis.crypto.randomUUID()
    })
    let replaying = true
    let disposed = false
    const queued: AgentRendererEvent[] = []
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const parsed = agentRendererEventSchema.parse(value)
      if (parsed.projectSessionId !== subscription.projectSessionId || disposed) return
      if (replaying) queued.push(parsed)
      else listener(parsed)
    }
    ipcRenderer.on(IPC_CHANNELS.agentActivity, handler)
    try {
      const snapshot = agentProjectActivitySnapshotSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.agentSubscribeActivity, subscription)
      )
      return {
        snapshot,
        activate: async () => {
          if (disposed || !replaying) return
          await ipcRenderer.invoke(IPC_CHANNELS.agentCompleteActivitySnapshot, subscription)
          replaying = false
          for (const event of queued.splice(0)) listener(event)
        },
        unsubscribe: () => {
          disposed = true
          ipcRenderer.removeListener(IPC_CHANNELS.agentActivity, handler)
          void ipcRenderer.invoke(IPC_CHANNELS.agentUnsubscribeActivity, subscription)
        }
      }
    } catch (err) {
      ipcRenderer.removeListener(IPC_CHANNELS.agentActivity, handler)
      void ipcRenderer.invoke(IPC_CHANNELS.agentUnsubscribeActivity, subscription)
      throw err
    }
  },
  async approveProposal(input) {
    return approveMutationProposalResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.agentProposalApprove,
        approveMutationProposalInputSchema.parse(input)
      )
    )
  },
  async rejectProposal(input) {
    return mutationProposalActionResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.agentProposalReject,
        rejectMutationProposalInputSchema.parse(input)
      )
    )
  },
  async undoProposal(input) {
    return mutationProposalActionResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.agentProposalUndo,
        undoMutationProposalInputSchema.parse(input)
      )
    )
  },
  async decideChangeSet(input) {
    return changeSetBatchResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.agentChangeSetBatch,
        changeSetBatchInputSchema.parse(input)
      )
    )
  },
  async cancelImageGeneration(input) {
    return cancelImageGenerationResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.agentCancelImageGeneration,
        cancelImageGenerationInputSchema.parse(input)
      )
    )
  },
  async subscribeSectionChanged(input, listener) {
    const subscription = mutationSubscriptionInputSchema.parse({
      ...input,
      subscriptionId: globalThis.crypto.randomUUID()
    })
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const changed = mutationProposalChangedSchema.parse(value)
      if (
        changed.projectSessionId === subscription.projectSessionId &&
        changed.sectionChanged !== null
      ) {
        listener(changed.sectionChanged)
      }
    }
    ipcRenderer.on(IPC_CHANNELS.agentMutationChanged, handler)
    try {
      await ipcRenderer.invoke(IPC_CHANNELS.agentSubscribeMutations, subscription)
    } catch (err) {
      ipcRenderer.removeListener(IPC_CHANNELS.agentMutationChanged, handler)
      throw err
    }
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.agentMutationChanged, handler)
      void ipcRenderer.invoke(IPC_CHANNELS.agentUnsubscribeMutations, subscription)
    }
  },
  async subscribeMutations(input, listener) {
    const subscription = mutationSubscriptionInputSchema.parse({
      ...input,
      subscriptionId: globalThis.crypto.randomUUID()
    })
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const changed = mutationProposalChangedSchema.parse(value)
      if (changed.projectSessionId === subscription.projectSessionId) listener(changed)
    }
    ipcRenderer.on(IPC_CHANNELS.agentMutationChanged, handler)
    try {
      await ipcRenderer.invoke(IPC_CHANNELS.agentSubscribeMutations, subscription)
    } catch (err) {
      ipcRenderer.removeListener(IPC_CHANNELS.agentMutationChanged, handler)
      throw err
    }
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.agentMutationChanged, handler)
      void ipcRenderer.invoke(IPC_CHANNELS.agentUnsubscribeMutations, subscription)
    }
  }
}
