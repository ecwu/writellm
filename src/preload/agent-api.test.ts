import { beforeEach, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { AgentEventBroker } from '../main/agent/event-broker'
import { MutationEventBroker } from '../main/agent/mutation-event-broker'
import type { MutationProposalChanged } from '../shared/contracts/agent-mutations'
import { IPC_CHANNELS } from '../shared/contracts/channels'
import { agentApi } from './agent-api'

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(),
  handlers: new Map<string, Set<(...args: unknown[]) => void>>()
}))
vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: ipc.invoke,
    on(channel: string, handler: (...args: unknown[]) => void) {
      const handlers = ipc.handlers.get(channel) ?? new Set()
      handlers.add(handler)
      ipc.handlers.set(channel, handlers)
    },
    removeListener(channel: string, handler: (...args: unknown[]) => void) {
      ipc.handlers.get(channel)?.delete(handler)
    }
  }
}))

beforeEach(() => {
  ipc.handlers.clear()
  ipc.invoke.mockReset()
})

it('isolates simultaneous activity subscribers during snapshot activation and live delivery', async () => {
  const broker = new AgentEventBroker({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
  const projectSessionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc422'
  const sender = {
    id: 7,
    isDestroyed: () => false,
    send(channel: string, value: unknown) {
      for (const handler of ipc.handlers.get(channel) ?? []) handler({}, value)
    }
  }
  ipc.invoke.mockImplementation(async (channel, input) => {
    if (channel === IPC_CHANNELS.agentSubscribeActivity) {
      broker.subscribeActivity({ sender, ...input })
      return { activeCount: 0, runs: [], compactions: [] }
    }
    if (channel === IPC_CHANNELS.agentCompleteActivitySnapshot) {
      broker.completeActivitySnapshot(sender.id, input.subscriptionId)
    }
    if (channel === IPC_CHANNELS.agentUnsubscribeActivity) {
      broker.unsubscribe(sender.id, input.subscriptionId)
    }
    return {}
  })
  const status = vi.fn()
  const panel = vi.fn()
  const first = await agentApi.subscribeActivity({ projectSessionId }, status)
  const second = await agentApi.subscribeActivity({ projectSessionId }, panel)
  await first.activate()
  const delta = {
    agentSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc423',
    agentRunId: '019c6a5c-8d34-7a8e-a602-3d37a52dc424',
    delta: 'Partial answer'
  }
  broker.publishDelta(projectSessionId, delta)
  expect(status).toHaveBeenCalledExactlyOnceWith({ kind: 'delta', projectSessionId, ...delta })
  expect(panel).not.toHaveBeenCalled()
  await second.activate()
  expect(status).toHaveBeenCalledTimes(1)
  expect(panel).toHaveBeenCalledExactlyOnceWith({ kind: 'delta', projectSessionId, ...delta })
  broker.publishDelta(projectSessionId, { ...delta, delta: ' continued' })
  expect(status).toHaveBeenCalledTimes(2)
  expect(panel).toHaveBeenCalledTimes(2)
  first.unsubscribe()
  broker.publishDelta(projectSessionId, { ...delta, delta: ' final' })
  expect(status).toHaveBeenCalledTimes(2)
  expect(panel).toHaveBeenCalledTimes(3)
  second.unsubscribe()
})

it('delivers one mutation to each listener when a window has two subscriptions', async () => {
  const broker = new MutationEventBroker({ warn: vi.fn() })
  const projectSessionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc422'
  const proposalId = '019c6a5c-8d34-7a8e-a602-3d37a52dc424'
  const send = vi.fn((channel: string, value: unknown) => {
    for (const handler of ipc.handlers.get(channel) ?? []) handler({}, value)
  })
  const sender = { id: 7, isDestroyed: () => false, send } as unknown as WebContents
  ipc.invoke.mockImplementation(async (channel, input) => {
    if (channel === IPC_CHANNELS.agentSubscribeMutations) {
      broker.subscribe(input.projectSessionId, input.subscriptionId, sender)
    } else if (channel === IPC_CHANNELS.agentUnsubscribeMutations) {
      broker.unsubscribe(input.projectSessionId, input.subscriptionId, sender.id)
    }
  })
  const onMutation = vi.fn()
  const onSecondMutation = vi.fn()
  const releaseMutation = await agentApi.subscribeMutations({ projectSessionId }, onMutation)
  const releaseSecondMutation = await agentApi.subscribeMutations(
    { projectSessionId },
    onSecondMutation
  )
  const event: MutationProposalChanged = {
    projectSessionId,
    agentSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc423',
    proposalId,
    kind: 'section_patch',
    status: 'applied',
    sectionChanged: {
      projectSessionId,
      proposalId,
      sectionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc425',
      sectionRevisionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc426',
      reason: 'applied'
    }
  }
  broker.publish(event)
  expect(send).toHaveBeenCalledOnce()
  expect(onMutation).toHaveBeenCalledExactlyOnceWith(event)
  expect(onSecondMutation).toHaveBeenCalledExactlyOnceWith(event)

  releaseSecondMutation()
  broker.publish(event)
  expect(onMutation).toHaveBeenCalledTimes(2)
  expect(onSecondMutation).toHaveBeenCalledOnce()
  releaseMutation()
  broker.publish(event)
  expect(send).toHaveBeenCalledTimes(2)
})
