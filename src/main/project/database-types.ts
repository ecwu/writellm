export interface ProjectMetaTable {
  singleton_id: number
  project_id: string
  created_at: string
  updated_at: string
}

export interface ManuscriptTable {
  manuscript_id: string
  project_id: string
  is_primary: number
  outline_version: number
  created_at: string
  updated_at: string
}

export interface ManuscriptBriefTable {
  manuscript_brief_id: string
  manuscript_id: string
  version: number
  schema_version: number
  title: string
  description: string
  topic: string
  target_audience: string
  language: string
  style_tone: string
  scope_exclusions: string
  target_length: string
  citation_requirements: string
  additional_instructions: string
  extensible_json: string
  created_at: string
  updated_at: string
}

export type SectionStatus = 'planned' | 'drafting' | 'completed'
export type SectionRevisionSource = 'bootstrap' | 'manual' | 'import' | 'agent' | 'undo'

export interface SectionTable {
  section_id: string
  manuscript_id: string
  parent_section_id: string | null
  position: number
  level: number
  title: string
  objective: string | null
  status: SectionStatus
  current_revision_id: string
  created_at: string
  updated_at: string
}

export interface SectionRevisionTable {
  section_revision_id: string
  section_id: string
  revision_number: number
  source: SectionRevisionSource
  content_json: string
  content_schema_version: number
  content_hash: string
  prior_revision_id: string | null
  word_count: number
  character_count: number
  count_algorithm_version: number
  agent_run_id: string | null
  agent_tool_call_id: string | null
  agent_proposal_id: string | null
  created_at: string
  content_body_retained: Generated<number>
}

export interface SectionMaterializationTable {
  section_id: string
  section_revision_id: string
  content_hash: string
  relative_path: string
  file_sha256: string
  byte_size: number
  envelope_schema_version: number
  materialized_at: string
}

export interface SchemaManifestTable {
  id: number
  application_version: string
  schema_version: number
  updated_at: string
}

export interface SchemaMigrationTable {
  version: number
  name: string
  checksum: string
  applied_at: string
}

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'paused'

export interface JobTable {
  job_id: string
  type: string
  payload_json: string
  state: JobState
  priority: number
  attempts: number
  max_attempts: number
  run_after: string
  lease_owner: string | null
  lease_token: string | null
  locked_until: string | null
  heartbeat_at: string | null
  progress_json: string | null
  deduplication_key: string | null
  cancellation_requested: number
  error_json: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  completed_at: string | null
  resume_same_attempt: number
}

export interface JobTransitionTable {
  sequence: number
  job_id: string
  from_state: JobState | null
  to_state: JobState
  event: string
  attempt: number
  worker_id: string | null
  error_code: string | null
  occurred_at: string
}

export interface ProjectDatabaseSchema {
  project_meta: ProjectMetaTable
  manuscripts: ManuscriptTable
  manuscript_briefs: ManuscriptBriefTable
  sections: SectionTable
  section_revisions: SectionRevisionTable
  section_materializations: SectionMaterializationTable
  jobs: JobTable
  job_transitions: JobTransitionTable
  schema_manifest: SchemaManifestTable
  schema_migrations: SchemaMigrationTable
}
import type { Generated } from 'kysely'
