import Database from 'better-sqlite3'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { agentUserMessagePayloadSchema } from '../../../shared/contracts/agent'
import { persistedMutationProposalPayloadSchema } from '../../../shared/contracts/agent-mutations'
import { migrateDatabase } from '../../db/migrations'
import { projectMigrations } from '.'
import { migration0043 } from './0043-remove-review-fixtures-and-annotations'

const now = '2026-09-03T00:00:00.000Z'
const sessionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc700'
const runId = '019c6a5c-8d34-7a8e-a602-3d37a52dc701'
const proposalId = '019c6a5c-8d34-7a8e-a602-3d37a52dc702'
const proposalEventId = '019c6a5c-8d34-7a8e-a602-3d37a52dc703'
const issueId = '019c6a5c-8d34-7a8e-a602-3d37a52dc704'

describe('migration 0043 review fixture removal', () => {
  it('destroys review state while preserving parseable proposals and ordinary conversation', () => {
    const database = new Database(':memory:')
    migrateDatabase(database, {
      applicationVersion: 'test',
      databaseRole: 'project',
      migrations: projectMigrations.slice(0, 42),
      log: pino({ level: 'silent' })
    })
    seedAgentHistory(database)
    seedProposal(database)
    seedReviewState(database)

    database.transaction(() => migration0043.up(database)).immediate()

    const tables = database
      .prepare(
        `SELECT name FROM sqlite_schema
          WHERE type = 'table'
            AND name IN ('review_issue_events', 'review_issues', 'manuscript_annotations')`
      )
      .pluck()
      .all()
    expect(tables).toEqual([])
    expect(
      database
        .prepare(
          `SELECT COUNT(*) FROM agent_events
            WHERE json_extract(payload_json, '$.toolName') IN (
              'check_draft', 'list_review_issues', 'record_review_issues', 'update_review_issues'
            ) OR json_extract(payload_json, '$.requestedToolName') IN (
              'check_draft', 'list_review_issues', 'record_review_issues', 'update_review_issues'
            )`
        )
        .pluck()
        .get()
    ).toBe(0)

    const userPayload = JSON.parse(
      database
        .prepare("SELECT payload_json FROM agent_events WHERE type = 'user_message'")
        .pluck()
        .get() as string
    )
    expect(agentUserMessagePayloadSchema.parse(userPayload)).toEqual({
      content: 'Please revise the introduction.',
      delivery: 'prompt',
      timestamp: 1
    })

    const toolCallPayload = JSON.parse(
      database
        .prepare('SELECT payload_json FROM agent_events WHERE agent_event_id = ?')
        .pluck()
        .get(proposalEventId) as string
    )
    expect(toolCallPayload.args).toEqual({ changes: { title: 'Revised title' } })

    const proposalPayload = JSON.parse(
      database.prepare('SELECT payload_json FROM mutation_proposals').pluck().get() as string
    )
    expect(persistedMutationProposalPayloadSchema.parse(proposalPayload).kind).toBe('brief_update')
    expect(proposalPayload.provenance).not.toHaveProperty('resolvesReviewIssues')
    expect(database.pragma('foreign_key_check')).toEqual([])
    expect(database.pragma('integrity_check', { simple: true })).toBe('ok')
    database.close()
  })
})

