import { randomUUID } from 'node:crypto'
import { KnowledgeChatService, type KnowledgeChatServiceOptions } from './knowledge-chat-service'

const MAX_NOTEBOOKS = 10

/** Project-owned collection. Each child owns only one transient conversation. */
export class NotebookRegistry {
  readonly #instances = new Map<string, KnowledgeChatService>()
  readonly #closingInstances = new Set<Promise<void>>()
  #closed = false
  #closing: Promise<void> | null = null

  constructor(private readonly options: Omit<KnowledgeChatServiceOptions, 'notebookId'>) {}

  createInstance(): KnowledgeChatService {
    this.#assertOpen()
    if (this.#instances.size >= MAX_NOTEBOOKS) throw new Error('Up to 10 Notebooks may be open')
    const notebookId = randomUUID()
    const instance = new KnowledgeChatService({ ...this.options, notebookId })
    this.#instances.set(notebookId, instance)
    this.options.log.info(
      {
        event: 'knowledge.notebook.created',
        notebookId,
        projectSessionId: this.options.projectSessionId
      },
      'Notebook instance created'
    )
    return instance
  }

  instance(notebookId: string): KnowledgeChatService {
    this.#assertOpen()
    const instance = this.#instances.get(notebookId)
    if (!instance) throw new Error('Notebook is closed or unavailable')
    return instance
  }

  async destroyInstance(notebookId: string): Promise<void> {
    const instance = this.instance(notebookId)
    this.#instances.delete(notebookId)
    const completion = instance.close()
    this.#closingInstances.add(completion)
    try {
      await completion
    } finally {
      this.#closingInstances.delete(completion)
    }
  }

  close(): Promise<void> {
    if (this.#closing !== null) return this.#closing
    this.#closed = true
    const instances = [...this.#instances.values()]
    this.#instances.clear()
    this.#closing = Promise.all([
      ...this.#closingInstances,
      ...instances.map((instance) => instance.close())
    ]).then(() => undefined)
    return this.#closing
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('Notebook is closed')
  }
}
