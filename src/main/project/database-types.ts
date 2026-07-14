export interface ProjectMetaTable {
  singleton_id: number
  project_id: string
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

export interface ProjectDatabaseSchema {
  project_meta: ProjectMetaTable
  schema_manifest: SchemaManifestTable
  schema_migrations: SchemaMigrationTable
}
