import { normalizeCitationTitle } from '../../shared/readable-citation'
import type { ProjectDatabase } from '../project/project-database'

export function availableLegacyCitationLabels(database: ProjectDatabase): Set<string> {
  return database.immediate(
    (connection) =>
      new Set(
        (
          connection
            .prepare(
              `SELECT display_name AS label
                 FROM knowledge_items
                WHERE state = 'stored'
               UNION
               SELECT item.title AS label
                 FROM reference_items item
                WHERE EXISTS (
                  SELECT 1
                    FROM knowledge_reference_links link
                    JOIN active_parse_revisions active USING (knowledge_item_id)
                   WHERE link.reference_id = item.reference_id
                )`
            )
            .pluck()
            .all() as string[]
        ).map(normalizeCitationTitle)
      )
  )
}
