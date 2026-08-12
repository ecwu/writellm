import type { DatabaseMigration } from '../../db/migrations'

export const migration0006: DatabaseMigration = {
  version: 6,
  name: '0006-recent-project-path-uniqueness',
  checksum: 'sha256:315d76208bd3ab5e6626e62b5838efbd0ab3789cb40dacdccf60edaa03596540',
  up(database) {
    database.exec(`
      DELETE FROM recent_projects
       WHERE project_id IN (
         SELECT project_id
           FROM (
             SELECT project_id,
                    ROW_NUMBER() OVER (
                      PARTITION BY project_path
                      ORDER BY last_opened_at DESC, updated_at DESC, project_id ASC
                    ) AS duplicate_rank
               FROM recent_projects
           ) ranked_recent_projects
          WHERE duplicate_rank > 1
       );

      CREATE UNIQUE INDEX recent_projects_project_path_idx
        ON recent_projects(project_path);
    `)
  }
}
