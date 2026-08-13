import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeProjectDatabase, type ProjectDatabase } from '../project/project-database'
import { ManuscriptService } from '../manuscript/manuscript-service'
import { AgentContextBuilder } from './context'
import { AgentToolDomainError } from './read-tools'
import { ReviewIssueService } from './review-issue-service'

const directories: string[] = []
const log = pino({ level: 'silent' })
const projectId = '019d0000-0000-7000-8000-000000000100'
const sessionA = '019d0000-0000-7000-8000-000000000101'
const runA = '019d0000-0000-7000-8000-000000000102'
const sessionB = '019d0000-0000-7000-8000-000000000103'
const runB = '019d0000-0000-7000-8000-000000000104'

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('ReviewIssueService', () => {
  it('deduplicates exactly, transfers tracked assignment, detects version races, and preserves orphaned anchors', async () => {
    const { database, manuscript } = await createProject()
    seedActor(database, sessionA, runA)
    seedActor(database, sessionB, runB)
    const initialSection = manuscript.listSections()[0]
    if (initialSection === undefined) throw new Error('Missing fixture section')
    const initialRevision = manuscript.getRevision(initialSection.currentRevisionId)
    manuscript.appendRevision({
      sectionId: initialSection.sectionId,
      baseRevisionId: initialRevision.sectionRevisionId,
      baseContentHash: initialRevision.contentHash,
      content: [paragraph('review-block', 'Repeated statement')],
      source: 'manual',
      sourceClass: 'manual_checkpoint',
      agentRunId: null,
      agentToolCallId: null,
      agentProposalId: null
    })
    const snapshot = new AgentContextBuilder(manuscript).capture(
      '019d0000-0000-7000-8000-000000000105',
      { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    )
    const section = snapshot.workspace.sections[0]
    const content = section && snapshot.sectionContents.get(section.revision.sectionRevisionId)
    const blockId = content?.[0]?.id
    if (section === undefined || blockId === undefined) throw new Error('Missing fixture block')
    const service = new ReviewIssueService({ database, log })
    const candidate = {
      priority: 'P2' as const,
      category: 'consistency' as const,
      title: 'Repeated statement',
      description: 'The statement repeats an earlier point.',
      evidence: 'Repeated statement',
      citationIds: [],
      sourceKind: 'deterministic' as const,
      checkId: 'duplicate_paragraphs',
      anchor: {
        sectionId: section.section.sectionId,
        revisionId: section.revision.sectionRevisionId,
        blockId
      }
    }
    const created = service.record(
      { issues: [candidate] },
      { agentSessionId: sessionA, agentRunId: runA },
      snapshot
    )
    expect(created.created).toBe(1)
    expect(created.truncated).toBe(false)
    const duplicate = service.record(
      { issues: [candidate] },
      { agentSessionId: sessionA, agentRunId: runA },
      snapshot
    )
    expect(duplicate.deduplicated).toBe(1)
    const issue = created.issues[0]
    if (issue === undefined) throw new Error('Missing issue')
    const claimed = service.update(
      { operations: [{ action: 'claim', issueId: issue.issueId, expectedVersion: issue.version }] },
      { agentSessionId: sessionA, agentRunId: runA }
    ).issues[0]
    if (claimed === undefined) throw new Error('Missing claimed issue')
    const reassigned = service.update(
      {
        operations: [{ action: 'claim', issueId: issue.issueId, expectedVersion: claimed.version }]
      },
      { agentSessionId: sessionB, agentRunId: runB }
    ).issues[0]
    expect(reassigned?.assignedAgentSessionId).toBe(sessionB)
    expect(() =>
      service.update(
        {
          operations: [
            { action: 'release', issueId: issue.issueId, expectedVersion: claimed.version }
          ]
        },
        { agentSessionId: sessionA, agentRunId: runA }
      )
    ).toThrow(AgentToolDomainError)

    const current = manuscript.getRevision(section.revision.sectionRevisionId)
    manuscript.appendRevision({
      sectionId: section.section.sectionId,
      baseRevisionId: current.sectionRevisionId,
      baseContentHash: current.contentHash,
      content: [paragraph('review-block', 'Repeated statement changed after review')],
      source: 'manual',
      sourceClass: 'manual_checkpoint',
      agentRunId: null,
      agentToolCallId: null,
      agentProposalId: null
    })
    expect(service.list({ limit: 50 }).issues[0]?.anchorStatus).toBe('orphaned')
    expect(service.events(issue.issueId).map((event) => event.eventType)).toEqual([
      'created',
      'claimed',
      'reassigned'
    ])
    database.close()
  })

  it('stops at 100 new issues per run and reports truncation without rolling back the bounded batch', async () => {
    const { database, manuscript } = await createProject()
    seedActor(database, sessionA, runA)
    const snapshot = new AgentContextBuilder(manuscript).capture(
      '019d0000-0000-7000-8000-000000000106',
      { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    )
    const service = new ReviewIssueService({ database, log })
    const batch = (offset: number, count: number) => ({
      issues: Array.from({ length: count }, (_, index) => ({
        priority: 'P3' as const,
        category: 'other' as const,
        title: `Bounded issue ${offset + index}`,
        description: 'A bounded review issue.',
        evidence: '',
        citationIds: [],
        sourceKind: 'semantic' as const,
        checkId: null,
        anchor: null
      }))
    })

    expect(
      service.record(batch(0, 50), { agentSessionId: sessionA, agentRunId: runA }, snapshot)
    ).toMatchObject({ created: 50, truncated: false })
    expect(
      service.record(batch(50, 50), { agentSessionId: sessionA, agentRunId: runA }, snapshot)
    ).toMatchObject({ created: 50, truncated: false })
    expect(
      service.record(batch(100, 1), { agentSessionId: sessionA, agentRunId: runA }, snapshot)
    ).toMatchObject({ created: 0, issues: [], truncated: true })
    expect(service.list({ limit: 1 }).total).toBe(100)
    database.close()
  })
})

async function createProject(): Promise<{
  database: ProjectDatabase
  manuscript: ManuscriptService
}> {
  const parent = await mkdtemp(join(tmpdir(), 'writellm-review-'))
  directories.push(parent)
  const projectRoot = join(parent, 'Review.writellm')
  await mkdir(projectRoot)
  const database = await initializeProjectDatabase({
    projectRoot,
    manifest: {
      format: 'writellm-project',
      formatVersion: 1,
      projectId,
      createdAt: '2026-08-13T00:00:00.000Z'
    },
    applicationVersion: 'test',
    log
  })
  return { database, manuscript: new ManuscriptService({ database, projectId, log }) }
}

function paragraph(id: string, text: string) {
  return {
    id,
    type: 'paragraph' as const,
    props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' as const },
    content: [{ type: 'text' as const, text, styles: {} }],
    children: []
  }
}

function seedActor(database: ProjectDatabase, sessionId: string, runId: string): void {
  database.immediate((native) => {
    const now = '2026-08-13T00:00:00.000Z'
    native
      .prepare(`INSERT INTO agent_sessions (
      agent_session_id, title, pi_runtime_version, event_schema_version, status,
      created_at, updated_at, archived_at
    ) VALUES (?, 'Review', 'test', 3, 'active', ?, ?, NULL)`)
      .run(sessionId, now, now)
    native
      .prepare(`INSERT INTO agent_runs (
      agent_run_id, agent_session_id, status, provider_id, model_id,
      provider_fingerprint, model_fingerprint, editor_context_json, error_json,
      started_at, completed_at, created_at, updated_at
    ) VALUES (?, ?, 'running', 'provider', 'model', ?, ?, '{}', NULL, ?, NULL, ?, ?)`)
      .run(runId, sessionId, 'a'.repeat(64), 'b'.repeat(64), now, now, now)
  })
}
