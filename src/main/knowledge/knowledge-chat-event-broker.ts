import type { WebContents } from 'electron'
import type { Logger } from 'pino'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import { notebookChatEventSchema, type NotebookChatEvent } from '../../shared/contracts/notebook'

interface NotebookSubscription {
  sender: Pick<WebContents, 'id' | 'isDestroyed' | 'send'>
  projectSessionId: string
  notebookId: string
}

export class KnowledgeChatEventBroker {
  readonly #subscriptions = new Map<string, NotebookSubscription>()

  constructor(private readonly log: Pick<Logger, 'info' | 'warn'>) {}

  subscribe(
    sender: NotebookSubscription['sender'],
    projectSessionId: string,
    notebookId: string
  ): void {
    this.#subscriptions.set(subscriptionKey(sender.id, projectSessionId, notebookId), {
      sender,
      projectSessionId,
      notebookId
    })
    this.log.info(
      {
        event: 'knowledge.notebook.subscription_started',
        projectSessionId,
        notebookId,
        senderId: sender.id
      },
      'Notebook subscription started'
    )
  }

  unsubscribe(senderId: number, projectSessionId: string, notebookId: string): void {
    this.#subscriptions.delete(subscriptionKey(senderId, projectSessionId, notebookId))
  }

  revokeNotebook(projectSessionId: string, notebookId: string): void {
    for (const [key, subscription] of this.#subscriptions) {
      if (
        subscription.projectSessionId === projectSessionId &&
        subscription.notebookId === notebookId
      )
        this.#subscriptions.delete(key)
    }
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
      if (
        subscription.projectSessionId !== event.projectSessionId ||
        subscription.notebookId !== event.notebookId
      )
        continue
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

function subscriptionKey(senderId: number, projectSessionId: string, notebookId: string): string {
  return `${senderId}:${projectSessionId}:${notebookId}`
}
