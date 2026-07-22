import type { WebContents } from 'electron'
import type { Logger } from 'pino'
import {
  mutationProposalChangedSchema,
  type MutationProposalChanged
} from '../../shared/contracts/agent-mutations'
import { IPC_CHANNELS } from '../../shared/contracts/channels'

export class MutationEventBroker {
  readonly #subscribers = new Map<string, Map<string, WebContents>>()

  constructor(private readonly log: Pick<Logger, 'warn'>) {}

  subscribe(projectSessionId: string, subscriptionId: string, sender: WebContents): void {
    const leases = this.#subscribers.get(projectSessionId) ?? new Map<string, WebContents>()
    leases.set(subscriptionId, sender)
    this.#subscribers.set(projectSessionId, leases)
  }

  unsubscribe(projectSessionId: string, subscriptionId: string, senderId: number): void {
    const leases = this.#subscribers.get(projectSessionId)
    if (leases?.get(subscriptionId)?.id !== senderId) return
    leases.delete(subscriptionId)
    if (leases.size === 0) this.#subscribers.delete(projectSessionId)
  }

  publish(raw: MutationProposalChanged): void {
    const event = mutationProposalChangedSchema.parse(raw)
    for (const sender of this.#subscribers.get(event.projectSessionId)?.values() ?? []) {
      if (sender.isDestroyed()) continue
      try {
        sender.send(IPC_CHANNELS.agentMutationChanged, event)
      } catch (err) {
        this.log.warn(
          { event: 'agent.mutation.notification_failed', err, proposalId: event.proposalId },
          'Agent mutation notification delivery failed'
        )
      }
    }
  }

  revokeSession(projectSessionId: string): void {
    this.#subscribers.delete(projectSessionId)
  }

  clear(): void {
    this.#subscribers.clear()
  }
}
