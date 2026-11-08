import type Database from 'better-sqlite3'
import type {
  ManuscriptBriefTable,
  ManuscriptTable,
  SectionRevisionTable,
  SectionTable
} from '../project/database-types'
import type { ProjectDatabase } from '../project/project-database'
import { cachedStatement } from '../db/statement-cache'

export type SectionRevisionMetadataRow = Omit<
  SectionRevisionTable,
  'content_json' | 'content_body_retained'
>

export class ManuscriptRepository {
  readonly database: ProjectDatabase

  constructor(database: ProjectDatabase) {
    this.database = database
  }

  primary(database?: Database.Database): ManuscriptTable[] {
    return this.#read(
      database,
      (current) =>
        current.prepare('SELECT * FROM manuscripts WHERE is_primary = 1').all() as ManuscriptTable[]
    )
  }

  latestBrief(
    manuscriptId: string,
    database?: Database.Database
  ): ManuscriptBriefTable | undefined {
    return this.#read(
      database,
      (current) =>
        current
          .prepare(
            'SELECT * FROM manuscript_briefs WHERE manuscript_id = ? ORDER BY version DESC LIMIT 1'
          )
          .get(manuscriptId) as ManuscriptBriefTable | undefined
    )
  }

  sections(manuscriptId: string, database?: Database.Database): SectionTable[] {
    return this.#read(
      database,
      (current) =>
        current
          .prepare(
            `SELECT * FROM sections
              WHERE manuscript_id = ? AND deleted_at IS NULL
              ORDER BY level, parent_section_id, position`
          )
          .all(manuscriptId) as SectionTable[]
    )
  }

  section(sectionId: string, database?: Database.Database): SectionTable | undefined {
    return this.#read(
      database,
      (current) =>
        current
          .prepare('SELECT * FROM sections WHERE section_id = ? AND deleted_at IS NULL')
          .get(sectionId) as SectionTable | undefined
    )
  }

  revision(revisionId: string, database?: Database.Database): SectionRevisionTable | undefined {
    return this.#read(
      database,
      (current) =>
        current
          .prepare('SELECT * FROM section_revisions WHERE section_revision_id = ?')
          .get(revisionId) as SectionRevisionTable | undefined
    )
  }

  revisionMetadata(
    revisionId: string,
    database: Database.Database
  ): SectionRevisionMetadataRow | undefined {
    return cachedStatement(
      database,
      `SELECT section_revision_id, section_id, revision_number, source, source_class,
              content_schema_version, content_hash, prior_revision_id, word_count,
              character_count, count_algorithm_version, agent_run_id, agent_tool_call_id,
              agent_proposal_id, created_at
         FROM section_revisions WHERE section_revision_id = ?`
    ).get(revisionId) as SectionRevisionMetadataRow | undefined
  }

  #read<T>(
    database: Database.Database | undefined,
    operation: (database: Database.Database) => T
  ): T {
    return database === undefined ? this.database.read(operation) : operation(database)
  }
}
