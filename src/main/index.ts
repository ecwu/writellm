import { registerAgentAttachmentIpc } from './ipc/agent-attachment-ipc'
import { AgentImageProcessClient } from './agent/image-process-client'
import { ApplicationMenu } from './bootstrap/application-menu'
import { composeKnowledgeRuntime } from './bootstrap/compose-knowledge-runtime'
import { registerWorkbenchIpc } from './ipc/workbench-ipc'
import { autocompleteChangeSchema } from '../shared/contracts/autocomplete'
import { IPC_CHANNELS } from '../shared/contracts/channels'
import { AutocompleteService } from './providers/autocomplete-service'
import { AutocompleteClient } from './providers/autocomplete-client'
import { registerAutocompleteIpc } from './ipc/autocomplete-ipc'
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
import {
  createBibliographyDialogTestSelection,
  createKnowledgeDialogTestSelection
} from './ipc/knowledge-dialog-test-seam'
import { registerProjectIpc } from './ipc/project-ipc'
import { registerJobIpc } from './ipc/job-ipc'
import { registerEditorIpc } from './ipc/editor-ipc'
import { registerManuscriptIpc } from './ipc/manuscript-ipc'
import { registerAgentMutationIpc } from './ipc/agent-mutation-ipc'
import { registerAgentIpc } from './ipc/agent-ipc'
import { registerKnowledgeIpc } from './ipc/knowledge-ipc'
import { registerProviderIpc } from './ipc/provider-ipc'
import { registerSearchIpc } from './ipc/search-ipc'
import { registerNotebookChatIpc } from './ipc/notebook-chat-ipc'
import { registerWritingRulesIpc } from './ipc/writing-rules-ipc'
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
import { PublicationPresetRepository } from './app-db/repositories/publication-presets'
import { ProjectTemplateRepository } from './app-db/repositories/project-templates'
import { RecentProjectsRepository } from './app-db/repositories/recent-projects'
import { BibliographyConnectorRepository } from './app-db/repositories/bibliography-connectors'
import { BibliographyConnectorService } from './references/bibliography-connector-service'
import { CitationFormatterClient } from './references/citation-formatter-client'
import { CitationFormattingService } from './references/citation-formatting-service'
import { ProjectManager, ProjectSessionError } from './project/project-manager'
import { createPdfPublicationRenderer } from './manuscript/pdf-publication'
import { LatexImportClient } from './manuscript/latex-import-client'
import { CredentialService } from './providers/credential-service'
import { ProviderService } from './providers/provider-service'
import { AgentProviderCatalogService } from './providers/agent-provider-catalog'
import { ProviderProbeClient } from './providers/provider-probe-client'
import { AgentModelClient } from './providers/agent-model-client'
import { AuxiliaryModelClient } from './providers/auxiliary-model-client'
import { ModelExecutionService } from './providers/model-execution-service'
import { SkillService } from './skills/skill-service'
import { WritingSkillRuntime } from './skills/skill-router'
import { installSkillE2eFixture } from './skills/skill-test-seam'
import { AgentEventBroker } from './agent/event-broker'
import { MutationEventBroker } from './agent/mutation-event-broker'
import { ModelMetadataClient } from './providers/model-metadata-client'
import { ModelMetadataService } from './providers/model-metadata-service'
import { MineruClient } from './knowledge/mineru-client'
import { PdfPreviewCapabilities } from './knowledge/pdf-preview-capabilities'
import { ManuscriptAssetCapabilities } from './manuscript/asset-capabilities'
import { KnowledgeChatEventBroker } from './knowledge/knowledge-chat-event-broker'
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
      const publicationPresets = new PublicationPresetRepository(
        appDatabase,
        loggerSystem.createModuleLogger('app', 'publication-presets')
      )
      const projectTemplates = new ProjectTemplateRepository(
        appDatabase,
        join(app.getPath('userData'), 'project-templates'),
        loggerSystem.createModuleLogger('app', 'project-templates')
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
      const citationFormatting = new CitationFormattingService({
        client: new CitationFormatterClient(
          backgroundWorker,
          loggerSystem.createModuleLogger('knowledge', 'citation-formatter-client')
        ),
        log: loggerSystem.createModuleLogger('knowledge', 'citation-formatting')
      })
      const latexImport = new LatexImportClient({
        modulePath: join(__dirname, 'background-worker.js'),
        log: loggerSystem.createModuleLogger('worker', 'latex-import'),
        factory: utilityProcess
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
        appSettings,
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
      const notebookEvents = new KnowledgeChatEventBroker(
        loggerSystem.createModuleLogger('knowledge', 'notebook-event-broker')
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
        renderPdfPublication: createPdfPublicationRenderer({
          createWindow: (options) => new BrowserWindow(options)
        }),
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
        createKnowledgeRuntime: composeKnowledgeRuntime({
          indexWorkerPath: join(__dirname, 'index-worker.js'),
          sqliteVecExtensionPath: app.isPackaged
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
          logCollector,
          createLogger: (subsystem, component, processRole) =>
            loggerSystem.createModuleLogger(subsystem, component, processRole),
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
          getFlushForAgentMutation: () => flushForAgentMutation
        })
      })
      const bibliographyConnectors = new BibliographyConnectorService({
        repository: new BibliographyConnectorRepository(appDatabase),
        log: loggerSystem.createModuleLogger('knowledge', 'bibliography-connector'),
        resolveLibrary: (projectId) => projectManager.activeReferenceLibrary(projectId),
        resolveKnowledgeImports: (projectId) => projectManager.activeKnowledgeImports(projectId)
      })
      const pdfPreview = new PdfPreviewCapabilities({
        isSessionActive: (projectSessionId) => projectManager.isSessionActive(projectSessionId),
        developmentUrl,
        log: loggerSystem.createModuleLogger('knowledge', 'pdf-preview')
      })
      const assetPreview = new ManuscriptAssetCapabilities({
        isSessionActive: (projectSessionId) => projectManager.isSessionActive(projectSessionId),
        log: loggerSystem.createModuleLogger('manuscript', 'asset-preview')
      })

      registerAppProtocol(
        join(__dirname, '../renderer'),
        async (request) => (await assetPreview.handle(request)) ?? pdfPreview.handle(request)
      )
      const ipc = withIpcLogging(ipcMain, loggerSystem.createModuleLogger('ipc', 'operations'), {
        isExpectedRejection: (err) => err instanceof ProjectSessionError
      })
      const unregisterAppIpc = registerIpcHandlers({
        projectManager,
        appSettings,
        publicationPresets,
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
      const nativeMenu =
        process.platform === 'darwin'
          ? new ApplicationMenu({
              ipc,
              logger: loggerSystem.createModuleLogger('app', 'application-menu'),
              developmentUrl,
              snapshot: () => projectManager.snapshot(),
              createWindow: () => {
                mainWindow = createWindow(developmentUrl, appLog, windowPresentation)
                return mainWindow
              }
            })
          : null
      mainWindow = createWindow(developmentUrl, appLog, windowPresentation)
      nativeMenu?.attach(mainWindow)
      const projectIpcLog = loggerSystem.createModuleLogger('ipc', 'project')
      const projectDialogSelection = createProjectDialogTestSelection(projectIpcLog)
      const unregisterProjectIpc = registerProjectIpc({
        manager: projectManager,
        recentProjects,
        appSettings,
        publicationPresets,
        projectTemplates,
        getWindow: () => mainWindow,
        logger: projectIpcLog,
        developmentUrl,
        ipc,
        selectProjectFolderForTest: projectDialogSelection,
        selectSnapshotDestinationForTest: projectDialogSelection,
        selectManuscriptExportDestinationForTest: projectDialogSelection,
        selectRestoreSourceForTest: projectDialogSelection,
        selectRestoreDestinationParentForTest: projectDialogSelection,
        selectCloneDestinationForTest: projectDialogSelection
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
        assetCapabilities: assetPreview,
        getWindow: () => mainWindow,
        selectImportSourceForTest: projectDialogSelection,
        parseLatex: (input) => latexImport.parse(input)
      })
      flushForAgentMutation = editorIpc.flushForMutation
      const unregisterManuscriptIpc = registerManuscriptIpc({
        manager: projectManager,
        publicationPresets,
        citationFormatting,
        logger: loggerSystem.createModuleLogger('ipc', 'manuscript'),
        developmentUrl,
        ipc,
        flushForMutation: editorIpc.flushForMutation
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
        imageCatalog: providers,
        developmentUrl,
        ipc
      })
      const agentAttachmentIpc = registerAgentAttachmentIpc({
        manager: projectManager,
        processor: new AgentImageProcessClient(backgroundWorker),
        previews: assetPreview,
        log: loggerSystem.createModuleLogger('ipc', 'agent-attachments'),
        developmentUrl,
        ipc
      })
      const writingRulesIpc = registerWritingRulesIpc({
        manager: projectManager,
        logger: loggerSystem.createModuleLogger('ipc', 'writing-rules'),
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
        pdfPreview,
        bibliographyConnectors,
        selectBibliographyForTest: createBibliographyDialogTestSelection(
          loggerSystem.createModuleLogger('ipc', 'bibliography-dialog')
        ),
        citationFormatting
      })
      const autocomplete = new AutocompleteService({
        settings: appSettings,
        credential: () => agentProviderCatalog.autocompleteCredential(),
        gateway: new AutocompleteClient(backgroundWorker),
        assertSection: (sessionId, sectionId) => {
          projectManager.assertMutationSession(sessionId).manuscript.getSection(sectionId)
        },
        log: loggerSystem.createModuleLogger('llm', 'autocomplete'),
        changed: (change) => {
          if (mainWindow && !mainWindow.isDestroyed())
            mainWindow.webContents.send(
              IPC_CHANNELS.autocompleteChanged,
              autocompleteChangeSchema.parse(change)
            )
        }
      })
      const autocompleteIpc = registerAutocompleteIpc({
        service: autocomplete,
        manager: projectManager,
        developmentUrl,
        ipc
      })
      const unregisterProviderIpc = registerProviderIpc({
        onConfigurationChanged: () => autocomplete.configurationChanged(),
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
      const workbenchIpc = registerWorkbenchIpc({
        authorizeLayoutFlush: editorIpc.authorizeLayoutFlush,
        manager: projectManager,
        settings: appSettings,
        log: loggerSystem.createModuleLogger('app', 'workbench'),
        developmentUrl
      })
      const notebookIpc = registerNotebookChatIpc({
        manager: projectManager,
        broker: notebookEvents,
        logger: loggerSystem.createModuleLogger('ipc', 'notebook-chat'),
        developmentUrl,
        ipc
      })
      projectManager.setCloseParticipants({
        ...editorIpc.closeParticipants,
        stopJobClaims: async (context) => context.knowledgeImports.cancelAll(),
        stopWorkersAndIndex: async (context) => {
          await agentAttachmentIpc.revokeSession(context.projectSessionId)
          await context.knowledgeChat.close()
          await context.projectIndex.close()
        },
        revokeSubscriptions: async (projectSessionId) => {
          jobIpc.revokeSession(projectSessionId)
          autocompleteIpc.revokeSession(projectSessionId)
          editorIpc.revokeSession(projectSessionId)
          unregisterManuscriptIpc.revokeSession(projectSessionId)
          agentMutationIpc.revokeSession(projectSessionId)
          agentIpc.revokeSession(projectSessionId)
          await agentAttachmentIpc.revokeSession(projectSessionId)
          notebookIpc.revokeSession(projectSessionId)
          pdfPreview.revokeSession(projectSessionId)
          assetPreview.revokeSession(projectSessionId)
        }
      })
      projectManager.setSnapshotParticipants({
        finalEditorFlush: editorIpc.snapshotParticipants.finalEditorFlush,
        pauseFilePublishers: async (context) => {
          await context.runtime.park()
          await agentAttachmentIpc.drainSession(context.projectSessionId)
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
          nativeMenu?.attach(mainWindow)
        }
      })

      const shutdownCoordinator = createShutdownCoordinator({
        projectManager,
        closeWindows: () => {
          for (const window of BrowserWindow.getAllWindows()) window.destroy()
        },
        unregisterProjectIpc: () => {
          nativeMenu?.dispose()
          unregisterSkillIpc()
          autocompleteIpc.unregister()
          unregisterProviderIpc()
          unregisterSearchIpc()
          workbenchIpc.unregister()
          notebookIpc.unregister()
          unregisterKnowledgeIpc()
          unregisterManuscriptIpc.unregister()
          agentMutationIpc.unregister()
          agentIpc.unregister()
          agentAttachmentIpc.unregister()
          writingRulesIpc.unregister()
          editorIpc.unregister()
          jobIpc.unregister()
          unregisterProjectIpc()
        },
        unregisterAppIpc,
        unregisterDiagnostics,
        closeAppDatabase: () => appDatabase.close(),
        terminateUtilityWorkers: () => {
          bibliographyConnectors.close()
          citationFormatting.close()
          agentModel.terminate()
          backgroundWorker.terminate()
          latexImport.terminateAll()
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
