import type { WebContents } from 'electron'
import type { Logger } from 'pino'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import { notebookChatEventSchema, type NotebookChatEvent } from '../../shared/contracts/notebook'

interface NotebookSubscription {
  sender: Pick<WebContents, 'id' | 'isDestroyed' | 'send'>
  projectSessionId: string
}

export class KnowledgeChatEventBroker {
  readonly #subscriptions = new Map<string, NotebookSubscription>()

  constructor(private readonly log: Pick<Logger, 'info' | 'warn'>) {}

  subscribe(sender: NotebookSubscription['sender'], projectSessionId: string): void {
    this.#subscriptions.set(subscriptionKey(sender.id, projectSessionId), {
      sender,
      projectSessionId
    })
    this.log.info(
      {
        event: 'knowledge.notebook.subscription_started',
        projectSessionId,
        senderId: sender.id
      },
      'Notebook subscription started'
    )
  }

  unsubscribe(senderId: number, projectSessionId: string): void {
    this.#subscriptions.delete(subscriptionKey(senderId, projectSessionId))
  }

  revokeSession(projectSessionId: string): void {
    for (const [key, subscription] of this.#subscriptions) {
      if (subscription.projectSessionId === projectSessionId) this.#subscriptions.delete(key)
    }
  }

  clear(): void {
    this.#subscriptions.clear()
  }

  publish(rawEvent: NotebookChatEvent): void {
    const event = notebookChatEventSchema.parse(rawEvent)
    for (const [key, subscription] of this.#subscriptions) {
      if (subscription.projectSessionId !== event.projectSessionId) continue
      if (subscription.sender.isDestroyed()) {
        this.#subscriptions.delete(key)
        continue
      }
      try {
        subscription.sender.send(IPC_CHANNELS.notebookChatEvent, event)
      } catch (err) {
        this.#subscriptions.delete(key)
        this.log.warn(
          {
            event: 'knowledge.notebook.subscription_send_failed',
            err,
            projectSessionId: event.projectSessionId,
            senderId: subscription.sender.id
          },
          'Dropped a Notebook subscription after renderer delivery failed'
        )
      }
    }
  }
}

function subscriptionKey(senderId: number, projectSessionId: string): string {
  return `${senderId}:${projectSessionId}`
}
