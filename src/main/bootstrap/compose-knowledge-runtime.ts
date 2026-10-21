import type { LoggerSystem } from '../observability/logger'
import type { LogCollector } from '../observability/log-collector'
import type { AppSettingsRepository } from '../app-db/repositories/app-settings'
import type { AgentProviderCatalogService } from '../providers/agent-provider-catalog'
import type { ProviderService } from '../providers/provider-service'
import type { AgentModelClient } from '../providers/agent-model-client'
import type { ModelExecutionService } from '../providers/model-execution-service'
import type { MineruClient } from '../knowledge/mineru-client'
import type { WritingSkillRuntime } from '../skills/skill-router'
import type { AgentEventBroker } from '../agent/event-broker'
import type { MutationEventBroker } from '../agent/mutation-event-broker'
import type { KnowledgeChatEventBroker } from '../knowledge/knowledge-chat-event-broker'
import type { ProjectManagerOptions } from '../project/project-manager'
import { AgentAttachmentService } from '../agent/attachment-service'
import { ChangeSetBatchService } from '../agent/change-set-batch-service'
import { MainAgentReadTools } from '../agent/read-tools'
import { MainAgentTools } from '../agent/tools'
import { AgentSessionService } from '../agent/session-service'
import { AgentTraceRepository } from '../agent/trace-repository'
import { ManuscriptCommentService } from '../manuscript/comment-service'
import { MutationProposalService } from '../agent/mutation-service'
import { WritingTaskService } from '../agent/writing-task-service'
import { JobHandlerRegistry } from '../jobs/scheduler/job-handler-registry'
import { KnowledgeMappingService } from '../knowledge/knowledge-mapping-service'
import {
  KnowledgeNormalizationService,
  registerNormalizationHandler
} from '../knowledge/knowledge-normalization-service'
import { MineruWorkflowService, registerMineruHandlers } from '../knowledge/mineru-workflow-service'
import { NotebookRegistry } from '../knowledge/notebook-registry'
import { IndexClient } from '../search/index-client'
import {
  embeddingContractSha256,
  ProjectIndexService,
  registerIndexHandlers
} from '../search/index-service'
import { RetrievalService } from '../search/retrieval-service'
import { INDEX_DATABASE_RELATIVE_PATH, resolveProjectPath } from '../project/project-paths'
import {
  formatHistoryCompactionInput,
  HISTORY_COMPACTION_SYSTEM_PROMPT
} from '../agent/prompts/task-prompts'

type CreateKnowledgeRuntime = ProjectManagerOptions['createKnowledgeRuntime']

export interface ComposeKnowledgeRuntimeDependencies {
  indexWorkerPath: string
  sqliteVecExtensionPath: string
  logCollector: LogCollector
  createLogger: LoggerSystem['createModuleLogger']
  providers: ProviderService
  agentProviderCatalog: AgentProviderCatalogService
  agentModel: AgentModelClient
  writingSkillRuntime: WritingSkillRuntime
  appSettings: AppSettingsRepository
  modelExecution: ModelExecutionService
  mineruClient: MineruClient
  agentEvents: AgentEventBroker
  mutationEvents: MutationEventBroker
  notebookEvents: KnowledgeChatEventBroker
  getFlushForAgentMutation: () => (
    projectSessionId: string,
    affectedSectionIds: readonly string[]
  ) => Promise<void>
}

/**
 * Compose the project-bound Knowledge, Search, Notebook, and Agent services.
 *
 * The returned factory is intentionally pure with respect to process-global
 * lifecycle. ProjectManager still owns each returned runtime and its teardown.
 */
