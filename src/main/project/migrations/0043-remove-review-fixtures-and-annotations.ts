import type { DatabaseMigration } from '../../db/migrations'

const removedToolNames = [
  'check_draft',
  'list_review_issues',
  'record_review_issues',
  'update_review_issues'
] as const

export const migration0043: DatabaseMigration = {
  version: 43,
  name: '0043-remove-review-fixtures-and-annotations',
  checksum: 'sha256:4c8ec06e1139af77183d6caeb231357049fb3563168f018cb406ec5950fe36c2',
  up(database) {
    const toolPlaceholders = removedToolNames.map(() => '?').join(', ')
    database
      .prepare(
        `DELETE FROM agent_events
          WHERE (type IN ('tool_call', 'tool_result')
                 AND json_extract(payload_json, '$.toolName') IN (${toolPlaceholders}))
             OR (type IN ('tool_attempted', 'tool_preflight_failed')
                 AND json_extract(payload_json, '$.requestedToolName') IN (${toolPlaceholders}))`
      )
      .run(...removedToolNames, ...removedToolNames)

    database.exec(`
      UPDATE agent_events
         SET payload_json = json_remove(payload_json, '$.args.resolvesReviewIssues')
       WHERE type = 'tool_call'
         AND json_type(payload_json, '$.args.resolvesReviewIssues') IS NOT NULL;

      UPDATE agent_events
         SET payload_json = json_remove(payload_json, '$.presentation')
       WHERE type = 'user_message'
         AND json_extract(payload_json, '$.presentation.kind') = 'annotation_context';

      UPDATE mutation_proposals
         SET payload_json = json_remove(payload_json, '$.provenance.resolvesReviewIssues')
       WHERE json_type(payload_json, '$.provenance.resolvesReviewIssues') IS NOT NULL;

      DROP TABLE review_issue_events;
      DROP TABLE review_issues;
      DROP TABLE manuscript_annotations;
    `)

    const foreignKeyViolations = database.pragma('foreign_key_check') as unknown[]
    if (foreignKeyViolations.length > 0) {
      throw new Error(
        `Review fixture removal foreign key check failed: ${JSON.stringify(foreignKeyViolations)}`
      )
    }
    const integrity = database.pragma('integrity_check', { simple: true }) as string
    if (integrity !== 'ok') {
      throw new Error(`Review fixture removal integrity check failed: ${integrity}`)
    }
  }
}
