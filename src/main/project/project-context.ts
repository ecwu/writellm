import type { ActiveProject, ProjectSessionId } from '../../shared/contracts/projects'
import type { JobStore } from '../jobs/job-store'
import type { ProjectRuntime } from '../jobs/scheduler/project-runtime'
import type { ManuscriptService } from '../manuscript/manuscript-service'
import type { EditorPersistenceService } from '../manuscript/editor-persistence-service'
import type { ProjectDatabase } from './project-database'
import type { ProjectManifest } from './project-manifest'
import type { ProjectWriteLock } from './project-lock'

/** Main-only authority for the currently open project. */
export interface ProjectContext {
  readonly projectRoot: string
  readonly manifest: ProjectManifest
  readonly projectSessionId: ProjectSessionId
  readonly displayName: string
  readonly indexRebuildRequired: boolean
  readonly database: ProjectDatabase
  readonly jobs: JobStore
  readonly runtime: ProjectRuntime
  readonly manuscript: ManuscriptService
  readonly editorPersistence: EditorPersistenceService
  readonly writeLock: ProjectWriteLock
}

export function toActiveProject(context: ProjectContext): ActiveProject {
  return {
    projectId: context.manifest.projectId,
    projectSessionId: context.projectSessionId,
    displayName: context.displayName,
    indexRebuildRequired: context.indexRebuildRequired
  }
}
