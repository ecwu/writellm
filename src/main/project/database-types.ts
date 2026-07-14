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
  created_at: string
  updated_at: string
}

export interface ManuscriptBriefTable {
  manuscript_brief_id: string
  manuscript_id: string
  version: number
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

export interface SectionTable {
  section_id: string
  manuscript_id: string
  parent_section_id: string | null
  position: number
  level: number
  title: string
  objective: string | null
  status: SectionStatus
  current_revision_id: string | null
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
  manuscripts: ManuscriptTable
  manuscript_briefs: ManuscriptBriefTable
  sections: SectionTable
  schema_manifest: SchemaManifestTable
  schema_migrations: SchemaMigrationTable
}