function seedAgentHistory(database: Database.Database): void {
  database
    .prepare(
      `INSERT INTO agent_sessions (
         agent_session_id, title, pi_runtime_version, event_schema_version, created_at, updated_at
       ) VALUES (?, 'Legacy review', '0.84.4', 4, ?, ?)`
    )
    .run(sessionId, now, now)
  database
    .prepare(
      `INSERT INTO agent_runs (
         agent_run_id, agent_session_id, status, provider_id, model_id,
         provider_fingerprint, model_fingerprint, editor_context_json,
         started_at, completed_at, created_at, updated_at
       ) VALUES (?, ?, 'completed', 'provider', 'model', ?, ?, '{}', ?, ?, ?, ?)`
    )
    .run(runId, sessionId, 'a'.repeat(64), 'b'.repeat(64), now, now, now, now)

  const insert = database.prepare(
    `INSERT INTO agent_events (
       agent_event_id, agent_session_id, agent_run_id, sequence, type, payload_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  insert.run(
    'event-user',
    sessionId,
    runId,
    1,
    'user_message',
    JSON.stringify({
      content: 'Please revise the introduction.',
      delivery: 'prompt',
      timestamp: 1,
      presentation: {
        kind: 'annotation_context',
        displayContent: 'Please revise the introduction.',
        annotationCount: 1
      }
    }),
    now
  )
  insert.run(
    proposalEventId,
    sessionId,
    runId,
    2,
    'tool_call',
    JSON.stringify({
      toolCallId: 'proposal-call',
      toolName: 'submit_brief_change',
      contractVersion: 14,
      args: {
        changes: { title: 'Revised title' },
        resolvesReviewIssues: [resolutionTarget()]
      },
      timestamp: 2
    }),
    now
  )
  const removedTools = [
    'check_draft',
    'list_review_issues',
    'record_review_issues',
    'update_review_issues'
  ]
  const eventTypes = ['tool_call', 'tool_result', 'tool_attempted', 'tool_preflight_failed']
  let sequence = 3
  for (const [toolIndex, toolName] of removedTools.entries()) {
    for (const [typeIndex, type] of eventTypes.entries()) {
      const toolCallId = `removed-${toolIndex}-${typeIndex}`
      insert.run(
        `event-removed-${toolIndex}-${typeIndex}`,
        sessionId,
        runId,
        sequence,
        type,
        JSON.stringify(
          type === 'tool_call' || type === 'tool_result'
            ? { toolCallId, toolName, args: {}, timestamp: sequence }
            : { toolCallId, requestedToolName: toolName, timestamp: sequence }
        ),
        now
      )
      sequence += 1
    }
  }
}

function seedProposal(database: Database.Database): void {
  const payload = {
    schemaVersion: 1,
    kind: 'brief_update',
    mutation: {
      schemaVersion: 1,
      manuscriptId: '019c6a5c-8d34-7a8e-a602-3d37a52dc705',
      baseBriefVersion: 1,
      changes: { title: 'Revised title' },
      citationIds: []
    },
    preview: {
      summary: 'Update the title',
      affectedSectionIds: [],
      beforeText: 'Old title',
      afterText: 'Revised title',
      beforeTextTruncated: false,
      afterTextTruncated: false,
      citedSources: []
    },
    provenance: {
      modelRequestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc706',
      citedSources: [],
      resolvesReviewIssues: [resolutionTarget()]
    }
  }
  database
    .prepare(
      `INSERT INTO mutation_proposals (
         mutation_proposal_id, agent_session_id, agent_run_id, tool_call_event_id,
         agent_tool_call_id, kind, payload_json, base_brief_version, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'proposal-call', 'brief_update', ?, 1, 'pending', ?, ?)`
    )
    .run(proposalId, sessionId, runId, proposalEventId, JSON.stringify(payload), now, now)
}

function seedReviewState(database: Database.Database): void {
  database
    .prepare(
      `INSERT INTO review_issues (
         review_issue_id, fingerprint, priority, category, title, description,
         evidence_summary, source_kind, status, version, created_at, updated_at
       ) VALUES (?, ?, 'P2', 'consistency', 'Legacy issue', 'Legacy description',
                 'Legacy evidence', 'semantic', 'open', 1, ?, ?)`
    )
    .run(issueId, 'c'.repeat(64), now, now)
  database
    .prepare(
      `INSERT INTO review_issue_events (
         review_issue_event_id, review_issue_id, event_type, to_status,
         actor_kind, occurred_at
       ) VALUES ('event-review-issue', ?, 'created', 'open', 'agent', ?)`
    )
    .run(issueId, now)
  database.pragma('foreign_keys = OFF')
  database
    .prepare(
      `INSERT INTO manuscript_annotations (
         annotation_id, kind, status, body, section_id, block_id, anchor_revision_id,
         version, created_at, updated_at
       ) VALUES ('annotation-1', 'todo', 'open', 'Legacy annotation',
                 'missing-section', 'block-1', 'missing-revision', 1, ?, ?)`
    )
    .run(now, now)
  database.pragma('foreign_keys = ON')
}

function resolutionTarget() {
  return {
    issueId,
    expectedVersion: 1,
    resolutionSummary: 'Resolved by proposal.'
  }
}
