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
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface SectionRevisionTable {
  section_revision_id: string
  section_id: string
  revision_number: number
  source: SectionRevisionSource
  source_class: 'manual_autosave' | 'manual_checkpoint' | 'agent_accepted' | 'import'
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

export interface FileRecordTable {
  file_record_id: string
  sha256: string
  byte_size: number
  mime_type: string
  extension: string
  relative_path: string
  created_at: string
}

export type KnowledgeItemState = 'importing' | 'stored' | 'failed' | 'cancelled'

export interface KnowledgeItemTable {
  knowledge_item_id: string
  file_record_id: string | null
  original_name: string
  display_name: string
  state: KnowledgeItemState
  error_code: string | null
  created_at: string
  updated_at: string
}

export interface ImportTable {
  import_id: string
  knowledge_item_id: string
  state: 'copying' | 'stored' | 'failed' | 'cancelled'
  bytes_copied: number
  cancellation_requested: number
  error_code: string | null
  created_at: string
  updated_at: string
}

export type ModelRequestOperationKind = 'agent' | 'embedding' | 'rerank' | 'image'
export type ModelRequestStatus = 'running' | 'succeeded' | 'failed' | 'aborted'

export interface ModelRequestTable {
  model_request_id: string
  operation_kind: ModelRequestOperationKind
  provider_id: string
  model_id: string
  provider_fingerprint: string
  request_fingerprint: string
  status: ModelRequestStatus
  attempt_count: number
  retry_count: number
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_write_tokens: number | null
  input_items: number
  output_items: number | null
  estimated_cost_usd_micros: number | null
  usage_json: string
  response_ids_json: string
  error_json: string | null
  operation_id: string | null
  job_id: string | null
  agent_run_id: string | null
  thinking_level: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null
  delivery: 'skill_route' | null
  started_at: string
  completed_at: string | null
  duration_ms: number | null
  created_at: string
  updated_at: string
}

export interface AgentSessionTable {
  agent_session_id: string
  title: string
  pi_runtime_version: string
  event_schema_version: number
  status: 'active' | 'archived'
  approval_mode: 'manual' | 'section_auto' | 'yolo'
  provider_preset_id: string | null
  selected_model_id: string | null
  thinking_level: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  skill_mode: 'auto' | 'explicit' | 'none'
  skill_id: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

export interface AgentRunTable {
  agent_run_id: string
  agent_session_id: string
  status: 'running' | 'completed' | 'interrupted' | 'failed'
  provider_id: string
  model_id: string
  provider_preset_id: string | null
  provider_label: string
  model_label: string
  api_id: string
  thinking_level: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  approval_mode: 'manual' | 'section_auto' | 'yolo'
  model_limits_json: string
  provider_fingerprint: string
  model_fingerprint: string
  editor_context_json: string
  error_json: string | null
  skill_snapshot_json: string
  skill_route_model_request_id: string | null
  started_at: string
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface AgentEventTable {
  agent_event_id: string
  agent_session_id: string
  agent_run_id: string | null
  sequence: number
  type:
    | 'user_message'
    | 'assistant_message'
    | 'tool_call'
    | 'tool_result'
    | 'run_interrupted'
    | 'run_completed'
    | 'compaction_summary'
  payload_json: string
  model_request_id: string | null
  created_at: string
}

export interface MutationProposalTable {
  mutation_proposal_id: string
  agent_session_id: string
  agent_run_id: string
  tool_call_event_id: string
  agent_tool_call_id: string
  kind: 'brief_update' | 'outline_patch' | 'section_patch' | 'generated_image_insert'
  payload_json: string
  base_revision_id: string | null
  base_brief_version: number | null
  base_outline_version: number | null
  status:
    | 'pending'
    | 'generating'
    | 'approved'
    | 'rejected'
    | 'applied'
    | 'failed'
    | 'undone'
    | 'superseded'
    | 'conflicted'
    | 'satisfied'
  decision_at: string | null
  applied_revision_id: string | null
  applied_brief_version: number | null
  applied_outline_version: number | null
  undo_revision_id: string | null
  replaces_proposal_id: string | null
  rejected_reason: string | null
  created_at: string
  updated_at: string
}

export interface ManuscriptAssetTable {
  asset_id: string
  sha256: string
  byte_size: number
  mime_type: 'image/png' | 'image/jpeg' | 'image/webp'
  extension: '.png' | '.jpg' | '.webp'
  relative_path: string
  source_type: 'upload' | 'generated'
  original_name: string | null
  generation_request_json: string | null
  model_request_id: string | null
  agent_run_id: string | null
  agent_tool_call_id: string | null
  created_at: string
  last_referenced_at: string
}

export interface SectionRevisionAssetTable {
  section_revision_id: string
  asset_id: string
}

export type ParseTaskState =
  | 'queued'
  | 'allocating'
  | 'awaiting_upload'
  | 'polling'
  | 'downloading'
  | 'extracting'
  | 'publishing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type MineruRemoteState =
  | 'waiting-file'
  | 'pending'
  | 'running'
  | 'converting'
  | 'done'
  | 'failed'

export interface ParseTaskTable {
  parse_task_id: string
  knowledge_item_id: string
  source_file_record_id: string
  provider_id: 'mineru'
  provider_fingerprint: string
  model_version: 'pipeline' | 'vlm' | 'MinerU-HTML'
  state: ParseTaskState
  remote_task_id: string | null
  remote_state: MineruRemoteState | null
  trace_id: string | null
  poll_count: number
  retry_count: number
  error_code: string | null
  submitted_at: string | null
  uploaded_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface ParseRevisionTable {
  parse_revision_id: string
  parse_task_id: string
  knowledge_item_id: string
  revision_number: number
  state: 'staging' | 'raw_published' | 'failed'
  source_sha256: string
  provider_id: 'mineru'
  provider_api_version: 'v4'
  provider_fingerprint: string
  model_version: 'pipeline' | 'vlm' | 'MinerU-HTML'
  remote_task_id: string
  relative_path: string
  archive_sha256: string | null
  archive_byte_size: number | null
  expanded_byte_size: number | null
  file_count: number | null
  manifest_sha256: string | null
  error_code: string | null
  created_at: string
  published_at: string | null
  updated_at: string
}

export interface ParseTaskEventTable {
  sequence: Generated<number>
  parse_task_id: string
  from_state: ParseTaskState | null
  to_state: ParseTaskState
  event: string
  remote_state: MineruRemoteState | null
  error_code: string | null
  occurred_at: string
}

export interface NormalizationRunTable {
  normalization_run_id: string
  parse_revision_id: string
  knowledge_item_id: string
  normalizer_version: number
  state: 'staging' | 'published' | 'failed'
  relative_path: string
  source_manifest_sha256: string
  blocks_sha256: string | null
  document_sha256: string | null
  manifest_sha256: string | null
  block_count: number | null
  asset_count: number | null
  error_code: string | null
  created_at: string
  published_at: string | null
  updated_at: string
}

export interface ActiveParseRevisionTable {
  knowledge_item_id: string
  parse_revision_id: string
  normalization_run_id: string
  activated_at: string
  updated_at: string
}

export interface ArtifactCleanupRequestTable {
  cleanup_id: string
  knowledge_item_id: string
  reason: 'cancelled' | 'deleted'
  parse_task_ids_json: string
  parse_revision_ids_json: string
  normalization_run_ids_json: string
  staging_relative_paths_json: string
  state: 'queued' | 'running' | 'succeeded'
  error_code: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
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

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

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
  file_records: FileRecordTable
  knowledge_items: KnowledgeItemTable
  imports: ImportTable
  model_requests: ModelRequestTable
  agent_sessions: AgentSessionTable
  agent_runs: AgentRunTable
  agent_events: AgentEventTable
  mutation_proposals: MutationProposalTable
  manuscript_assets: ManuscriptAssetTable
  section_revision_assets: SectionRevisionAssetTable
  parse_tasks: ParseTaskTable
  parse_revisions: ParseRevisionTable
  parse_task_events: ParseTaskEventTable
  normalization_runs: NormalizationRunTable
  active_parse_revisions: ActiveParseRevisionTable
  artifact_cleanup_requests: ArtifactCleanupRequestTable
  jobs: JobTable
  job_transitions: JobTransitionTable
  schema_manifest: SchemaManifestTable
  schema_migrations: SchemaMigrationTable
}
import type { Generated } from 'kysely'
