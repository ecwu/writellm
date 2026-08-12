import type { WebContents } from 'electron'
import type { Logger } from 'pino'
import {
  agentRendererEventSchema,
  type AgentEventRecord,
  type AgentProjectActivitySnapshot,
  type AgentRendererEvent,
  type AgentSessionRecord
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

interface ProjectActivitySubscription {
  sender: Pick<WebContents, 'id' | 'isDestroyed' | 'send'>
  projectSessionId: string
  subscriptionId: string
  replaying: boolean
  queued: AgentRendererEvent[]
}

export class AgentEventBroker {
  readonly #subscriptions = new Map<string, Subscription>()
  readonly #activitySubscriptions = new Map<string, ProjectActivitySubscription>()

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

  subscribeActivity(input: Omit<ProjectActivitySubscription, 'replaying' | 'queued'>): void {
    const key = subscriptionKey(input.sender.id, input.subscriptionId)
    this.#activitySubscriptions.set(key, { ...input, replaying: true, queued: [] })
    this.log.info(
      {
        event: 'agent.activity_subscription.started',
        subscriptionId: input.subscriptionId
      },
      'Agent project activity snapshot subscription started'
    )
  }

  completeActivitySnapshot(senderId: number, subscriptionId: string): void {
    const key = subscriptionKey(senderId, subscriptionId)
    const subscription = this.#activitySubscriptions.get(key)
    if (subscription === undefined) return
    subscription.replaying = false
    const queued = subscription.queued.splice(0)
    for (const event of queued) {
      if (!this.#sendActivity(key, subscription, event)) break
    }
    this.log.info(
      {
        event: 'agent.activity_subscription.snapshot_completed',
        subscriptionId,
        queuedEvents: queued.length
      },
      'Agent project activity subscription entered live mode'
    )
  }

  unsubscribe(senderId: number, subscriptionId: string): void {
    const key = subscriptionKey(senderId, subscriptionId)
    this.#subscriptions.delete(key)
    this.#activitySubscriptions.delete(key)
  }

  revokeSession(projectSessionId: string): void {
    for (const [key, subscription] of this.#subscriptions) {
      if (subscription.projectSessionId === projectSessionId) this.#subscriptions.delete(key)
    }
    for (const [key, subscription] of this.#activitySubscriptions) {
      if (subscription.projectSessionId === projectSessionId) {
        this.#activitySubscriptions.delete(key)
      }
    }
  }

  clear(): void {
    this.#subscriptions.clear()
    this.#activitySubscriptions.clear()
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

  publishSession(
    projectSessionId: string,
    input: { session: AgentSessionRecord; titleGenerating: boolean }
  ): void {
    this.#publish(agentRendererEventSchema.parse({ kind: 'session', projectSessionId, ...input }))
  }

  publishActivitySnapshot(projectSessionId: string, snapshot: AgentProjectActivitySnapshot): void {
    this.#publish(agentRendererEventSchema.parse({ kind: 'activity', projectSessionId, snapshot }))
  }

  #publish(event: AgentRendererEvent): void {
    for (const [key, subscription] of this.#subscriptions) {
      if (event.kind === 'activity') continue
      const agentSessionId =
        event.kind === 'durable'
          ? event.event.agentSessionId
          : event.kind === 'session'
            ? event.session.agentSessionId
            : event.agentSessionId
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
    for (const [key, subscription] of this.#activitySubscriptions) {
      if (subscription.projectSessionId !== event.projectSessionId) continue
      if (subscription.replaying) {
        if (subscription.queued.length >= MAX_REPLAY_QUEUE_EVENTS) {
          this.#activitySubscriptions.delete(key)
          this.log.error(
            {
              event: 'agent.activity_subscription.queue_exceeded',
              err: new Error('Agent activity snapshot queue exceeded its bound'),
              subscriptionId: subscription.subscriptionId
            },
            'Dropped an Agent activity subscription whose snapshot queue exceeded its bound'
          )
          continue
        }
        subscription.queued.push(event)
      } else {
        this.#sendActivity(key, subscription, event)
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

  #sendActivity(
    key: string,
    subscription: ProjectActivitySubscription,
    event: AgentRendererEvent
  ): boolean {
    if (subscription.sender.isDestroyed()) {
      this.#activitySubscriptions.delete(key)
      return false
    }
    try {
      subscription.sender.send(IPC_CHANNELS.agentActivity, event)
      return true
    } catch (err) {
      this.#activitySubscriptions.delete(key)
      this.log.warn(
        {
          event: 'agent.activity_subscription.send_failed',
          err,
          subscriptionId: subscription.subscriptionId
        },
        'Dropped an Agent activity subscription after renderer delivery failed'
      )
      return false
    }
  }
}

function subscriptionKey(senderId: number, subscriptionId: string): string {
  return `${senderId}:${subscriptionId}`
}
