import type { AppDatabase } from '../connection'

export interface RecentProjectPointer {
  projectId: string
  projectPath: string
  displayName: string
  lastOpenedAt: string
}

export type UpsertRecentProjectPointer = RecentProjectPointer

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

    await this.database.kysely
      .insertInto('recent_projects')
      .values({
        project_id: pointer.projectId,
        project_path: pointer.projectPath,
        display_name: pointer.displayName,
        last_opened_at: pointer.lastOpenedAt,
        created_at: now,
        updated_at: now
      })
      .onConflict((conflict) =>
        conflict.column('project_id').doUpdateSet({
          project_path: pointer.projectPath,
          display_name: pointer.displayName,
          last_opened_at: pointer.lastOpenedAt,
          updated_at: now
        })
      )
      .execute()
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
