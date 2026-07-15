import type { JobRecord } from '../job-store'
import type { JobProgress, JobType } from '../job-schemas'

export type JobResource = 'mineru' | 'embedding' | 'rerank' | 'index' | 'local-io'
export type JobClosePolicy = 'finish' | 'abort-and-requeue' | 'recover-by-lease-expiry'

export interface JobHandlerContext {
  readonly job: JobRecord
  readonly signal: AbortSignal
  reportProgress(progress: JobProgress): void
}

export type JobHandler = (context: JobHandlerContext) => Promise<void>

export interface JobHandlerDefinition {
  readonly resource: JobResource
  readonly concurrency: number
  readonly timeoutMs: number
  readonly leaseMs: number
  readonly heartbeatMs: number
  readonly closePolicy: JobClosePolicy
  readonly handler: JobHandler
}

const resourceConcurrency: Readonly<Record<JobResource, number>> = {
  mineru: 1,
  embedding: 3,
  rerank: 3,
  index: 1,
  'local-io': 2
}

const resourceByType: Readonly<Record<JobType, JobResource>> = {
  'mineru.submit': 'mineru',
  'mineru.poll': 'mineru',
  'mineru.download': 'mineru',
  'embedding.batch': 'embedding',
  'rerank.request': 'rerank',
  'index.build': 'index',
  'index.publish': 'index',
  'index.rebuild': 'index',
  'import.validate': 'local-io'
}

const closePolicyByType: Readonly<Record<JobType, JobClosePolicy>> = {
  'mineru.submit': 'finish',
  'mineru.poll': 'abort-and-requeue',
  'mineru.download': 'abort-and-requeue',
  'embedding.batch': 'abort-and-requeue',
  'rerank.request': 'abort-and-requeue',
  'index.build': 'abort-and-requeue',
  'index.publish': 'finish',
  'index.rebuild': 'abort-and-requeue',
  'import.validate': 'abort-and-requeue'
}

export class JobHandlerRegistry {
  readonly #definitions = new Map<JobType, JobHandlerDefinition>()

  register(
    type: JobType,
    handler: JobHandler,
    options: Partial<Omit<JobHandlerDefinition, 'resource' | 'concurrency' | 'handler'>> = {}
  ): void {
    const resource = resourceByType[type]
    this.#definitions.set(type, {
      resource,
      concurrency: resourceConcurrency[resource],
      timeoutMs: options.timeoutMs ?? 60_000,
      leaseMs: options.leaseMs ?? 30_000,
      heartbeatMs: options.heartbeatMs ?? 10_000,
      closePolicy: options.closePolicy ?? closePolicyByType[type],
      handler
    })
  }

  require(type: JobType): JobHandlerDefinition {
    const definition = this.#definitions.get(type)
    if (definition === undefined) throw new Error(`No job handler is registered for ${type}`)
    return definition
  }

  typesForResource(resource: JobResource): JobType[] {
    return [...this.#definitions]
      .filter(([, definition]) => definition.resource === resource)
      .map(([type]) => type)
  }

  resources(): JobResource[] {
    return [...new Set([...this.#definitions.values()].map(({ resource }) => resource))]
  }
}

export const AUXILIARY_LLM_CONCURRENCY = 2
