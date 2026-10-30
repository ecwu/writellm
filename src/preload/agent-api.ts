import { ipcRenderer } from 'electron'
import {
  agentActivityDeliverySchema,
  agentEventPageInputSchema,
  agentEventPageSchema,
  agentProjectActivitySnapshotSchema,
  agentProjectActivitySubscriptionInputSchema,
  agentRendererEventSchema,
  agentSubscriptionInputSchema,
  type AgentRendererEvent
} from '../shared/contracts/agent-ipc'
import { IPC_CHANNELS } from '../shared/contracts/channels'
import {
  mutationProposalChangedSchema,
  mutationSubscriptionInputSchema
} from '../shared/contracts/agent-mutations'
import { agentIpcEndpoints } from '../shared/contracts/ipc-endpoints-agent'
import type { DesktopApi } from './desktop-api'
import { invokeIpcEndpoint } from './ipc-endpoint'

export const agentApi: DesktopApi['agent'] = {
  async importImage(input) {
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.importImage, input)
  },
  async selectImages(input) {
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.selectImages, input)
  },
  async pasteImage(input) {
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.pasteImage, input)
  },
  async getImage(input) {
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.getImage, input)
  },
  async releaseImage(input) {
    await invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.releaseImage, input)
  },
  async listSessions(input) {
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.listSessions, input)
  },
  async getSession(input) {
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.getSession, input)
  },
  async forkConversation(input) {
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.forkConversation, input)
  },
  async createSession(input) {
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.createSession, input)
  },
  async generateSessionTitle(input) {
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.generateSessionTitle, input)
  },
  async archiveSession(input) {
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.archiveSession, input)
  },
  async restoreSession(input) {
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.restoreSession, input)
  },
  async setApprovalMode(input) {
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.setApprovalMode, input)
  },
  async setInteractionMode(input) {
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.setInteractionMode, input)
  },
  async setModelSelection(input) {
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.setModelSelection, input)
  },
  async setImageModelSelection(input) {
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.setImageModelSelection, input)
  },
  async setThinkingLevel(input) {
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.setThinkingLevel, input)
  },
  async updateWritingTask(input) {
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.updateWritingTask, input)
  },
  async listEvents(input) {
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.listEvents, input)
  },
  async listRuns(input) {
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.listRuns, input)
  },
  async listProposals(input) {
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.listProposals, input)
  },
  async editLastMessageAndRestart(input) {
    return (
      await invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.editLastMessageAndRestart, input)
    ).run
  },
  async startRun(input) {
    return (await invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.startRun, input)).run
  },
  async steerRun(input) {
    await invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.steerRun, input)
  },
  async followUpRun(input) {
    await invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.followUpRun, input)
  },
  async steerPendingFollowUp(input) {
    await invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.steerPendingFollowUp, input)
  },
  async deletePendingFollowUp(input) {
    await invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.deletePendingFollowUp, input)
  },
  async abortRun(input) {
    await invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.abortRun, input)
  },
  async answerUserQuestion(input) {
    await invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.answerUserQuestion, input)
  },
  async compactSession(input) {
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.compactSession, input)
  },
  async stopCompaction(input) {
    await invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.stopCompaction, input)
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
      const delivery = agentActivityDeliverySchema.parse(value)
      if (delivery.subscriptionId !== subscription.subscriptionId) return
      const parsed = delivery.event
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
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.approveProposal, input)
  },
  async rejectProposal(input) {
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.rejectProposal, input)
  },
  async undoProposal(input) {
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.undoProposal, input)
  },
  async decideChangeSet(input) {
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.decideChangeSet, input)
  },
  async cancelImageGeneration(input) {
    return invokeIpcEndpoint(ipcRenderer, agentIpcEndpoints.cancelImageGeneration, input)
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
