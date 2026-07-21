import type { WebContents } from 'electron'
import type { Logger } from 'pino'
import {
  agentRendererEventSchema,
  type AgentEventRecord,
  type AgentRendererEvent
} from '../../shared/contracts/agent-ipc'
import { IPC_CHANNELS } from '../../shared/contracts/channels'

const MAX_REPLAY_QUEUE_EVENTS = 1_000

interface Subscription {
  sender: Pick<WebContents, 'id' | 'isDestroyed' | 'send'>
  projectSessionId: string
  agentSessionId: string
  subscriptionId: string
  replaying: boolean
  queued: AgentRendererEvent[]
}

export class AgentEventBroker {
  readonly #subscriptions = new Map<string, Subscription>()

  constructor(private readonly log: Pick<Logger, 'info' | 'warn' | 'error'>) {}

  subscribe(input: Omit<Subscription, 'replaying' | 'queued'>): void {
    const key = subscriptionKey(input.sender.id, input.subscriptionId)
    this.#subscriptions.set(key, { ...input, replaying: true, queued: [] })
    this.log.info(
      {
        event: 'agent.subscription.started',
        agentSessionId: input.agentSessionId,
        subscriptionId: input.subscriptionId
      },
      'Agent event replay subscription started'
    )
  }

  completeReplay(senderId: number, subscriptionId: string): void {
    const key = subscriptionKey(senderId, subscriptionId)
    const subscription = this.#subscriptions.get(key)
    if (subscription === undefined) return
    subscription.replaying = false
    const queued = subscription.queued.splice(0)
    for (const event of queued) {
      if (!this.#send(key, subscription, event)) break
    }
    this.log.info(
      {
        event: 'agent.subscription.replay_completed',
        agentSessionId: subscription.agentSessionId,
        subscriptionId,
        queuedEvents: queued.length
      },
      'Agent event subscription entered live mode'
    )
  }

  unsubscribe(senderId: number, subscriptionId: string): void {
    this.#subscriptions.delete(subscriptionKey(senderId, subscriptionId))
  }

  revokeSession(projectSessionId: string): void {
    for (const [key, subscription] of this.#subscriptions) {
      if (subscription.projectSessionId === projectSessionId) this.#subscriptions.delete(key)
    }
  }

  clear(): void {
    this.#subscriptions.clear()
  }

  publishDurable(projectSessionId: string, event: AgentEventRecord): void {
    this.#publish(agentRendererEventSchema.parse({ kind: 'durable', projectSessionId, event }))
  }

  publishDelta(
    projectSessionId: string,
    input: { agentSessionId: string; agentRunId: string; delta: string }
  ): void {
    this.#publish(agentRendererEventSchema.parse({ kind: 'delta', projectSessionId, ...input }))
  }

  #publish(event: AgentRendererEvent): void {
    for (const [key, subscription] of this.#subscriptions) {
      const agentSessionId =
        event.kind === 'durable' ? event.event.agentSessionId : event.agentSessionId
      if (
        subscription.projectSessionId !== event.projectSessionId ||
        subscription.agentSessionId !== agentSessionId
      ) {
        continue
      }
      if (subscription.replaying) {
        if (subscription.queued.length >= MAX_REPLAY_QUEUE_EVENTS) {
          this.#subscriptions.delete(key)
          this.log.error(
            {
              event: 'agent.subscription.replay_queue_exceeded',
              err: new Error('Agent replay queue exceeded its bound'),
              agentSessionId,
              subscriptionId: subscription.subscriptionId
            },
            'Dropped an Agent subscription whose replay queue exceeded its bound'
          )
          continue
        }
        subscription.queued.push(event)
      } else {
        this.#send(key, subscription, event)
      }
    }
  }

  #send(key: string, subscription: Subscription, event: AgentRendererEvent): boolean {
    if (subscription.sender.isDestroyed()) {
      this.#subscriptions.delete(key)
      return false
    }
    try {
      subscription.sender.send(IPC_CHANNELS.agentEvent, event)
      return true
    } catch (err) {
      this.#subscriptions.delete(key)
      this.log.warn(
        {
          event: 'agent.subscription.send_failed',
          err,
          agentSessionId: subscription.agentSessionId,
          subscriptionId: subscription.subscriptionId
        },
        'Dropped an Agent event subscription after renderer delivery failed'
      )
      return false
    }
  }
}

function subscriptionKey(senderId: number, subscriptionId: string): string {
  return `${senderId}:${subscriptionId}`
}
