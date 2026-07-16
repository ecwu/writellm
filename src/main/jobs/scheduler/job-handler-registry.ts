import type { JobRecord } from '../job-store'
import type { JobProgress, JobType } from '../job-schemas'

export type JobResource = 'mineru' | 'embedding' | 'index' | 'local-io'
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
  index: 1,
  'local-io': 2
}

const resourceByType: Readonly<Record<JobType, JobResource>> = {
  mineru_parse: 'mineru',
  normalize_parse_revision: 'local-io',
  build_index_generation: 'index',
  build_embedding_generation: 'embedding',
  remove_index_item: 'index',
  rebuild_index: 'index',
  artifact_cleanup: 'local-io'
}

const closePolicyByType: Readonly<Record<JobType, JobClosePolicy>> = {
  mineru_parse: 'abort-and-requeue',
  normalize_parse_revision: 'abort-and-requeue',
  build_index_generation: 'abort-and-requeue',
  build_embedding_generation: 'abort-and-requeue',
  remove_index_item: 'abort-and-requeue',
  rebuild_index: 'abort-and-requeue',
  artifact_cleanup: 'abort-and-requeue'
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
