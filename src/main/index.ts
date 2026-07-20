import {
  app,
  BrowserWindow,
  ipcMain,
  MessageChannelMain,
  safeStorage,
  utilityProcess
} from 'electron'
import { join } from 'node:path'
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
import { registerKnowledgeIpc } from './ipc/knowledge-ipc'
import { registerProviderIpc } from './ipc/provider-ipc'
import { registerSearchIpc } from './ipc/search-ipc'
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
import { ProviderProbeClient } from './providers/provider-probe-client'
import { AgentModelClient } from './providers/agent-model-client'
import { AuxiliaryModelClient } from './providers/auxiliary-model-client'
import { ModelExecutionService } from './providers/model-execution-service'
import { MineruClient } from './knowledge/mineru-client'
import { MineruWorkflowService, registerMineruHandlers } from './knowledge/mineru-workflow-service'
import { PdfPreviewCapabilities } from './knowledge/pdf-preview-capabilities'
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

registerAppScheme()

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
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
      // Set app user model id for windows
      electronApp.setAppUserModelId('com.electron')

      // Default open or close DevTools by F12 in development
      // and ignore CommandOrControl + R in production.
      // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
      app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
      })

      const developmentUrl = process.env['ELECTRON_RENDERER_URL']
      const loggerSystem = await createLoggerSystem({
        appVersion: app.getVersion(),
        logDirectory: app.getPath('logs'),
        development: is.dev
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
      const recentProjects = new RecentProjectsRepository(appDatabase)
      const credentialLog = loggerSystem.createModuleLogger('security', 'credentials')
      const credentials = new CredentialService(appDatabase, safeStorage, credentialLog)
      const backgroundWorker = new PersistentUtilityProcess({
        modulePath: join(__dirname, 'background-worker.js'),
        serviceName: 'writellm-background-worker',
        log: loggerSystem.createModuleLogger('worker', 'background'),
        factory: utilityProcess,
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
      const agentModel = new AgentModelClient(
        join(__dirname, 'agent-worker.js'),
        loggerSystem.createModuleLogger('worker', 'agent-model'),
        utilityProcess,
        logCollector
      )
      const auxiliaryModel = new AuxiliaryModelClient(
        join(__dirname, 'background-worker.js'),
        loggerSystem.createModuleLogger('worker', 'auxiliary-model'),
        utilityProcess,
        backgroundWorker
      )
      const modelExecution = new ModelExecutionService({
        providers,
        agent: agentModel,
        embeddings: auxiliaryModel,
        reranker: auxiliaryModel,
        log: loggerSystem.createModuleLogger('embedding', 'execution')
      })
      const mineruClient = new MineruClient(
        join(__dirname, 'background-worker.js'),
        loggerSystem.createModuleLogger('worker', 'mineru'),
        utilityProcess,
        backgroundWorker
      )
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
          projectId,
          projectSessionId,
          database,
          jobs,
          log
        }) => {
          modelExecution.recoverRunning(database)
          const mineruWorkflow = new MineruWorkflowService({
            projectRoot,
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
          registerMineruHandlers(registry, mineruWorkflow)
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
          const knowledgeNormalization = new KnowledgeNormalizationService({
            projectRoot,
            projectId,
            database,
            log,
            normalizeInUtility: (input, signal) => mineruClient.normalize(input, signal),
            jobs
          })
          const knowledgeMapping = new KnowledgeMappingService({
            projectRoot,
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
            registry,
            terminateWorkers: () => {
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

      registerAppProtocol(join(__dirname, '../renderer'), (request) => pdfPreview.handle(request))
      const ipc = withIpcLogging(ipcMain)
      const unregisterAppIpc = registerIpcHandlers({
        appSettings,
        logger: loggerSystem.createModuleLogger('ipc', 'app'),
        developmentUrl,
        ipc
      })
      mainWindow = createWindow(developmentUrl, appLog)
      const projectIpcLog = loggerSystem.createModuleLogger('ipc', 'project')
      const projectDialogSelection = createProjectDialogTestSelection(projectIpcLog)
      const unregisterProjectIpc = registerProjectIpc({
        manager: projectManager,
        recentProjects,
        getWindow: () => mainWindow,
        logger: projectIpcLog,
        developmentUrl,
        ipc,
        selectProjectFolderForTest: projectDialogSelection,
        selectSnapshotDestinationForTest: projectDialogSelection,
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
        ipc
      })
      const unregisterManuscriptIpc = registerManuscriptIpc({
        manager: projectManager,
        logger: loggerSystem.createModuleLogger('ipc', 'manuscript'),
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
          pdfPreview.revokeSession(projectSessionId)
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
          mainWindow = createWindow(developmentUrl, appLog)
        }
      })

      const shutdownCoordinator = createShutdownCoordinator({
        projectManager,
        unregisterProjectIpc: () => {
          unregisterProviderIpc()
          unregisterSearchIpc()
          unregisterKnowledgeIpc()
          unregisterManuscriptIpc()
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

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
