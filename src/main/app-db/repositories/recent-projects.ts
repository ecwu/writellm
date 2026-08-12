import type { AppDatabase } from '../connection'

export interface RecentProjectPointer {
  projectId: string
  projectPath: string
  displayName: string
  lastOpenedAt: string
}

export type UpsertRecentProjectPointer = RecentProjectPointer

export const RECENT_PROJECT_LIMIT = 5

export class RecentProjectsRepository {
  constructor(
    private readonly database: AppDatabase,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async list(): Promise<RecentProjectPointer[]> {
    const rows = await this.database.kysely
      .selectFrom('recent_projects')
      .select(['project_id', 'project_path', 'display_name', 'last_opened_at'])
      .orderBy('last_opened_at', 'desc')
      .orderBy('project_id', 'asc')
      .execute()

    return rows.map(mapRecentProjectRow)
  }

  async find(projectId: string): Promise<RecentProjectPointer | null> {
    const row = await this.database.kysely
      .selectFrom('recent_projects')
      .select(['project_id', 'project_path', 'display_name', 'last_opened_at'])
      .where('project_id', '=', projectId)
      .executeTakeFirst()

    return row === undefined ? null : mapRecentProjectRow(row)
  }

  async upsert(pointer: UpsertRecentProjectPointer): Promise<void> {
    const now = this.now()

    this.database.immediate((database) => {
      database
        .prepare('DELETE FROM recent_projects WHERE project_path = ? AND project_id <> ?')
        .run(pointer.projectPath, pointer.projectId)
      database
        .prepare(
          `INSERT INTO recent_projects
             (project_id, project_path, display_name, last_opened_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(project_id) DO UPDATE SET
             project_path = excluded.project_path,
             display_name = excluded.display_name,
             last_opened_at = excluded.last_opened_at,
             updated_at = excluded.updated_at`
        )
        .run(
          pointer.projectId,
          pointer.projectPath,
          pointer.displayName,
          pointer.lastOpenedAt,
          now,
          now
        )
      database
        .prepare(
          `DELETE FROM recent_projects
            WHERE project_id NOT IN (
              SELECT project_id
                FROM recent_projects
               ORDER BY last_opened_at DESC, project_id ASC
               LIMIT ?
            )`
        )
        .run(RECENT_PROJECT_LIMIT)
    })
  }

  async remove(projectId: string): Promise<boolean> {
    const result = await this.database.kysely
      .deleteFrom('recent_projects')
      .where('project_id', '=', projectId)
      .executeTakeFirst()

    return result.numDeletedRows > 0n
  }
}

function mapRecentProjectRow(row: {
  project_id: string
  project_path: string
  display_name: string
  last_opened_at: string
}): RecentProjectPointer {
  return {
    projectId: row.project_id,
    projectPath: row.project_path,
    displayName: row.display_name,
    lastOpenedAt: row.last_opened_at
  }
}
