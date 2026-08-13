export interface AppSettingTable {
  key: string
  value_json: string
  created_at: string
  updated_at: string
}

export interface PublicationPresetTable {
  preset_id: string
  name: string
  origin: 'application' | 'user'
  schema_version: number
  options_json: string
  is_default: number
  created_at: string
  updated_at: string
}

export interface RecentProjectTable {
  project_id: string
  project_path: string
  display_name: string
  last_opened_at: string
  created_at: string
  updated_at: string
}

export interface ProjectTemplateTable {
  template_id: string
  name: string
  description: string
  schema_version: number
  relative_path: string
  sha256: string
  section_count: number
  writing_rule_count: number
  has_publication_preset: number
  created_at: string
  updated_at: string
}

export interface ProviderConfigTable {
  id: string
  provider: string
  config_json: string
  created_at: string
  updated_at: string
}

export interface EncryptedCredentialTable {
  id: string
  provider_config_id: string
  ciphertext: string
  binding_fingerprint: string | null
  created_at: string
  updated_at: string
}

export interface AgentModelCatalogTable {
  provider_config_id: string
  models_json: string
  checked_at: string | null
  last_attempted_at: string | null
  last_error_code: string | null
  created_at: string
  updated_at: string
}

export interface AgentProviderPreferenceTable {
  provider_config_id: string
  enabled: number
  created_at: string
  updated_at: string
}

export interface AgentModelPreferenceTable {
  provider_config_id: string
  model_id: string
  enabled: number
  manual_model_json: string | null
  created_at: string
  updated_at: string
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

export interface AgentSkillTable {
  skill_id: string
  source_kind: 'curated' | 'github'
  catalog_id: string | null
  repository: string
  directory: string
  commit_sha: string
  name: string
  description: string
  display_name: string
  license_spdx: string | null
  enabled: number
  disable_model_invocation: number
  integrity_status: 'ready' | 'missing_files' | 'integrity_failed'
  manifest_json: string
  installed_at: string
  last_checked_at: string | null
  created_at: string
  updated_at: string
}

export interface AppDatabaseSchema {
  app_settings: AppSettingTable
  publication_presets: PublicationPresetTable
  recent_projects: RecentProjectTable
  project_templates: ProjectTemplateTable
  provider_configs: ProviderConfigTable
  encrypted_credentials: EncryptedCredentialTable
  agent_model_catalogs: AgentModelCatalogTable
  agent_provider_preferences: AgentProviderPreferenceTable
  agent_model_preferences: AgentModelPreferenceTable
  agent_skills: AgentSkillTable
  schema_manifest: SchemaManifestTable
  schema_migrations: SchemaMigrationTable
}
