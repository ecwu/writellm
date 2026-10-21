import type { ApplicationMenuApi } from '../shared/contracts/application-menu'
import type { WorkbenchApi } from '../shared/contracts/workbench'
import type { AutocompleteApi } from '../shared/contracts/autocomplete'
import type { AppIpcApi } from '../shared/contracts/ipc-endpoints'
import type { AgentIpcApi } from '../shared/contracts/ipc-endpoints-agent'
import type { EditorIpcApi } from '../shared/contracts/ipc-endpoints-editor'
import type { KnowledgeIpcApi } from '../shared/contracts/ipc-endpoints-knowledge'
import type { ManuscriptIpcApi } from '../shared/contracts/ipc-endpoints-manuscript'
import type { ProjectIpcApi } from '../shared/contracts/ipc-endpoints-project'
import type {
  InspectGithubSkillInput,
  InspectGithubSkillResult,
  InstallSkillInput,
  SetSkillEnabledInput,
  SkillsSnapshot,
  SkillUpdateResult,
  UninstallSkillInput,
  UpdateSkillInput
} from '../shared/contracts/skills'
import type {
  DiagnosticExportResult,
  DiagnosticsLevelInput,
  DiagnosticsSnapshot,
  RendererErrorReport
} from '../shared/contracts/diagnostics'
import type { DiagnosticLog } from '../shared/observability/log-schema'
import type {
  JobStatus,
  JobStatusEvent,
  JobStatusInput,
  ListJobsInput,
  ListJobsResult
} from '../shared/contracts/jobs'
import type { UpdateWritingRulesIpcInput } from '../shared/contracts/writing-rules-ipc'
import type { ManuscriptWorkspace } from '../shared/contracts/manuscript'
import type {
  ProviderConnectionTestResult,
  ImageProviderSelectionInput,
  AgentAuthFlowInput,
  AgentAuthInteractionEvent,
  AgentAuthPromptResponse,
  AgentCustomPresetInput,
  AgentManualModelInput,
  AgentManualModelRemoveInput,
  AgentModelEnabledInput,
  AgentModelSelection,
  AgentThinkingLevel,
  AgentPresetInput,
  AgentPresetCredentialInput,
  AgentPresetLoginInput,
  AgentProviderEnabledInput,
  ProviderRoleInput,
  ProviderSaveInput,
  ProviderSettingsSnapshot
} from '../shared/contracts/providers'
import type {
  NotebookChatEvent,
  NotebookChatSnapshot,
  NotebookChatStartTurnResult,
  NotebookSourceScope
} from '../shared/contracts/notebook'
export interface DesktopApi {
  menu: ApplicationMenuApi
  autocomplete: AutocompleteApi
  app: AppIpcApi
  skills: {
    snapshot(): Promise<SkillsSnapshot>
    inspectGithub(input: InspectGithubSkillInput): Promise<InspectGithubSkillResult>
    install(input: InstallSkillInput): Promise<SkillsSnapshot>
    setEnabled(input: SetSkillEnabledInput): Promise<SkillsSnapshot>
    checkUpdate(input: { skillId: string; operationId: string }): Promise<SkillUpdateResult>
    update(input: UpdateSkillInput): Promise<SkillsSnapshot>
    uninstall(input: UninstallSkillInput): Promise<SkillsSnapshot>
    cancelOperation(input: { operationId: string }): Promise<void>
    subscribeChanges(listener: (revision: number) => void): () => void
  }
  projects: ProjectIpcApi
  jobs: {
    list(input: ListJobsInput): Promise<ListJobsResult>
    status(input: JobStatusInput): Promise<JobStatus>
    cancel(input: JobStatusInput): Promise<JobStatus>
    subscribe(
      input: { projectSessionId: string },
      listener: (event: JobStatusEvent) => void
    ): Promise<() => void>
  }
  editor: EditorIpcApi
  manuscript: ManuscriptIpcApi
  writingRules: {
    update(input: UpdateWritingRulesIpcInput): Promise<ManuscriptWorkspace>
  }
  agent: AgentIpcApi
  knowledge: KnowledgeIpcApi
  workbench: WorkbenchApi
  notebook: {
    create(input: { projectSessionId: string }): Promise<NotebookChatSnapshot>
    destroy(input: { projectSessionId: string; notebookId: string }): Promise<void>
    snapshot(input: { projectSessionId: string; notebookId: string }): Promise<NotebookChatSnapshot>
    startTurn(input: {
      projectSessionId: string
      notebookId: string
      content: string
    }): Promise<NotebookChatStartTurnResult>
    stopTurn(input: { projectSessionId: string; notebookId: string }): Promise<NotebookChatSnapshot>
    clear(input: { projectSessionId: string; notebookId: string }): Promise<NotebookChatSnapshot>
    setSources(input: {
      projectSessionId: string
      notebookId: string
      sourceScope: NotebookSourceScope
    }): Promise<NotebookChatSnapshot>
    setModel(input: {
      projectSessionId: string
      notebookId: string
      modelSelection: AgentModelSelection
    }): Promise<NotebookChatSnapshot>
    setThinkingLevel(input: {
      projectSessionId: string
      notebookId: string
      level: AgentThinkingLevel
    }): Promise<NotebookChatSnapshot>
    subscribe(
      input: { projectSessionId: string; notebookId: string },
      listener: (event: NotebookChatEvent) => void
    ): Promise<{ snapshot: NotebookChatSnapshot; unsubscribe: () => void }>
  }
  providers: {
    snapshot(): Promise<ProviderSettingsSnapshot>
    save(input: ProviderSaveInput): Promise<ProviderSettingsSnapshot>
    remove(input: ProviderRoleInput): Promise<ProviderSettingsSnapshot>
    testConnection(input: ProviderRoleInput): Promise<ProviderConnectionTestResult>
    setActiveImage(input: ImageProviderSelectionInput): Promise<ProviderSettingsSnapshot>
    saveAgentPreset(input: AgentCustomPresetInput): Promise<ProviderSettingsSnapshot>
    removeAgentPreset(input: AgentPresetInput): Promise<ProviderSettingsSnapshot>
    refreshAgentPreset(input: AgentPresetInput): Promise<ProviderSettingsSnapshot>
    setAgentDefault(selection: AgentModelSelection | null): Promise<ProviderSettingsSnapshot>
    setAgentCredential(input: AgentPresetCredentialInput): Promise<ProviderSettingsSnapshot>
    clearAgentCredential(input: AgentPresetInput): Promise<ProviderSettingsSnapshot>
    setAgentProviderEnabled(input: AgentProviderEnabledInput): Promise<ProviderSettingsSnapshot>
    setAgentModelEnabled(input: AgentModelEnabledInput): Promise<ProviderSettingsSnapshot>
    saveAgentManualModel(input: AgentManualModelInput): Promise<ProviderSettingsSnapshot>
    removeAgentManualModel(input: AgentManualModelRemoveInput): Promise<ProviderSettingsSnapshot>
    loginAgentPreset(
      input: AgentPresetLoginInput,
      listener: (event: AgentAuthInteractionEvent) => void
    ): Promise<ProviderSettingsSnapshot>
    respondAgentAuth(input: AgentAuthPromptResponse): Promise<void>
    cancelAgentAuth(input: AgentAuthFlowInput): Promise<void>
  }
  diagnostics: {
    snapshot(): Promise<DiagnosticsSnapshot>
    reportRendererError(report: RendererErrorReport): void
    setLevel(input: DiagnosticsLevelInput): Promise<void>
    openLogsDirectory(): Promise<void>
    exportBundle(): Promise<DiagnosticExportResult>
    subscribe(listener: (entry: DiagnosticLog) => void): () => void
  }
}