export function composeKnowledgeRuntime(
  dependencies: ComposeKnowledgeRuntimeDependencies
): CreateKnowledgeRuntime {
  const {
    indexWorkerPath,
    sqliteVecExtensionPath,
    logCollector,
    createLogger,
    providers,
    agentProviderCatalog,
    agentModel,
    writingSkillRuntime,
    appSettings,
    modelExecution,
    mineruClient,
    agentEvents,
    mutationEvents,
    notebookEvents,
    getFlushForAgentMutation
  } = dependencies

  return ({
    projectRoot,
    filesystem,
    projectId,
    projectSessionId,
    database,
    jobs,
    manuscript,
    editorPersistence,
    manuscriptAssets,
    knowledgeImports,
    references,
    log
  }) => {
    modelExecution.recoverRunning(database)
    const mineruWorkflow = new MineruWorkflowService({
      projectRoot,
      filesystem,
      projectId,
      database,
      jobs,
      providers: {
        getConfiguredProvider: () => providers.getConfiguredProvider('mineru'),
        withConfiguredProvider: (operation) => providers.withConfiguredProvider('mineru', operation)
      },
      gateway: mineruClient,
      log
    })
    const registry = new JobHandlerRegistry()
    const agentAttachments = new AgentAttachmentService({
      projectRoot,
      database,
      jobs,
      log: createLogger('agent', 'attachments')
    })
    registerMineruHandlers(registry, mineruWorkflow, async () => {
      await manuscriptAssets.cleanupOrphans()
      return await agentAttachments.cleanupOrphans()
    })
    const indexClient = new IndexClient({
      modulePath: indexWorkerPath,
      indexPath: resolveProjectPath(projectRoot, INDEX_DATABASE_RELATIVE_PATH),
      extensionPath: sqliteVecExtensionPath,
      projectId,
      projectSessionId,
      collector: logCollector,
      log: createLogger('index', 'client')
    })
    const projectIndex = new ProjectIndexService({
      projectRoot,
      projectId,
      database,
      jobs,
      client: indexClient,
      getEmbeddingProvider: () => providers.getConfiguredProvider('embedding'),
      embedBatch: (values, correlation, signal) =>
        modelExecution.embedBatch(
          database,
          { values },
          { ...correlation, projectSessionId },
          signal
        ),
      log
    })
    const retrieval = new RetrievalService({
      projectId,
      client: indexClient,
      getEmbeddingProvider: () => providers.getConfiguredProvider('embedding'),
      embedQuery: async (query, expectedContractSha256, operationId, signal) => {
        const result = await modelExecution.embedBatch(
          database,
          { values: [query] },
          { operationId, projectSessionId },
          signal,
          (config) => {
            if (embeddingContractSha256(config) !== expectedContractSha256) {
              throw new Error('Embedding provider changed before query execution')
            }
          }
        )
        const vector = result.embeddings[0]
        if (vector === undefined) throw new Error('Embedding provider returned no query vector')
        return vector
      },
      getRerankProvider: () => providers.getConfiguredProvider('rerank'),
      rerank: (query, documents, topN, operationId, signal) =>
        modelExecution.rerank(
          database,
          { query, documents, topN },
          { operationId, projectSessionId },
          signal
        ),
      log: createLogger('search', 'retrieval')
    })
    const knowledgeChat = new NotebookRegistry({
      projectId,
      projectSessionId,
      database,
      retrieval,
      projectIndex,
      listKnowledgeItems: () => knowledgeImports.list(),
      references,
      agentCatalog: agentProviderCatalog,
      runtime: agentModel,
      log: createLogger('knowledge', 'notebook-chat'),
      publish: (event) => notebookEvents.publish(event)
    })
    const agentReadTools = new MainAgentReadTools({
      projectSessionId,
      manuscript,
      references,
      retrieval,
      isRetrievalAvailable: () => projectIndex.isRetrievalAvailable(),
      log: createLogger('agent', 'read-tools')
    })
    const writingTasks = new WritingTaskService({
      database,
      log: createLogger('agent', 'writing-tasks')
    })
    const agentMutations = new MutationProposalService({
      projectId,
      projectSessionId,
      database,
      manuscript,
      editorPersistence,
      manuscriptAssets,
      modelExecution,
      writingTasks,
      log: createLogger('agent', 'mutations'),
      publishChanged: (event) => mutationEvents.publish(event),
      flushForMutation: (affectedSectionIds) =>
        getFlushForAgentMutation()(projectSessionId, affectedSectionIds)
    })
    const manuscriptComments = new ManuscriptCommentService({
      database,
      manuscript,
      projectSessionId,
      log: createLogger('manuscript', 'comments')
    })
    const agentTools = new MainAgentTools(
      agentReadTools,
      agentMutations,
      writingTasks,
      manuscriptComments
    )
    const agentSessions = new AgentSessionService({
      projectId,
      projectSessionId,
      database,
      agentCatalog: agentProviderCatalog,
      attachments: agentAttachments,
      runtime: agentModel,
      contextBuilder: agentTools.contextBuilder(),
      skillRouter: writingSkillRuntime,
      tools: agentTools,
      writingTasks,
      defaultApprovalMode: () => appSettings.currentDefaultAgentApprovalMode(),
      publishEvent: (event) => agentEvents.publishDurable(projectSessionId, event),
      publishDelta: (event) => agentEvents.publishDelta(projectSessionId, event),
      publishSession: (event) => agentEvents.publishSession(projectSessionId, event),
      publishActivity: (snapshot) =>
        agentEvents.publishActivitySnapshot(projectSessionId, snapshot),
      generateTitle: (input) =>
        agentModel.run(
          input.config,
          input.credential,
          input.request,
          input.signal,
          () => undefined,
          projectSessionId,
          input.modelLimits,
          {
            context: {
              modelRequestId: input.modelRequestId,
              purpose: 'session_title',
              traceId: input.agentRunId,
              spanId: input.modelRequestId,
              agentSessionId: input.agentSessionId,
              agentRunId: input.agentRunId
            },
            capture: (capture) => {
              new AgentTraceRepository(database, createLogger('agent', 'trace')).capture(capture)
            }
          }
        ),
      summarizeHistory: async (input) => {
        const execution = await modelExecution.runAgentWithResolvedProvider(
          database,
          {
            systemPrompt: HISTORY_COMPACTION_SYSTEM_PROMPT,
            prompt: formatHistoryCompactionInput(input.sourcePayloadJson),
            images: input.images,
            maxOutputTokens: input.maxOutputTokens
          },
          {
            operationId: input.compactionId,
            ...(input.agentRunId === null ? {} : { agentRunId: input.agentRunId }),
            projectSessionId
          },
          {
            config: input.config,
            credential: input.credential,
            modelLimits: input.modelLimits
          },
          input.signal,
          () => undefined,
          {
            tracePurpose: 'compaction',
            agentSessionId: input.agentSessionId,
            compactionId: input.compactionId,
            compactionSource: {
              trigger: input.trigger,
              coveredThroughSequence: input.coveredThroughSequence,
              estimatedInputTokens: input.estimatedInputTokens,
              maxOutputTokens: input.maxOutputTokens,
              source: JSON.parse(input.sourcePayloadJson),
              formattedPrompt: formatHistoryCompactionInput(input.sourcePayloadJson)
            }
          }
        )
        if (execution.result.text.trim().length === 0) {
          throw new Error('Agent compaction returned an empty summary')
        }
        return {
          summary: execution.result.text.trim().slice(0, 32_768),
          modelRequestId: execution.modelRequestId
        }
      },
      log: createLogger('agent', 'session')
    })
    agentSessions.recoverInterruptedRuns()
    const agentChangeSets = new ChangeSetBatchService({
      projectSessionId,
      database,
      mutations: agentMutations,
      recordDecision: (input) =>
        agentSessions.recordApprovalDecision({ ...input, continueRequested: false }),
      log: createLogger('agent', 'change-set')
    })
    const knowledgeNormalization = new KnowledgeNormalizationService({
      projectRoot,
      filesystem,
      projectId,
      database,
      log,
      normalizeInUtility: (input, signal) => mineruClient.normalize(input, signal),
      jobs
    })
    const knowledgeMapping = new KnowledgeMappingService({
      projectRoot,
      filesystem,
      database,
      normalization: knowledgeNormalization,
      index: projectIndex,
      log
    })
    registerNormalizationHandler(registry, knowledgeNormalization)
    registerIndexHandlers(registry, projectIndex)
    return {
      mineruWorkflow,
      knowledgeNormalization,
      knowledgeMapping,
      projectIndex,
      retrieval,
      knowledgeChat,
      agentSessions,
      agentMutations,
      agentChangeSets,
      writingTasks,
      registry,
      terminateWorkers: async () => {
        await agentMutations.cancelAllImageGenerations()
        await knowledgeChat.close()
        await agentSessions.close()
        projectIndex.terminate()
      }
    }
  }
}
