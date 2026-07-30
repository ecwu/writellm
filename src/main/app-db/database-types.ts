export interface AppSettingTable {
  key: string
  value_json: string
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

export interface AppDatabaseSchema {
  app_settings: AppSettingTable
  recent_projects: RecentProjectTable
  provider_configs: ProviderConfigTable
  encrypted_credentials: EncryptedCredentialTable
  agent_model_catalogs: AgentModelCatalogTable
  agent_provider_preferences: AgentProviderPreferenceTable
  agent_model_preferences: AgentModelPreferenceTable
  schema_manifest: SchemaManifestTable
  schema_migrations: SchemaMigrationTable
}
