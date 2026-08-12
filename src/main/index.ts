import {
  app,
  BrowserWindow,
  ipcMain,
  MessageChannelMain,
  safeStorage,
  utilityProcess
} from 'electron'
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth'
import { isAbsolute, join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { registerAppProtocol, registerAppScheme } from './bootstrap/protocol'
import { createShutdownCoordinator } from './bootstrap/shutdown-coordinator'
import { createWindow } from './bootstrap/windows'
import { createProjectDialogTestSelection } from './ipc/project-dialog-test-seam'
import { createKnowledgeDialogTestSelection } from './ipc/knowledge-dialog-test-seam'
import { registerProjectIpc } from './ipc/project-ipc'
import { registerJobIpc } from './ipc/job-ipc'
import { registerEditorIpc } from './ipc/editor-ipc'
import { registerManuscriptIpc } from './ipc/manuscript-ipc'
import { registerAgentMutationIpc } from './ipc/agent-mutation-ipc'
import { registerAgentIpc } from './ipc/agent-ipc'
import { registerKnowledgeIpc } from './ipc/knowledge-ipc'
import { registerProviderIpc } from './ipc/provider-ipc'
import { registerSearchIpc } from './ipc/search-ipc'
import { registerSkillIpc } from './ipc/skill-ipc'
import { registerIpcHandlers } from './ipc/register-handlers'
import { createLoggerSystem } from './observability/logger'
import { withIpcLogging } from './observability/ipc-context'
import { cleanupLogRetention } from './observability/log-retention'
import { registerProcessErrorHandlers } from './observability/process-errors'
import { exportDiagnosticsBundle, registerDiagnosticsIpc } from './observability/diagnostics-ipc'
import { LogCollector } from './observability/log-collector'
import { attachUtilityLogPort, captureUtilityStderr } from './observability/utility-logs'
import { openAppDatabase } from './app-db/connection'
import { quarantineLegacyCoreDatabase } from './app-db/legacy-core'
import { AppSettingsRepository } from './app-db/repositories/app-settings'
import { RecentProjectsRepository } from './app-db/repositories/recent-projects'
import { ProjectManager } from './project/project-manager'
import { CredentialService } from './providers/credential-service'
import { ProviderService } from './providers/provider-service'
import { AgentProviderCatalogService } from './providers/agent-provider-catalog'
import { ProviderProbeClient } from './providers/provider-probe-client'
import { AgentModelClient } from './providers/agent-model-client'
import { AuxiliaryModelClient } from './providers/auxiliary-model-client'
import { ModelExecutionService } from './providers/model-execution-service'
import { AgentSessionService } from './agent/session-service'
import {
  formatHistoryCompactionInput,
  HISTORY_COMPACTION_SYSTEM_PROMPT
} from './agent/prompts/task-prompts'
import { SkillService } from './skills/skill-service'
import { WritingSkillRuntime } from './skills/skill-router'
import { installSkillE2eFixture } from './skills/skill-test-seam'
import { MainAgentReadTools } from './agent/read-tools'
import { MutationProposalService } from './agent/mutation-service'
import { MainAgentTools } from './agent/tools'
import { AgentEventBroker } from './agent/event-broker'
import { MutationEventBroker } from './agent/mutation-event-broker'
import { ModelMetadataClient } from './providers/model-metadata-client'
import { ModelMetadataService } from './providers/model-metadata-service'
import { MineruClient } from './knowledge/mineru-client'
import { MineruWorkflowService, registerMineruHandlers } from './knowledge/mineru-workflow-service'
import { PdfPreviewCapabilities } from './knowledge/pdf-preview-capabilities'
import { ManuscriptAssetCapabilities } from './manuscript/asset-capabilities'
import { JobHandlerRegistry } from './jobs/scheduler/job-handler-registry'
import {
  KnowledgeNormalizationService,
  registerNormalizationHandler
} from './knowledge/knowledge-normalization-service'
import { KnowledgeMappingService } from './knowledge/knowledge-mapping-service'
import { IndexClient } from './search/index-client'
import {
  embeddingContractSha256,
  ProjectIndexService,
  registerIndexHandlers
} from './search/index-service'
import { RetrievalService } from './search/retrieval-service'
import { INDEX_DATABASE_RELATIVE_PATH, resolveProjectPath } from './project/project-paths'
import { getLoadablePath as getSqliteVecLoadablePath } from 'sqlite-vec'
import { PersistentUtilityProcess } from './workers/persistent-utility-process'
import {
  isSilentWindowPresentation,
  resolveWindowPresentation,
  WINDOW_PRESENTATION_ENV,
  type WindowPresentation
} from './bootstrap/window-presentation'

// Pi keeps its Node-only OAuth implementations behind bundler-opaque imports. Register the
// statically bundled implementations before any Provider login can reach those lazy loaders.
registerBunOAuthFlows()
registerAppScheme()

const windowPresentation: WindowPresentation = resolveWindowPresentation(
  process.env[WINDOW_PRESENTATION_ENV]
)

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (isSilentWindowPresentation(windowPresentation)) return
    const existingWindow = BrowserWindow.getAllWindows()[0]
    if (existingWindow === undefined) return
    if (existingWindow.isMinimized()) existingWindow.restore()
    existingWindow.show()
    existingWindow.focus()
  })

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  void app
    .whenReady()
    .then(async () => {
      if (process.platform === 'darwin' && isSilentWindowPresentation(windowPresentation)) {
        app.setActivationPolicy('accessory')
      }

      // Set app user model id for windows
      electronApp.setAppUserModelId('com.ecwu.writellm')

      // Default open or close DevTools by F12 in development
      // and ignore CommandOrControl + R in production.
      // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
      app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
      })

      const developmentUrl = process.env['ELECTRON_RENDERER_URL']
      const e2eLoggerOverrides = resolveE2eLoggerOverrides(windowPresentation)
      const loggerSystem = await createLoggerSystem({
        appVersion: app.getVersion(),
        logDirectory: e2eLoggerOverrides.logDirectory ?? app.getPath('logs'),
        development: is.dev,
        ...(e2eLoggerOverrides.rotationSize === undefined
          ? {}
          : { rotationSize: e2eLoggerOverrides.rotationSize })
      })
      const appLog = loggerSystem.createModuleLogger('app', 'lifecycle')
      const logCollector = new LogCollector((envelope) =>
        loggerSystem.createModuleLogger(
          envelope.subsystem,
          envelope.component,
          envelope.processRole
        )
      )
      let shuttingDown = false
      registerProcessErrorHandlers(app, appLog, () => shuttingDown)

      try {
        await cleanupLogRetention(loggerSystem.logDirectory, {
          activeFileName: loggerSystem.activeFileName,
          maxAgeMs: 14 * 24 * 60 * 60 * 1_000,
          maxTotalBytes: 200 * 1_024 * 1_024
        })
      } catch (err) {
        appLog.warn({ event: 'app.log_retention.failed', err }, 'Failed to clean old logs')
      }

      const appDatabaseLog = loggerSystem.createModuleLogger('db', 'app-database')
      await quarantineLegacyCoreDatabase(app.getPath('userData'), appDatabaseLog)
      const appDatabase = await openAppDatabase({
        path: join(app.getPath('userData'), 'app.sqlite'),
        applicationVersion: app.getVersion(),
        log: appDatabaseLog
      })

      const appSettings = new AppSettingsRepository(
        appDatabase,
        loggerSystem.createModuleLogger('app', 'settings')
      )
      await appSettings.getDefaultAgentApprovalMode()
      const recentProjects = new RecentProjectsRepository(appDatabase)
      const skills = new SkillService(
        appDatabase,
        join(app.getPath('userData'), 'agent-skills'),
        loggerSystem.createModuleLogger('agent', 'skills')
      )
      await skills.initialize()
      await installSkillE2eFixture({ service: skills, windowPresentation, log: appLog })
      const credentialLog = loggerSystem.createModuleLogger('security', 'credentials')
      const credentials = new CredentialService(appDatabase, safeStorage, credentialLog)
      const backgroundWorker = new PersistentUtilityProcess({
        modulePath: join(__dirname, 'background-worker.js'),
        serviceName: 'writellm-background-worker',
        log: loggerSystem.createModuleLogger('worker', 'background'),
        factory: utilityProcess,
        // The E2E harness selects this direct constructor policy at process
        // bootstrap. It is not reachable from environment, project data, IPC,
        // preload, or Renderer state.
        args: app.commandLine.hasSwitch('writellm-e2e-artifact-loopback')
          ? ['--writellm-test-artifact-loopback']
          : [],
        collector: logCollector,
        processRole: 'background-worker',
        subsystem: 'worker',
        component: 'background'
      })
      const providerProbe = new ProviderProbeClient(
        join(__dirname, 'background-worker.js'),
        loggerSystem.createModuleLogger('worker', 'provider-probe'),
        utilityProcess,
        backgroundWorker
      )
      const providers = new ProviderService(
        appDatabase,
        credentials,
        loggerSystem.createModuleLogger('app', 'provider-configuration'),
        providerProbe.probe
      )
      const agentProviderCatalog = new AgentProviderCatalogService(
        appDatabase,
        credentials,
        appSettings,
        loggerSystem.createModuleLogger('app', 'agent-provider-catalog')
      )
      providers.setAgentCatalog(agentProviderCatalog)
      const agentModel = new AgentModelClient(
        join(__dirname, 'agent-worker.js'),
        loggerSystem.createModuleLogger('worker', 'agent-model'),
        utilityProcess,
        logCollector
      )
      const writingSkillRuntime = new WritingSkillRuntime(
        skills,
        loggerSystem.createModuleLogger('agent', 'writing-skill-runtime')
      )
      const auxiliaryModel = new AuxiliaryModelClient(
        join(__dirname, 'background-worker.js'),
        loggerSystem.createModuleLogger('worker', 'auxiliary-model'),
        utilityProcess,
        backgroundWorker
      )
      const modelMetadata = new ModelMetadataService(
        appSettings,
        new ModelMetadataClient(
          backgroundWorker,
          loggerSystem.createModuleLogger('worker', 'model-metadata')
        ),
        loggerSystem.createModuleLogger('agent', 'model-metadata')
      )
      const modelExecution = new ModelExecutionService({
        providers,
        agent: agentModel,
        embeddings: auxiliaryModel,
        reranker: auxiliaryModel,
        images: auxiliaryModel,
        log: loggerSystem.createModuleLogger('embedding', 'execution'),
        modelMetadata
      })
      const mineruClient = new MineruClient(
        join(__dirname, 'background-worker.js'),
        loggerSystem.createModuleLogger('worker', 'mineru'),
        utilityProcess,
        backgroundWorker
      )
      const agentEvents = new AgentEventBroker(
        loggerSystem.createModuleLogger('agent', 'event-broker')
      )
      const mutationEvents = new MutationEventBroker(
        loggerSystem.createModuleLogger('agent', 'mutation-event-broker')
      )
      let flushForAgentMutation = async (
        _projectSessionId: string,
        _affectedSectionIds: readonly string[]
      ): Promise<void> => {
        throw new Error('Agent mutation editor barrier is unavailable')
      }
      let mainWindow: BrowserWindow | null = null
      const projectManager = new ProjectManager({
        applicationVersion: app.getVersion(),
        logger: loggerSystem.createModuleLogger('project', 'manager'),
        recentProjects,
        exportDiagnostics: () =>
          exportDiagnosticsBundle(
            loggerSystem,
            () => mainWindow,
            loggerSystem.createModuleLogger('ipc', 'project-recovery')
          ),
        forbiddenApplicationDirectories: [
          app.getPath('userData'),
          app.getPath('logs'),
          app.getPath('sessionData')
        ],
        createKnowledgeRuntime: ({
          projectRoot,
          filesystem,
          projectId,
          projectSessionId,
          database,
          jobs,
          manuscript,
          editorPersistence,
          manuscriptAssets,
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
              withConfiguredProvider: (operation) =>
                providers.withConfiguredProvider('mineru', operation)
            },
            gateway: mineruClient,
            log
          })
          const registry = new JobHandlerRegistry()
          registerMineruHandlers(registry, mineruWorkflow, () => manuscriptAssets.cleanupOrphans())
          const indexClient = new IndexClient({
            modulePath: join(__dirname, 'index-worker.js'),
            indexPath: resolveProjectPath(projectRoot, INDEX_DATABASE_RELATIVE_PATH),
            extensionPath: app.isPackaged
              ? join(
                  process.resourcesPath,
                  'native',
                  'sqlite-vec',
                  `${process.platform}-${process.arch}`,
                  process.platform === 'win32'
                    ? 'vec0.dll'
                    : process.platform === 'darwin'
                      ? 'vec0.dylib'
                      : 'vec0.so'
                )
              : getSqliteVecLoadablePath(),
            projectId,
            projectSessionId,
            collector: logCollector,
            log: loggerSystem.createModuleLogger('index', 'client')
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
              if (vector === undefined)
                throw new Error('Embedding provider returned no query vector')
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
            log: loggerSystem.createModuleLogger('search', 'retrieval')
          })
          const agentReadTools = new MainAgentReadTools({
            projectSessionId,
            manuscript,
            retrieval,
            isRetrievalAvailable: () => projectIndex.isRetrievalAvailable(),
            log: loggerSystem.createModuleLogger('agent', 'read-tools')
          })
          const agentMutations = new MutationProposalService({
            projectId,
            projectSessionId,
            database,
            manuscript,
            editorPersistence,
            manuscriptAssets,
            modelExecution,
            log: loggerSystem.createModuleLogger('agent', 'mutations'),
            publishChanged: (event) => mutationEvents.publish(event),
            flushForMutation: (affectedSectionIds) =>
              flushForAgentMutation(projectSessionId, affectedSectionIds)
          })
          const agentTools = new MainAgentTools(agentReadTools, agentMutations)
          const agentSessions = new AgentSessionService({
            projectId,
            projectSessionId,
            database,
            providers,
            agentCatalog: agentProviderCatalog,
            runtime: agentModel,
            contextBuilder: agentTools.contextBuilder(),
            skillRouter: writingSkillRuntime,
            tools: agentTools,
            defaultApprovalMode: () => appSettings.currentDefaultAgentApprovalMode(),
            resolveModelLimits: (config, signal) => modelMetadata.resolve(config, signal),
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
                input.modelLimits
              ),
            summarizeHistory: async (input) => {
              const execution = await modelExecution.runAgentWithResolvedProvider(
                database,
                {
                  systemPrompt: HISTORY_COMPACTION_SYSTEM_PROMPT,
                  prompt: formatHistoryCompactionInput(input.sourcePayloadJson),
                  maxOutputTokens: 4_096
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
                () => undefined
              )
              if (execution.result.text.trim().length === 0) {
                throw new Error('Agent compaction returned an empty summary')
              }
              return {
                summary: execution.result.text.trim().slice(0, 32_768),
                modelRequestId: execution.modelRequestId
              }
            },
            log: loggerSystem.createModuleLogger('agent', 'session')
          })
          agentSessions.recoverInterruptedRuns()
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
            agentSessions,
            agentMutations,
            registry,
            terminateWorkers: async () => {
              await agentMutations.cancelAllImageGenerations()
              await agentSessions.close()
              projectIndex.terminate()
            }
          }
        }
      })
      const pdfPreview = new PdfPreviewCapabilities({
        isSessionActive: (projectSessionId) => {
          try {
            projectManager.assertActiveSession(projectSessionId)
            return true
          } catch {
            return false
          }
        },
        developmentUrl,
        log: loggerSystem.createModuleLogger('knowledge', 'pdf-preview')
      })
      const assetPreview = new ManuscriptAssetCapabilities({
        isSessionActive: (projectSessionId) => {
          try {
            projectManager.assertActiveSession(projectSessionId)
            return true
          } catch {
            return false
          }
        },
        log: loggerSystem.createModuleLogger('manuscript', 'asset-preview')
      })

      registerAppProtocol(
        join(__dirname, '../renderer'),
        async (request) => (await assetPreview.handle(request)) ?? pdfPreview.handle(request)
      )
      const ipc = withIpcLogging(ipcMain)
      const unregisterAppIpc = registerIpcHandlers({
        appSettings,
        logger: loggerSystem.createModuleLogger('ipc', 'app'),
        developmentUrl,
        ipc
      })
      const unregisterSkillIpc = registerSkillIpc({
        service: skills,
        logger: loggerSystem.createModuleLogger('ipc', 'skills'),
        developmentUrl,
        ipc
      })
      mainWindow = createWindow(developmentUrl, appLog, windowPresentation)
      const projectIpcLog = loggerSystem.createModuleLogger('ipc', 'project')
      const projectDialogSelection = createProjectDialogTestSelection(projectIpcLog)
      const unregisterProjectIpc = registerProjectIpc({
        manager: projectManager,
        recentProjects,
        appSettings,
        getWindow: () => mainWindow,
        logger: projectIpcLog,
        developmentUrl,
        ipc,
        selectProjectFolderForTest: projectDialogSelection,
        selectSnapshotDestinationForTest: projectDialogSelection,
        selectManuscriptExportDestinationForTest: projectDialogSelection,
        selectRestoreSourceForTest: projectDialogSelection,
        selectRestoreDestinationParentForTest: projectDialogSelection
      })
      const jobIpc = registerJobIpc({
        manager: projectManager,
        logger: loggerSystem.createModuleLogger('ipc', 'jobs'),
        developmentUrl,
        ipc
      })
      const editorIpc = registerEditorIpc({
        manager: projectManager,
        logger: loggerSystem.createModuleLogger('ipc', 'editor'),
        developmentUrl,
        ipc,
        assetCapabilities: assetPreview
      })
      flushForAgentMutation = editorIpc.flushForMutation
      const unregisterManuscriptIpc = registerManuscriptIpc({
        manager: projectManager,
        logger: loggerSystem.createModuleLogger('ipc', 'manuscript'),
        developmentUrl,
        ipc
      })
      const agentMutationIpc = registerAgentMutationIpc({
        manager: projectManager,
        broker: mutationEvents,
        logger: loggerSystem.createModuleLogger('ipc', 'agent-mutations'),
        developmentUrl,
        ipc
      })
      const agentIpc = registerAgentIpc({
        manager: projectManager,
        broker: agentEvents,
        logger: loggerSystem.createModuleLogger('ipc', 'agent'),
        catalog: agentProviderCatalog,
        developmentUrl,
        ipc
      })
      const unregisterKnowledgeIpc = registerKnowledgeIpc({
        manager: projectManager,
        getWindow: () => mainWindow,
        logger: loggerSystem.createModuleLogger('ipc', 'knowledge'),
        developmentUrl,
        ipc,
        selectFilesForTest: createKnowledgeDialogTestSelection(
          loggerSystem.createModuleLogger('ipc', 'knowledge-dialog')
        ),
        pdfPreview
      })
      const unregisterProviderIpc = registerProviderIpc({
        providers,
        logger: loggerSystem.createModuleLogger('ipc', 'providers'),
        developmentUrl,
        ipc
      })
      const unregisterSearchIpc = registerSearchIpc({
        manager: projectManager,
        logger: loggerSystem.createModuleLogger('ipc', 'search'),
        developmentUrl,
        ipc
      })
      projectManager.setCloseParticipants({
        ...editorIpc.closeParticipants,
        stopJobClaims: async (context) => context.knowledgeImports.cancelAll(),
        stopWorkersAndIndex: async (context) => context.projectIndex?.close(),
        revokeSubscriptions: async (projectSessionId) => {
          jobIpc.revokeSession(projectSessionId)
          editorIpc.revokeSession(projectSessionId)
          agentMutationIpc.revokeSession(projectSessionId)
          agentIpc.revokeSession(projectSessionId)
          pdfPreview.revokeSession(projectSessionId)
          assetPreview.revokeSession(projectSessionId)
        }
      })
      projectManager.setSnapshotParticipants({
        finalEditorFlush: editorIpc.snapshotParticipants.finalEditorFlush,
        pauseFilePublishers: async (context) => {
          await context.runtime.park()
        },
        resumeFilePublishers: async (context) => {
          context.runtime.resumeClaims()
        }
      })
      const unregisterDiagnostics = registerDiagnosticsIpc(
        loggerSystem,
        () => mainWindow,
        developmentUrl,
        ipc
      )
      appLog.info(
        { event: 'app.started', electronVersion: process.versions.electron },
        'Application started'
      )

      if (process.env['WRITELLM_LOGGING_FIXTURE'] === '1') {
        const workerLog = loggerSystem.createModuleLogger('worker', 'collector')
        const child = utilityProcess.fork(join(__dirname, 'logging-fixture.js'), [], {
          serviceName: 'writellm-logging-fixture',
          stdio: 'pipe'
        })
        const { port1, port2 } = new MessageChannelMain()
        attachUtilityLogPort(port1, logCollector, workerLog)
        captureUtilityStderr(child, workerLog)
        child.postMessage({ type: 'logging-port' }, [port2])
      }

      app.on('activate', () => {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) {
          mainWindow = createWindow(developmentUrl, appLog, windowPresentation)
        }
      })

      const shutdownCoordinator = createShutdownCoordinator({
        projectManager,
        unregisterProjectIpc: () => {
          unregisterSkillIpc()
          unregisterProviderIpc()
          unregisterSearchIpc()
          unregisterKnowledgeIpc()
          unregisterManuscriptIpc()
          agentMutationIpc.unregister()
          agentIpc.unregister()
          editorIpc.unregister()
          jobIpc.unregister()
          unregisterProjectIpc()
        },
        unregisterAppIpc,
        unregisterDiagnostics,
        closeAppDatabase: () => appDatabase.close(),
        terminateUtilityWorkers: () => {
          agentModel.terminate()
          backgroundWorker.terminate()
        },
        flushLogs: () => loggerSystem.flush(),
        quit: () => app.quit(),
        logger: appLog
      })
      app.on('before-quit', (event) => {
        shuttingDown = true
        shutdownCoordinator.handleBeforeQuit(event)
      })
    })
    .catch((err) => {
      process.stderr.write(
        `WriteLLM failed to initialize: ${err instanceof Error ? err.stack : String(err)}\n`
      )
      app.exit(1)
    })
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

function resolveE2eLoggerOverrides(presentation: WindowPresentation): {
  logDirectory?: string
  rotationSize?: string
} {
  const logDirectory = process.env['WRITELLM_E2E_LOG_DIRECTORY']
  const rotationSize = process.env['WRITELLM_E2E_LOG_ROTATION_SIZE']
  if (logDirectory === undefined && rotationSize === undefined) return {}
  if (!isSilentWindowPresentation(presentation)) {
    throw new Error('E2E logging overrides require silent window presentation')
  }
  if (logDirectory === undefined || !isAbsolute(logDirectory)) {
    throw new Error('WRITELLM_E2E_LOG_DIRECTORY must be an absolute path')
  }
  if (rotationSize !== undefined && rotationSize !== '1k') {
    throw new Error('WRITELLM_E2E_LOG_ROTATION_SIZE must be 1k when configured')
  }
  return { logDirectory, ...(rotationSize === undefined ? {} : { rotationSize }) }
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
