import type { ActiveProject, ProjectSessionId } from '../../shared/contracts/projects'
import type { JobStore } from '../jobs/job-store'
import type { KnowledgeImportService } from '../knowledge/knowledge-import-service'
import type { MineruWorkflowService } from '../knowledge/mineru-workflow-service'
import type { KnowledgeNormalizationService } from '../knowledge/knowledge-normalization-service'
import type { KnowledgeMappingService } from '../knowledge/knowledge-mapping-service'
import type { ProjectRuntime } from '../jobs/scheduler/project-runtime'
import type { ManuscriptService } from '../manuscript/manuscript-service'
import type { EditorPersistenceService } from '../manuscript/editor-persistence-service'
import type { ProjectIndexService } from '../search/index-service'
import type { RetrievalService } from '../search/retrieval-service'
import type { ProjectDatabase } from './project-database'
import type { ProjectManifest } from './project-manifest'
import type { ProjectWriteLock } from './project-lock'
import type { ProjectOperationRegistry } from './project-operations'
import type { AgentSessionService } from '../agent/session-service'
import type { MutationProposalService } from '../agent/mutation-service'
import type { ManuscriptAssetService } from '../manuscript/asset-service'
import type { ProjectVersionStore } from './project-version-store'

/** Main-only authority for the currently open project. */
export interface ProjectContext {
  readonly projectRoot: string
  readonly manifest: ProjectManifest
  readonly projectSessionId: ProjectSessionId
  readonly operations?: ProjectOperationRegistry
  readonly displayName: string
  readonly indexRebuildRequired: boolean
  readonly database: ProjectDatabase
  readonly jobs: JobStore
  readonly runtime: ProjectRuntime
  readonly manuscript: ManuscriptService
  readonly editorPersistence: EditorPersistenceService
  readonly manuscriptAssets: ManuscriptAssetService
  readonly knowledgeImports: KnowledgeImportService
  readonly mineruWorkflow: MineruWorkflowService | null
  readonly knowledgeNormalization: KnowledgeNormalizationService | null
  readonly knowledgeMapping?: KnowledgeMappingService | null
  readonly projectIndex: ProjectIndexService | null
  readonly retrieval: RetrievalService | null
  readonly agentSessions: AgentSessionService | null
  readonly agentMutations: MutationProposalService | null
  readonly writeLock: ProjectWriteLock
  readonly versionHistory?: ProjectVersionStore
}

export function toActiveProject(context: ProjectContext): ActiveProject {
  return {
    projectId: context.manifest.projectId,
    projectSessionId: context.projectSessionId,
    displayName: context.displayName,
    indexRebuildRequired: context.indexRebuildRequired
  }
}
