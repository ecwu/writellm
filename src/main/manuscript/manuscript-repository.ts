import type Database from 'better-sqlite3'
import type {
  ManuscriptBriefTable,
  ManuscriptTable,
  SectionRevisionTable,
  SectionTable
} from '../project/database-types'
import type { ProjectDatabase } from '../project/project-database'

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
            'SELECT * FROM sections WHERE manuscript_id = ? ORDER BY level, parent_section_id, position'
          )
          .all(manuscriptId) as SectionTable[]
    )
  }

  section(sectionId: string, database?: Database.Database): SectionTable | undefined {
    return this.#read(
      database,
      (current) =>
        current.prepare('SELECT * FROM sections WHERE section_id = ?').get(sectionId) as
          | SectionTable
          | undefined
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

  #read<T>(
    database: Database.Database | undefined,
    operation: (database: Database.Database) => T
  ): T {
    return database === undefined ? this.database.immediate(operation) : operation(database)
  }
}
