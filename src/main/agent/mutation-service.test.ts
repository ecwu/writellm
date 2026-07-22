import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import type { BlockNoteDocument } from '../../shared/contracts/manuscript'
import { EditorPersistenceService } from '../manuscript/editor-persistence-service'
import { ManuscriptService } from '../manuscript/manuscript-service'
import { initializeProjectDatabase, type ProjectDatabase } from '../project/project-database'
import type { ProjectManifest } from '../project/project-manifest'
import { MutationProposalError, MutationProposalService } from './mutation-service'
import { AgentToolDomainError } from './read-tools'

const roots: string[] = []
const log = pino({ level: 'silent' })
const projectSessionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc700'
const agentSessionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc701'
const agentRunId = '019c6a5c-8d34-7a8e-a602-3d37a52dc702'
const modelRequestId = '019c6a5c-8d34-7a8e-a602-3d37a52dc703'

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })))
})

describe('MutationProposalService', () => {
  it('persists a pending section proposal before approval, applies traceable content, and undoes by revision', async () => {
    const value = await fixture()
    const opened = value.persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const base = await value.persistence.save({
      projectSessionId,
      sectionId: opened.section.sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash,
      document: [paragraph('base', 'Before')]
    })
    const context = value.toolCall('propose_section_patch')
    const proposed = value.service.propose(
      'propose_section_patch',
      {
        schemaVersion: 1,
        sectionId: opened.section.sectionId,
        baseRevisionId: base.revision.sectionRevisionId,
        operations: [
          { type: 'updateBlock', blockId: 'base', update: { content: inline('After') } }
        ],
        citationIds: []
      },
      context
    )

    expect(
      value.database.immediate((database) =>
        database
          .prepare('SELECT status FROM mutation_proposals WHERE mutation_proposal_id = ?')
          .pluck()
          .get(proposed.proposalId)
      )
    ).toBe('pending')
    expect(value.manuscript.getRevision(base.revision.sectionRevisionId).content).toEqual([
      paragraph('base', 'Before')
    ])
    expect(() =>
      value.database.immediate((database) =>
        database
          .prepare(
            "UPDATE mutation_proposals SET status = 'applied', decision_at = ? WHERE mutation_proposal_id = ?"
          )
          .run('2026-07-21T00:01:00.000Z', proposed.proposalId)
      )
    ).toThrow()
    expect(() =>
      value.database.immediate((database) =>
        database
          .prepare(
            'UPDATE mutation_proposals SET base_brief_version = 1 WHERE mutation_proposal_id = ?'
          )
          .run(proposed.proposalId)
      )
    ).toThrow()

    const applied = await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: proposed.proposalId
    })
    expect(applied.proposal).toMatchObject({
      status: 'applied',
      appliedRevisionId: expect.any(String),
      appliedBriefVersion: null,
      appliedOutlineVersion: null,
      undoRevisionId: null
    })
    const appliedRevision = value.manuscript.getRevision(applied.proposal.appliedRevisionId ?? '')
    expect(appliedRevision).toMatchObject({
      source: 'agent',
      sourceClass: 'agent_accepted',
      priorRevisionId: base.revision.sectionRevisionId,
      agentRunId,
      agentToolCallId: context.toolCallId,
      agentProposalId: proposed.proposalId,
      content: [paragraph('base', 'After')]
    })
    expect(applied.proposal.payload.provenance.modelRequestId).toBe(modelRequestId)

    const undone = await value.service.undo({
      projectSessionId,
      agentSessionId,
      proposalId: proposed.proposalId
    })
    expect(undone.proposal.status).toBe('undone')
    expect(undone.proposal.undoRevisionId).toBeTruthy()
    expect(value.manuscript.getRevision(undone.proposal.undoRevisionId ?? '')).toMatchObject({
      source: 'undo',
      sourceClass: 'manual_checkpoint',
      priorRevisionId: appliedRevision.sectionRevisionId,
      agentRunId: null,
      agentToolCallId: null,
      agentProposalId: null,
      content: [paragraph('base', 'Before')]
    })
    value.database.close()
  })

  it('refuses undo after a later manual revision becomes current', async () => {
    const value = await fixture()
    const opened = value.persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const proposed = value.service.propose(
      'propose_section_patch',
      {
        schemaVersion: 1,
        sectionId: opened.section.sectionId,
        baseRevisionId: opened.revision.sectionRevisionId,
        operations: [
          {
            type: 'insertBlocks',
            anchorBlockId: null,
            placement: 'end',
            blocks: [paragraph('agent', 'Agent')]
          }
        ],
        citationIds: []
      },
      value.toolCall('propose_section_patch')
    )
    const applied = await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: proposed.proposalId
    })
    const current = value.manuscript.getRevision(applied.proposal.appliedRevisionId ?? '')
    await value.persistence.save({
      projectSessionId,
      sectionId: opened.section.sectionId,
      baseRevisionId: current.sectionRevisionId,
      baseContentHash: current.contentHash,
      document: [paragraph('manual-after', 'Manual after Agent')]
    })
    await expect(
      value.service.undo({ projectSessionId, agentSessionId, proposalId: proposed.proposalId })
    ).rejects.toMatchObject({ code: 'stale_base' })
    expect(
      value.database.immediate((database) =>
        database
          .prepare('SELECT status FROM mutation_proposals WHERE mutation_proposal_id = ?')
          .pluck()
          .get(proposed.proposalId)
      )
    ).toBe('applied')
    value.database.close()
  })

  it('fails closed when a manual edit makes a proposal stale and never creates an Agent revision', async () => {
    const value = await fixture()
    const opened = value.persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const context = value.toolCall('propose_section_patch')
    const proposed = value.service.propose(
      'propose_section_patch',
      {
        schemaVersion: 1,
        sectionId: opened.section.sectionId,
        baseRevisionId: opened.revision.sectionRevisionId,
        operations: [
          {
            type: 'insertBlocks',
            anchorBlockId: null,
            placement: 'end',
            blocks: [paragraph('agent', 'Agent')]
          }
        ],
        citationIds: []
      },
      context
    )
    const manual = await value.persistence.save({
      projectSessionId,
      sectionId: opened.section.sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash,
      document: [paragraph('manual', 'Manual')]
    })

    await expect(
      value.service.approve({ projectSessionId, agentSessionId, proposalId: proposed.proposalId })
    ).rejects.toMatchObject({ code: 'stale_base' })
    expect(value.manuscript.getSection(opened.section.sectionId).currentRevisionId).toBe(
      manual.revision.sectionRevisionId
    )
    expect(
      value.database.immediate((database) =>
        database
          .prepare("SELECT COUNT(*) FROM section_revisions WHERE source = 'agent'")
          .pluck()
          .get()
      )
    ).toBe(0)
    expect(
      value.database.immediate((database) =>
        database
          .prepare('SELECT status FROM mutation_proposals WHERE mutation_proposal_id = ?')
          .pluck()
          .get(proposed.proposalId)
      )
    ).toBe('failed')
    value.database.close()
  })

  it('keeps persisted proposals recoverable after service recreation and rejects stale project capabilities', async () => {
    const value = await fixture()
    const brief = value.manuscript.getBrief()
    const context = value.toolCall('propose_brief_update')
    expect(() =>
      value.service.propose(
        'propose_brief_update',
        {
          schemaVersion: 1,
          manuscriptId: brief.manuscriptId,
          baseBriefVersion: brief.version,
          changes: { title: 'Unsupported citation' },
          citationIds: [`citation-${'a'.repeat(40)}`]
        },
        context
      )
    ).toThrow('Proposal cites sources that were not read in this Agent run')
    const recoveryContext = value.toolCall('propose_brief_update')
    const proposed = value.service.propose(
      'propose_brief_update',
      {
        schemaVersion: 1,
        manuscriptId: brief.manuscriptId,
        baseBriefVersion: brief.version,
        changes: { title: 'Recovered title' },
        citationIds: []
      },
      recoveryContext
    )
    const restarted = new MutationProposalService({
      projectId: value.manifest.projectId,
      projectSessionId,
      database: value.database,
      manuscript: value.manuscript,
      editorPersistence: value.persistence,
      log
    })
    await expect(
      restarted.approve({
        projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc799',
        agentSessionId,
        proposalId: proposed.proposalId
      })
    ).rejects.toBeInstanceOf(MutationProposalError)
    const applied = await restarted.approve({
      projectSessionId,
      agentSessionId,
      proposalId: proposed.proposalId
    })
    expect(applied.proposal).toMatchObject({ status: 'applied', appliedBriefVersion: 2 })
    expect(value.manuscript.getBrief()).toMatchObject({ version: 2, title: 'Recovered title' })
    value.database.close()
  })

  it('validates a whole outline patch before persistence and records explicit rejection without applying it', async () => {
    const value = await fixture()
    const workspace = value.manuscript.getWorkspace()
    const context = value.toolCall('propose_outline_patch')
    expect(() =>
      value.service.propose(
        'propose_outline_patch',
        {
          schemaVersion: 1,
          manuscriptId: workspace.manuscriptId,
          baseOutlineVersion: workspace.outlineVersion,
          operations: [
            {
              type: 'createSection',
              sectionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc750',
              parentSectionId: null,
              position: 1,
              title: 'Would roll back',
              objective: null,
              status: 'planned'
            },
            { type: 'deleteSection', sectionId: 'missing-section' }
          ],
          citationIds: []
        },
        context
      )
    ).toThrow()
    expect(value.manuscript.listSections()).toHaveLength(1)
    expect(
      value.database.immediate((database) =>
        database.prepare('SELECT COUNT(*) FROM mutation_proposals').pluck().get()
      )
    ).toBe(0)

    const nextContext = value.toolCall('propose_outline_patch')
    const proposed = value.service.propose(
      'propose_outline_patch',
      {
        schemaVersion: 1,
        manuscriptId: workspace.manuscriptId,
        baseOutlineVersion: workspace.outlineVersion,
        operations: [
          {
            type: 'createSection',
            sectionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc751',
            parentSectionId: null,
            position: 1,
            title: 'Pending section',
            objective: null,
            status: 'planned'
          }
        ],
        citationIds: []
      },
      nextContext
    )
    const rejected = value.service.reject({
      projectSessionId,
      agentSessionId,
      proposalId: proposed.proposalId,
      reason: 'User declined'
    })
    expect(rejected.proposal).toMatchObject({ status: 'rejected', rejectedReason: 'User declined' })
    expect(value.manuscript.listSections()).toHaveLength(1)

    const applyContext = value.toolCall('propose_outline_patch')
    const appliedProposal = value.service.propose(
      'propose_outline_patch',
      {
        schemaVersion: 1,
        manuscriptId: workspace.manuscriptId,
        baseOutlineVersion: workspace.outlineVersion,
        operations: [
          {
            type: 'createSection',
            sectionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc752',
            parentSectionId: null,
            position: 1,
            title: 'Applied section',
            objective: null,
            status: 'planned'
          }
        ],
        citationIds: []
      },
      applyContext
    )
    const applied = await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: appliedProposal.proposalId
    })
    expect(applied.proposal).toMatchObject({ status: 'applied', appliedOutlineVersion: 2 })
    expect(value.manuscript.getWorkspace().outlineVersion).toBe(2)
    expect(value.manuscript.listSections().map((section) => section.title)).toContain(
      'Applied section'
    )
    value.database.close()
  })

  it('tombstones a section with accepted Agent lineage and preserves every revision reference', async () => {
    const value = await fixture()
    const root = value.manuscript.listSections()[0]
    if (root === undefined) throw new Error('Missing root section')
    const target = value.manuscript.createSection({
      baseOutlineVersion: value.manuscript.getWorkspace().outlineVersion,
      title: 'Agent-edited section',
      parentSectionId: null,
      position: 1
    })
    const sectionProposal = value.service.propose(
      'propose_section_patch',
      {
        schemaVersion: 1,
        sectionId: target.sectionId,
        baseRevisionId: target.currentRevisionId,
        operations: [
          {
            type: 'insertBlocks',
            anchorBlockId: null,
            placement: 'end',
            blocks: [paragraph('agent-outline-delete', 'Accepted before outline deletion')]
          }
        ],
        citationIds: []
      },
      value.toolCall('propose_section_patch')
    )
    const sectionApplied = await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: sectionProposal.proposalId
    })
    const appliedRevisionId = sectionApplied.proposal.appliedRevisionId
    if (appliedRevisionId === null) throw new Error('Missing accepted revision')
    expect(
      value.database.immediate((database) =>
        database
          .prepare('SELECT COUNT(*) FROM section_materializations WHERE section_id = ?')
          .pluck()
          .get(target.sectionId)
      )
    ).toBe(1)

    const workspace = value.manuscript.getWorkspace()
    const outlineProposal = value.service.propose(
      'propose_outline_patch',
      {
        schemaVersion: 1,
        manuscriptId: workspace.manuscriptId,
        baseOutlineVersion: workspace.outlineVersion,
        operations: [{ type: 'deleteSection', sectionId: target.sectionId }],
        citationIds: []
      },
      value.toolCall('propose_outline_patch')
    )
    const outlineApplied = await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: outlineProposal.proposalId
    })

    expect(outlineApplied.proposal).toMatchObject({
      status: 'applied',
      appliedOutlineVersion: workspace.outlineVersion + 1
    })
    expect(value.manuscript.listSections().map((section) => section.sectionId)).toEqual([
      root.sectionId
    ])
    expect(
      value.database.immediate((database) =>
        database
          .prepare('SELECT deleted_at FROM sections WHERE section_id = ?')
          .pluck()
          .get(target.sectionId)
      )
    ).toEqual(expect.any(String))
    expect(
      value.database.immediate((database) =>
        database
          .prepare('SELECT COUNT(*) FROM section_revisions WHERE section_id = ?')
          .pluck()
          .get(target.sectionId)
      )
    ).toBe(2)
    expect(
      value.database.immediate((database) =>
        database
          .prepare(
            'SELECT applied_revision_id FROM mutation_proposals WHERE mutation_proposal_id = ?'
          )
          .pluck()
          .get(sectionProposal.proposalId)
      )
    ).toBe(appliedRevisionId)
    expect(
      value.database.immediate((database) =>
        database
          .prepare('SELECT COUNT(*) FROM section_materializations WHERE section_id = ?')
          .pluck()
          .get(target.sectionId)
      )
    ).toBe(0)
    expect(value.database.immediate((database) => database.pragma('foreign_key_check'))).toEqual([])
    await expect(
      value.service.undo({
        projectSessionId,
        agentSessionId,
        proposalId: sectionProposal.proposalId
      })
    ).rejects.toMatchObject({ code: 'proposal_not_undoable' })
    expect(
      value.service
        .list(agentSessionId)
        .find((item) => item.proposalId === sectionProposal.proposalId)?.status
    ).toBe('applied')
    const afterDeletion = value.manuscript.getWorkspace()
    expect(() =>
      value.service.propose(
        'propose_outline_patch',
        {
          schemaVersion: 1,
          manuscriptId: afterDeletion.manuscriptId,
          baseOutlineVersion: afterDeletion.outlineVersion,
          operations: [
            {
              type: 'createSection',
              sectionId: target.sectionId,
              parentSectionId: null,
              position: 1,
              title: 'Do not reuse tombstone ID',
              objective: null,
              status: 'planned'
            }
          ],
          citationIds: []
        },
        value.toolCall('propose_outline_patch')
      )
    ).toThrowError(expect.objectContaining({ code: 'invalid_arguments' }))
    value.database.close()
  })

  it('returns a retryable conflict with refresh guidance when an outline proposal uses a stale version', async () => {
    const value = await fixture()
    const workspace = value.manuscript.getWorkspace()
    const context = value.toolCall('propose_outline_patch')
    let error: unknown
    try {
      value.service.propose(
        'propose_outline_patch',
        {
          schemaVersion: 1,
          manuscriptId: workspace.manuscriptId,
          baseOutlineVersion: workspace.outlineVersion + 1,
          operations: [
            {
              type: 'createSection',
              sectionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc753',
              parentSectionId: null,
              position: 1,
              title: 'Fresh context required',
              objective: null,
              status: 'planned'
            }
          ],
          citationIds: []
        },
        context
      )
    } catch (cause) {
      error = cause
    }
    expect(error).toBeInstanceOf(AgentToolDomainError)
    expect(error).toMatchObject({ code: 'conflict', retryable: true })
    expect((error as Error).message).toContain('get_writing_context')
    expect(
      value.database.immediate((database) =>
        database.prepare('SELECT COUNT(*) FROM mutation_proposals').pluck().get()
      )
    ).toBe(0)
    value.database.close()
  })
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'writellm-mutations-'))
  roots.push(root)
  const projectRoot = join(root, 'project')
  await mkdir(projectRoot)
  const manifest: ProjectManifest = {
    format: 'writellm-project',
    formatVersion: 1,
    projectId: '019c6a5c-8d34-7a8e-a602-3d37a52dc704',
    createdAt: '2026-07-21T00:00:00.000Z'
  }
  const database = await initializeProjectDatabase({
    projectRoot,
    manifest,
    applicationVersion: 'test',
    log
  })
  const manuscript = new ManuscriptService({ database, projectId: manifest.projectId, log })
  const persistence = new EditorPersistenceService({
    projectRoot,
    projectId: manifest.projectId,
    database,
    manuscript,
    log
  })
  seedAgent(database)
  const service = new MutationProposalService({
    projectId: manifest.projectId,
    projectSessionId,
    database,
    manuscript,
    editorPersistence: persistence,
    log
  })
  let sequence = 0
  return {
    database,
    manuscript,
    persistence,
    manifest,
    service,
    toolCall(toolName: 'propose_brief_update' | 'propose_outline_patch' | 'propose_section_patch') {
      sequence += 1
      const eventId = `019c6a5c-8d34-7a8e-a602-3d37a52dc7${String(sequence + 9).padStart(2, '0')}`
      const toolCallId = `tool-call-${sequence}`
      database.immediate((native) =>
        native
          .prepare(
            `INSERT INTO agent_events (
               agent_event_id, agent_session_id, agent_run_id, sequence, type,
               payload_json, model_request_id, created_at
             ) VALUES (?, ?, ?, ?, 'tool_call', ?, ?, ?)`
          )
          .run(
            eventId,
            agentSessionId,
            agentRunId,
            sequence,
            JSON.stringify({ toolCallId, toolName, args: {}, timestamp: sequence }),
            modelRequestId,
            '2026-07-21T00:00:00.000Z'
          )
      )
      return {
        agentSessionId,
        agentRunId,
        toolCallId,
        toolCallEventId: eventId,
        modelRequestId,
        signal: new AbortController().signal
      }
    }
  }
}

