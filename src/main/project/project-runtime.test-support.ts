import { vi } from 'vitest'
import { JobHandlerRegistry } from '../jobs/scheduler/job-handler-registry'
import type { ProjectManagerOptions } from './project-manager'

/** Complete service graph for lifecycle tests that do not execute feature workflows. */
export function createTestKnowledgeRuntime(): ReturnType<
  ProjectManagerOptions['createKnowledgeRuntime']
> {
  return {
    mineruWorkflow: { start: vi.fn(async () => undefined) } as never,
    knowledgeNormalization: {} as never,
    knowledgeMapping: {} as never,
    projectIndex: {
      startInitialization: vi.fn(),
      readiness: vi.fn(() => 'unavailable'),
      requestItemDelete: vi.fn(),
      close: vi.fn(async () => undefined)
    } as never,
    retrieval: {} as never,
    knowledgeChat: { close: vi.fn(async () => undefined) } as never,
    agentSessions: { close: vi.fn(async () => undefined) } as never,
    agentMutations: { cancelAllImageGenerations: vi.fn(async () => undefined) } as never,
    agentChangeSets: {} as never,
    writingTasks: {} as never,
    registry: new JobHandlerRegistry(),
    terminateWorkers: vi.fn(async () => undefined)
  }
}
