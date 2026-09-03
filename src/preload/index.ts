import { contextBridge } from 'electron'
import type { DesktopApi } from './desktop-api'
import { appApi } from './app-api'
import { skillsApi } from './skills-api'
import { projectsApi } from './projects-api'
import { jobsApi } from './jobs-api'
import { editorApi } from './editor-api'
import { manuscriptApi } from './manuscript-api'
import { writingRulesApi } from './writing-rules-api'
import { agentApi } from './agent-api'
import { knowledgeApi } from './knowledge-api'
import { notebookApi } from './notebook-api'
import { providersApi } from './providers-api'
import { diagnosticsApi } from './diagnostics-api'

export type { DesktopApi } from './desktop-api'

const desktopApi: DesktopApi = {
  app: appApi,
  skills: skillsApi,
  projects: projectsApi,
  jobs: jobsApi,
  editor: editorApi,
  manuscript: manuscriptApi,
  writingRules: writingRulesApi,
  agent: agentApi,
  knowledge: knowledgeApi,
  notebook: notebookApi,
  providers: providersApi,
  diagnostics: diagnosticsApi
}

contextBridge.exposeInMainWorld('desktop', desktopApi)