function seedAgent(database: ProjectDatabase): void {
  database.immediate((native) => {
    const now = '2026-07-21T00:00:00.000Z'
    native
      .prepare(
        `INSERT INTO agent_sessions (
           agent_session_id, title, pi_runtime_version, event_schema_version,
           status, created_at, updated_at, archived_at
         ) VALUES (?, 'Test session', 'test', 1, 'active', ?, ?, NULL)`
      )
      .run(agentSessionId, now, now)
    native
      .prepare(
        `INSERT INTO agent_runs (
           agent_run_id, agent_session_id, status, provider_id, model_id,
           provider_fingerprint, model_fingerprint, editor_context_json,
           error_json, started_at, completed_at, created_at, updated_at
         ) VALUES (?, ?, 'running', 'provider', 'model', ?, ?, '{}', NULL, ?, NULL, ?, ?)`
      )
      .run(agentRunId, agentSessionId, 'a'.repeat(64), 'b'.repeat(64), now, now, now)
    native
      .prepare(
        `INSERT INTO model_requests (
           model_request_id, operation_kind, provider_id, model_id,
           provider_fingerprint, request_fingerprint, status, attempt_count,
           retry_count, input_items, usage_json, response_ids_json, agent_run_id,
           started_at, created_at, updated_at
         ) VALUES (?, 'agent', 'provider', 'model', ?, ?, 'running', 1, 0, 1, '{}', '[]', ?, ?, ?, ?)`
      )
      .run(modelRequestId, 'a'.repeat(64), 'c'.repeat(64), agentRunId, now, now, now)
  })
}

function inline(text: string) {
  return [{ type: 'text' as const, text, styles: {} }]
}

function paragraph(id: string, text: string): BlockNoteDocument[number] {
  return {
    id,
    type: 'paragraph',
    props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
    content: inline(text),
    children: []
  }
}
