import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BlockNoteDocument } from '../../shared/contracts/manuscript'
import { AnnotationService } from '../manuscript/annotation-service'
import { ManuscriptAssetService } from '../manuscript/asset-service'
import { EditorPersistenceService } from '../manuscript/editor-persistence-service'
import { ManuscriptService } from '../manuscript/manuscript-service'
import { initializeProjectDatabase, type ProjectDatabase } from '../project/project-database'
import type { ProjectManifest } from '../project/project-manifest'
import { MutationProposalError, MutationProposalService } from './mutation-service'
import { AgentToolDomainError } from './read-tools'
import { AgentContextBuilder } from './context'
import { ReviewIssueService } from './review-issue-service'
import { WritingTaskService } from './writing-task-service'
import { MainAgentTools } from './tools'

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
  it('captures the exact active writing task and step on proposal creation', async () => {
    const value = await fixture()
    const created = value.writingTasks.create(
      {
        objective: 'Revise the manuscript.',
        steps: [
          {
            clientRef: '019c6a5c-8d34-7a8e-a602-3d37a52dc705',
            title: 'Revise the brief'
          }
        ]
      },
      { agentSessionId, agentRunId }
    )
    const brief = value.manuscript.getBrief()
    const proposed = value.service.propose(
      'submit_brief_change',
      {
        schemaVersion: 1,
        manuscriptId: brief.manuscriptId,
        baseBriefVersion: brief.version,
        changes: { title: 'Task-scoped title' },
        citationIds: []
      },
      value.toolCall('submit_brief_change')
    )
    expect(value.service.list(agentSessionId)[0]).toMatchObject({
      proposalId: proposed.proposalId,
      writingTaskId: created.task.taskId,
      writingTaskStepId: created.task.plan.steps[0]?.stepId
    })
    value.database.close()
  })

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
    const context = value.toolCall('submit_section_change')
    const proposed = value.service.propose(
      'submit_section_change',
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
      'submit_section_change',
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
      value.toolCall('submit_section_change')
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

  it('refreshes a stale edit to another block and requires a second approval', async () => {
    const value = await fixture()
    const opened = value.persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const base = await value.persistence.save({
      projectSessionId,
      sectionId: opened.section.sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash,
      document: [paragraph('first', 'First'), paragraph('second', 'Second')]
    })
    const first = value.service.propose(
      'submit_section_change',
      {
        schemaVersion: 1,
        sectionId: opened.section.sectionId,
        baseRevisionId: base.revision.sectionRevisionId,
        operations: [
          {
            type: 'updateBlock',
            blockId: 'first',
            update: { content: inline('First applied') }
          }
        ],
        citationIds: []
      },
      value.toolCall('submit_section_change')
    )
    const second = value.service.propose(
      'submit_section_change',
      {
        schemaVersion: 1,
        sectionId: opened.section.sectionId,
        baseRevisionId: base.revision.sectionRevisionId,
        operations: [
          {
            type: 'updateBlock',
            blockId: 'second',
            update: { content: inline('Second applied') }
          }
        ],
        citationIds: []
      },
      value.toolCall('submit_section_change')
    )
    const firstApplied = await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: first.proposalId
    })
    expect(firstApplied.outcome).toBe('applied')

    const refreshed = await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: second.proposalId
    })
    expect(refreshed).toMatchObject({
      outcome: 'refresh_required',
      previousProposal: { status: 'superseded' },
      proposal: { status: 'pending', replacesProposalId: second.proposalId }
    })
    expect(
      value.database.immediate((database) =>
        database
          .prepare("SELECT COUNT(*) FROM section_revisions WHERE source = 'agent'")
          .pluck()
          .get()
      )
    ).toBe(1)
    if (refreshed.outcome !== 'refresh_required') throw new Error('Expected refreshed proposal')
    expect(() =>
      value.database.immediate((database) =>
        database
          .prepare(
            `INSERT INTO mutation_proposals (
               mutation_proposal_id, agent_session_id, agent_run_id, tool_call_event_id,
               agent_tool_call_id, kind, payload_json, base_revision_id,
               base_brief_version, base_outline_version, status, decision_at,
               applied_revision_id, applied_brief_version, applied_outline_version,
               undo_revision_id, replaces_proposal_id, rejected_reason, created_at, updated_at
             )
             SELECT ?, agent_session_id, agent_run_id, tool_call_event_id,
               agent_tool_call_id, kind, payload_json, base_revision_id,
               base_brief_version, base_outline_version, 'pending', NULL,
               NULL, NULL, NULL, NULL, replaces_proposal_id, NULL, created_at, updated_at
             FROM mutation_proposals WHERE mutation_proposal_id = ?`
          )
          .run('019c6a5c-8d34-7a8e-a602-3d37a52dc798', refreshed.proposal.proposalId)
      )
    ).toThrow()

    const afterFirst = value.manuscript.getRevision(firstApplied.proposal.appliedRevisionId ?? '')
    await value.persistence.save({
      projectSessionId,
      sectionId: opened.section.sectionId,
      baseRevisionId: afterFirst.sectionRevisionId,
      baseContentHash: afterFirst.contentHash,
      document: [
        paragraph('first', 'First applied'),
        paragraph('second', 'Second'),
        paragraph('manual', 'Unrelated manual edit')
      ]
    })
    const refreshedAgain = await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: refreshed.proposal.proposalId
    })
    expect(refreshedAgain).toMatchObject({
      outcome: 'refresh_required',
      previousProposal: { status: 'superseded' },
      proposal: { status: 'pending', replacesProposalId: refreshed.proposal.proposalId }
    })
    if (refreshedAgain.outcome !== 'refresh_required') {
      throw new Error('Expected a second refreshed proposal')
    }
    const applied = await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: refreshedAgain.proposal.proposalId
    })
    expect(applied.outcome).toBe('applied')
    expect(value.manuscript.getRevision(applied.proposal.appliedRevisionId ?? '').content).toEqual([
      paragraph('first', 'First applied'),
      paragraph('second', 'Second applied'),
      paragraph('manual', 'Unrelated manual edit')
    ])
    expect(
      value.service.list(agentSessionId).map((proposal) => ({
        id: proposal.proposalId,
        replaces: proposal.replacesProposalId,
        status: proposal.status
      }))
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: second.proposalId, replaces: null, status: 'superseded' }),
        expect.objectContaining({
          id: refreshed.proposal.proposalId,
          replaces: second.proposalId,
          status: 'superseded'
        }),
        expect.objectContaining({
          id: refreshedAgain.proposal.proposalId,
          replaces: refreshed.proposal.proposalId,
          status: 'applied'
        })
      ])
    )
    value.database.immediate((database) =>
      database.prepare('DELETE FROM agent_sessions WHERE agent_session_id = ?').run(agentSessionId)
    )
    expect(
      value.database.immediate((database) =>
        database.prepare('SELECT COUNT(*) FROM mutation_proposals').pluck().get()
      )
    ).toBe(0)
    expect(value.database.immediate((database) => database.pragma('foreign_key_check'))).toEqual([])
    value.database.close()
  })

  it('auto-applies one safe stale refresh without a second review', async () => {
    const value = await fixture()
    const opened = value.persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const base = await value.persistence.save({
      projectSessionId,
      sectionId: opened.section.sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash,
      document: [paragraph('first', 'First'), paragraph('second', 'Second')]
    })
    const propose = (blockId: string, text: string) =>
      value.service.propose(
        'submit_section_change',
        {
          schemaVersion: 1,
          sectionId: opened.section.sectionId,
          baseRevisionId: base.revision.sectionRevisionId,
          operations: [{ type: 'updateBlock', blockId, update: { content: inline(text) } }],
          citationIds: []
        },
        value.toolCall('submit_section_change')
      )
    const first = propose('first', 'First applied')
    const second = propose('second', 'Second applied')
    await value.service.approve({ projectSessionId, agentSessionId, proposalId: first.proposalId })

    const outcome = await value.service.approveAutomatically(
      agentSessionId,
      second.proposalId,
      true
    )

    expect(outcome).toMatchObject({
      outcome: 'applied',
      proposalId: second.proposalId,
      kind: 'section_patch'
    })
    expect(outcome.effectiveProposalId).not.toBe(second.proposalId)
    const effective = value.service
      .list(agentSessionId)
      .find((proposal) => proposal.proposalId === outcome.effectiveProposalId)
    expect(value.manuscript.getRevision(effective?.appliedRevisionId ?? '').content).toEqual([
      paragraph('first', 'First applied'),
      paragraph('second', 'Second applied')
    ])
    value.database.close()
  })

  it('serializes competing approvals so only an exact-base proposal can apply', async () => {
    const value = await fixture()
    const opened = value.persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const base = await value.persistence.save({
      projectSessionId,
      sectionId: opened.section.sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash,
      document: [paragraph('left', 'Left'), paragraph('right', 'Right')]
    })
    const propose = (blockId: string, text: string) =>
      value.service.propose(
        'submit_section_change',
        {
          schemaVersion: 1,
          sectionId: opened.section.sectionId,
          baseRevisionId: base.revision.sectionRevisionId,
          operations: [{ type: 'updateBlock', blockId, update: { content: inline(text) } }],
          citationIds: []
        },
        value.toolCall('submit_section_change')
      )
    const left = propose('left', 'Left applied')
    const right = propose('right', 'Right applied')

    const [leftResult, rightResult] = await Promise.all([
      value.service.approve({ projectSessionId, agentSessionId, proposalId: left.proposalId }),
      value.service.approve({ projectSessionId, agentSessionId, proposalId: right.proposalId })
    ])

    expect(leftResult.outcome).toBe('applied')
    expect(rightResult).toMatchObject({ outcome: 'refresh_required' })
    expect(
      value.database.immediate((database) =>
        database
          .prepare("SELECT COUNT(*) FROM section_revisions WHERE source = 'agent'")
          .pluck()
          .get()
      )
    ).toBe(1)
    expect(
      value.manuscript.getRevision(
        value.manuscript.getSection(opened.section.sectionId).currentRevisionId
      ).content
    ).toEqual([paragraph('left', 'Left applied'), paragraph('right', 'Right')])
    value.database.close()
  })

  it('conflicts on overlapping fields and completes an already-satisfied update without a revision', async () => {
    const value = await fixture()
    const opened = value.persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const base = await value.persistence.save({
      projectSessionId,
      sectionId: opened.section.sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash,
      document: [paragraph('target', 'Before')]
    })
    const propose = (text: string) =>
      value.service.propose(
        'submit_section_change',
        {
          schemaVersion: 1,
          sectionId: opened.section.sectionId,
          baseRevisionId: base.revision.sectionRevisionId,
          operations: [
            { type: 'updateBlock', blockId: 'target', update: { content: inline(text) } }
          ],
          citationIds: []
        },
        value.toolCall('submit_section_change')
      )
    const appliedProposal = propose('Applied')
    const conflictedProposal = propose('Different')
    const satisfiedProposal = propose('Applied')
    await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: appliedProposal.proposalId
    })
    const revisionCount = value.database.immediate((database) =>
      database.prepare('SELECT COUNT(*) FROM section_revisions').pluck().get()
    )

    const conflict = await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: conflictedProposal.proposalId
    })
    expect(conflict).toMatchObject({
      outcome: 'conflict',
      proposal: { status: 'conflicted' },
      conflict: { code: 'target_changed' }
    })
    const satisfied = await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: satisfiedProposal.proposalId
    })
    expect(satisfied).toMatchObject({
      outcome: 'already_satisfied',
      proposal: { status: 'satisfied' }
    })
    expect(
      value.database.immediate((database) =>
        database.prepare('SELECT COUNT(*) FROM section_revisions').pluck().get()
      )
    ).toBe(revisionCount)

    const propsBase = value.manuscript.getRevision(
      value.manuscript.getSection(opened.section.sectionId).currentRevisionId
    )
    const proposeProps = (props: Record<string, string>) =>
      value.service.propose(
        'submit_section_change',
        {
          schemaVersion: 1,
          sectionId: opened.section.sectionId,
          baseRevisionId: propsBase.sectionRevisionId,
          operations: [{ type: 'updateBlock', blockId: 'target', update: { props } }],
          citationIds: []
        },
        value.toolCall('submit_section_change')
      )
    const alignment = proposeProps({ textAlignment: 'center' })
    const background = proposeProps({ backgroundColor: 'red' })
    await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: alignment.proposalId
    })
    const refreshedBackground = await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: background.proposalId
    })
    expect(refreshedBackground.outcome).toBe('refresh_required')
    if (refreshedBackground.outcome !== 'refresh_required') {
      throw new Error('Expected props refresh')
    }
    const appliedBackground = await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: refreshedBackground.proposal.proposalId
    })
    expect(appliedBackground.outcome).toBe('applied')
    expect(
      value.manuscript.getRevision(appliedBackground.proposal.appliedRevisionId ?? '').content[0]
        ?.props
    ).toMatchObject({ textAlignment: 'center', backgroundColor: 'red' })
    value.database.close()
  })

  it('retains a pending section proposal base body until the proposal becomes terminal', async () => {
    const value = await fixture()
    const opened = value.persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const protectedBase = await value.persistence.save({
      projectSessionId,
      sectionId: opened.section.sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash,
      document: [paragraph('protected', 'Protected proposal base')]
    })
    const proposal = value.service.propose(
      'submit_section_change',
      {
        schemaVersion: 1,
        sectionId: opened.section.sectionId,
        baseRevisionId: protectedBase.revision.sectionRevisionId,
        operations: [
          {
            type: 'updateBlock',
            blockId: 'protected',
            update: { content: inline('Agent update') }
          }
        ],
        citationIds: []
      },
      value.toolCall('submit_section_change')
    )
    let current = protectedBase.revision
    for (let revision = 0; revision < 130; revision += 1) {
      const saved = await value.persistence.save({
        projectSessionId,
        sectionId: opened.section.sectionId,
        baseRevisionId: current.sectionRevisionId,
        baseContentHash: current.contentHash,
        document: [paragraph(`later-${revision}`, `Later revision ${revision}`)]
      })
      current = saved.revision
    }
    const bodyRetained = () =>
      value.database.immediate((database) =>
        database
          .prepare(
            'SELECT content_body_retained FROM section_revisions WHERE section_revision_id = ?'
          )
          .pluck()
          .get(protectedBase.revision.sectionRevisionId)
      )
    expect(bodyRetained()).toBe(1)

    value.service.reject({
      projectSessionId,
      agentSessionId,
      proposalId: proposal.proposalId,
      reason: 'Retention test complete'
    })
    await value.persistence.save({
      projectSessionId,
      sectionId: opened.section.sectionId,
      baseRevisionId: current.sectionRevisionId,
      baseContentHash: current.contentHash,
      document: [paragraph('after-terminal', 'After proposal termination')]
    })
    expect(bodyRetained()).toBe(0)
    value.database.close()
  }, 30_000)

  it('keeps persisted proposals recoverable after service recreation and rejects stale project capabilities', async () => {
    const value = await fixture()
    const brief = value.manuscript.getBrief()
    const context = value.toolCall('submit_brief_change')
    expect(() =>
      value.service.propose(
        'submit_brief_change',
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
    const recoveryContext = value.toolCall('submit_brief_change')
    const proposed = value.service.propose(
      'submit_brief_change',
      {
        schemaVersion: 1,
        manuscriptId: brief.manuscriptId,
        baseBriefVersion: brief.version,
        changes: { title: 'Recovered title' },
        citationIds: []
      },
      recoveryContext
    )
    expect(proposed.preview.presentation).toEqual({
      schemaVersion: 1,
      kind: 'brief_fields',
      fields: [
        {
          field: 'title',
          before: { text: brief.title, truncated: false },
          after: { text: 'Recovered title', truncated: false }
        }
      ]
    })
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
    const context = value.toolCall('submit_outline_change')
    expect(() =>
      value.service.propose(
        'submit_outline_change',
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

    const nextContext = value.toolCall('submit_outline_change')
    const proposed = value.service.propose(
      'submit_outline_change',
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
    expect(proposed.preview.presentation).toMatchObject({
      schemaVersion: 1,
      kind: 'outline_operations',
      operations: [
        {
          type: 'create',
          section: {
            sectionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc751',
            title: 'Pending section',
            location: { parentSectionId: null, parentTitle: null, position: 1 },
            status: 'planned'
          }
        }
      ]
    })
    const rejected = value.service.reject({
      projectSessionId,
      agentSessionId,
      proposalId: proposed.proposalId,
      reason: 'User declined'
    })
    expect(rejected.proposal).toMatchObject({ status: 'rejected', rejectedReason: 'User declined' })
    expect(value.manuscript.listSections()).toHaveLength(1)

    const applyContext = value.toolCall('submit_outline_change')
    const appliedProposal = value.service.propose(
      'submit_outline_change',
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

  it('normalizes sequential outline moves against the updated provisional sibling order', async () => {
    const value = await fixture()
    const root = value.manuscript.listSections()[0]
    if (root === undefined) throw new Error('Missing root section')
    const second = value.manuscript.createSection({
      baseOutlineVersion: value.manuscript.getWorkspace().outlineVersion,
      title: 'Second',
      parentSectionId: null,
      position: 1
    })
    const third = value.manuscript.createSection({
      baseOutlineVersion: value.manuscript.getWorkspace().outlineVersion,
      title: 'Third',
      parentSectionId: null,
      position: 2
    })
    value.manuscript.createSection({
      baseOutlineVersion: value.manuscript.getWorkspace().outlineVersion,
      title: 'Fourth',
      parentSectionId: null,
      position: 3
    })
    const contextBuilder = new AgentContextBuilder(value.manuscript)
    const snapshot = contextBuilder.capture('snapshot-outline-sequence', {
      activeSectionId: null,
      activeBlockId: null,
      selectedBlockIds: []
    })
    const tools = new MainAgentTools(
      { contextBuilder: () => contextBuilder, execute: vi.fn() } as never,
      value.service
    )
    const context = value.toolCall('submit_outline_change')
    const result = await tools.execute({
      toolName: 'submit_outline_change',
      args: {
        operations: [
          {
            type: 'moveSection',
            section: { kind: 'existing', sectionId: third.sectionId },
            parent: null,
            placement: { kind: 'before', anchor: { kind: 'existing', sectionId: root.sectionId } }
          },
          {
            type: 'deleteSection',
            section: { kind: 'existing', sectionId: second.sectionId }
          },
          {
            type: 'createSection',
            clientRef: 'created-conclusion',
            parent: null,
            placement: { kind: 'after', anchor: { kind: 'existing', sectionId: root.sectionId } },
            title: 'Conclusion',
            objective: null,
            status: 'planned'
          },
          {
            type: 'moveSection',
            section: { kind: 'created', clientRef: 'created-conclusion' },
            parent: null,
            placement: { kind: 'first' }
          }
        ]
      },
      editorContext: snapshot.editorContext,
      snapshot,
      ...context
    })

    const proposal = value.service
      .list(agentSessionId)
      .find((item) => item.proposalId === result.proposalId)
    if (proposal?.payload.kind !== 'outline_patch') throw new Error('Missing outline proposal')
    expect(proposal.payload.mutation.operations).toMatchObject([
      { type: 'moveSection', sectionId: third.sectionId, parentSectionId: null, position: 0 },
      { type: 'deleteSection', sectionId: second.sectionId },
      { type: 'createSection', parentSectionId: null, position: 2, title: 'Conclusion' },
      { type: 'moveSection', parentSectionId: null, position: 0 }
    ])
    expect(proposal.payload.preview.presentation).toMatchObject({
      kind: 'outline_operations',
      operations: [
        { type: 'move', title: third.title, before: { position: 2 }, after: { position: 0 } },
        { type: 'delete', section: { sectionId: second.sectionId } },
        { type: 'create', section: { title: 'Conclusion', location: { position: 2 } } },
        {
          type: 'move',
          title: 'Conclusion',
          before: { position: 2 },
          after: { position: 0 }
        }
      ]
    })
    value.database.close()
  })

  it('creates native math and application-owned diagram blocks through the Agent tool', async () => {
    const value = await fixture()
    const section = value.manuscript.listSections()[0]
    if (section === undefined) throw new Error('Missing section')
    const contextBuilder = new AgentContextBuilder(value.manuscript)
    const snapshot = contextBuilder.capture('snapshot-rich-blocks', {
      activeSectionId: section.sectionId,
      activeBlockId: null,
      selectedBlockIds: []
    })
    const tools = new MainAgentTools(
      { contextBuilder: () => contextBuilder, execute: vi.fn() } as never,
      value.service
    )
    const result = await tools.execute({
      toolName: 'submit_section_change',
      args: {
        sectionId: section.sectionId,
        operations: [
          {
            type: 'insertRichBlock',
            placement: 'end',
            block: { blockType: 'mathBlock', source: String.raw`\frac{x}{y}` }
          },
          {
            type: 'insertRichBlock',
            placement: 'end',
            block: {
              blockType: 'diagram',
              source: 'flowchart LR\nA --> B',
              caption: 'Flow',
              altText: 'A flows to B'
            }
          }
        ]
      },
      editorContext: snapshot.editorContext,
      snapshot,
      ...value.toolCall('submit_section_change')
    })

    const applied = await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: result.proposalId
    })
    expect(applied).toMatchObject({ outcome: 'applied' })
    expect(currentContent(value, section.sectionId)).toMatchObject([
      {
        type: 'mathBlock',
        props: {},
        content: [{ type: 'text', text: String.raw`\frac{x}{y}`, styles: {} }]
      },
      {
        type: 'diagram',
        props: { engine: 'mermaid', caption: 'Flow', altText: 'A flows to B' },
        content: [{ type: 'text', text: 'flowchart LR\nA --> B', styles: {} }]
      }
    ])
    value.database.close()
  })

  it('creates a normalized native table through a reviewable section proposal', async () => {
    const value = await fixture()
    const section = value.manuscript.listSections()[0]
    if (section === undefined) throw new Error('Missing section')
    const contextBuilder = new AgentContextBuilder(value.manuscript)
    const snapshot = contextBuilder.capture('snapshot-table-create', {
      activeSectionId: section.sectionId,
      activeBlockId: null,
      selectedBlockIds: []
    })
    const tools = new MainAgentTools(
      { contextBuilder: () => contextBuilder, execute: vi.fn() } as never,
      value.service
    )
    const result = await tools.execute({
      toolName: 'submit_section_change',
      args: {
        sectionId: section.sectionId,
        operations: [
          {
            type: 'insertTable',
            placement: 'end',
            table: {
              clientRef: 'results',
              headerRows: 1,
              headerCols: 1,
              rows: [
                [
                  'Metric',
                  { content: [{ type: 'math', content: 'R^2' }], textAlignment: 'center' }
                ],
                ['Score', '0.91']
              ]
            }
          }
        ]
      },
      editorContext: snapshot.editorContext,
      snapshot,
      ...value.toolCall('submit_section_change')
    })
    expect(result.createdBlockRefs).toMatchObject({ results: expect.any(String) })
    expect(result.preview.presentation).toMatchObject({
      kind: 'table_diff',
      tables: [{ beforeRows: 0, afterRows: 2, afterColumns: 2 }]
    })
    const applied = await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: result.proposalId
    })
    expect(applied).toMatchObject({ outcome: 'applied' })
    expect(currentContent(value, section.sectionId)).toMatchObject([
      {
        id: result.createdBlockRefs?.results,
        type: 'table',
        content: {
          type: 'tableContent',
          headerRows: 1,
          headerCols: 1,
          columnWidths: [null, null],
          rows: [
            {
              cells: [
                { type: 'tableCell', props: { textAlignment: 'left' } },
                { type: 'tableCell', props: { textAlignment: 'center' } }
              ]
            },
            {
              cells: [
                { type: 'tableCell', props: { textAlignment: 'left' } },
                { type: 'tableCell', props: { textAlignment: 'left' } }
              ]
            }
          ]
        }
      }
    ])
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
      'submit_section_change',
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
      value.toolCall('submit_section_change')
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
      'submit_outline_change',
      {
        schemaVersion: 1,
        manuscriptId: workspace.manuscriptId,
        baseOutlineVersion: workspace.outlineVersion,
        operations: [{ type: 'deleteSection', sectionId: target.sectionId }],
        citationIds: []
      },
      value.toolCall('submit_outline_change')
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
        'submit_outline_change',
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
        value.toolCall('submit_outline_change')
      )
    ).toThrowError(expect.objectContaining({ code: 'invalid_arguments' }))
    value.database.close()
  })

  it('returns a retryable conflict with refresh guidance when an outline proposal uses a stale version', async () => {
    const value = await fixture()
    const workspace = value.manuscript.getWorkspace()
    const context = value.toolCall('submit_outline_change')
    let error: unknown
    try {
      value.service.propose(
        'submit_outline_change',
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

  it('reuses one generated asset when an edit during generation requires a refreshed proposal', async () => {
    const value = await fixture()
    const opened = value.persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const base = await value.persistence.save({
      projectSessionId,
      sectionId: opened.section.sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash,
      document: [paragraph('base', 'Before generation')]
    })
    const manuscriptAssets = new ManuscriptAssetService({
      projectRoot: value.projectRoot,
      projectId: value.manifest.projectId,
      database: value.database,
      log
    })
    let finishGeneration: ((result: Record<string, unknown>) => void) | undefined
    const generatedResult = new Promise<Record<string, unknown>>((resolve) => {
      finishGeneration = resolve
    })
    const generateImage = vi.fn(async () => {
      seedImageModelRequest(value.database)
      return generatedResult
    })
    const service = new MutationProposalService({
      projectId: value.manifest.projectId,
      projectSessionId,
      database: value.database,
      manuscript: value.manuscript,
      editorPersistence: value.persistence,
      manuscriptAssets,
      modelExecution: { generateImage } as never,
      flushForMutation: async () => undefined,
      log
    })
    const snapshot = new AgentContextBuilder(value.manuscript).capture('image-snapshot', {
      activeSectionId: opened.section.sectionId,
      selectedBlockIds: [],
      activeBlockId: null
    })
    const proposed = service.proposeGeneratedImage(
      {
        sectionId: opened.section.sectionId,
        anchor: null,
        placement: 'end',
        prompt: 'A clean architecture diagram without embedded text',
        altText: 'Architecture diagram',
        caption: 'Generated architecture',
        aspectRatio: '16:9',
        imageSize: '1K'
      },
      snapshot,
      value.toolCall('generate_image')
    )
    expect(generateImage).not.toHaveBeenCalled()

    const approval = service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: proposed.proposalId
    })
    await vi.waitFor(() => expect(generateImage).toHaveBeenCalledTimes(1))
    await value.persistence.save({
      projectSessionId,
      sectionId: opened.section.sectionId,
      baseRevisionId: base.revision.sectionRevisionId,
      baseContentHash: base.revision.contentHash,
      document: [paragraph('base', 'Edited while generating')]
    })
    finishGeneration?.({
      dataBase64: png(64, 36).toString('base64'),
      mimeType: 'image/png',
      effectiveImageSize: '1K',
      modelRequestId: imageModelRequestId,
      metadata: {
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          estimatedCostUsdMicros: null
        },
        responseIds: ['gemini-response'],
        retryCount: 0,
        providerModelId: 'gemini-3.1-flash-image'
      }
    })
    const refreshed = await approval
    expect(refreshed).toMatchObject({
      outcome: 'refresh_required',
      previousProposal: { status: 'superseded' },
      proposal: { status: 'pending' }
    })
    if (refreshed.outcome !== 'refresh_required') throw new Error('Expected image refresh')
    expect(refreshed.proposal.payload).toMatchObject({
      kind: 'generated_image_insert',
      mutation: { assetId: expect.any(String), imageModelRequestId }
    })
    if (
      refreshed.proposal.payload.kind !== 'generated_image_insert' ||
      refreshed.proposal.payload.mutation.assetId === null
    ) {
      throw new Error('Expected generated image asset')
    }
    const generatedAssetId = refreshed.proposal.payload.mutation.assetId

    const applied = await service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: refreshed.proposal.proposalId
    })
    expect(applied).toMatchObject({ outcome: 'applied', proposal: { status: 'applied' } })
    expect(generateImage).toHaveBeenCalledTimes(1)
    const current = value.manuscript.getRevision(applied.proposal.appliedRevisionId ?? '')
    expect(current.content.map((block) => block.type)).toEqual(['paragraph', 'image'])
    expect(current.content.at(-1)).toMatchObject({
      type: 'image',
      props: { url: `writellm-asset:${generatedAssetId}` }
    })
    const assetRow = value.database.immediate(
      (native) =>
        native
          .prepare(
            `SELECT relative_path, mime_type, source_type, generation_request_json,
                    model_request_id, agent_run_id
               FROM manuscript_assets
              WHERE asset_id = ?`
          )
          .get(generatedAssetId) as {
          relative_path: string
          mime_type: string
          source_type: string
          generation_request_json: string
          model_request_id: string
          agent_run_id: string
        }
    )
    expect(assetRow).toMatchObject({
      relative_path: expect.stringMatching(/^manuscript\/assets\/[0-9a-f]{64}\.png$/),
      mime_type: 'image/png',
      source_type: 'generated',
      model_request_id: imageModelRequestId,
      agent_run_id: agentRunId
    })
    expect(JSON.parse(assetRow.generation_request_json)).toEqual({
      prompt: 'A clean architecture diagram without embedded text',
      aspectRatio: '16:9',
      requestedImageSize: '1K',
      effectiveImageSize: '1K'
    })
    expect(await readFile(join(value.projectRoot, assetRow.relative_path))).toEqual(png(64, 36))
    expect(
      value.database.immediate((native) =>
        native
          .prepare(
            `SELECT section_revision_id, asset_id
               FROM section_revision_assets
              WHERE asset_id = ?`
          )
          .get(generatedAssetId)
      )
    ).toEqual({
      section_revision_id: current.sectionRevisionId,
      asset_id: generatedAssetId
    })
    value.database.close()
  })

  it('refreshes a stale image base before calling the billable gateway', async () => {
    const value = await fixture()
    const opened = value.persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const snapshot = new AgentContextBuilder(value.manuscript).capture('stale-image-snapshot', {
      activeSectionId: opened.section.sectionId,
      selectedBlockIds: [],
      activeBlockId: null
    })
    const generateImage = vi.fn(async () => {
      seedImageModelRequest(value.database)
      return {
        dataBase64: png(64, 36).toString('base64'),
        mimeType: 'image/png',
        effectiveImageSize: '1K',
        modelRequestId: imageModelRequestId,
        metadata: {
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            estimatedCostUsdMicros: null
          },
          responseIds: ['gemini-response'],
          retryCount: 0,
          providerModelId: 'gemini-3.1-flash-image'
        }
      }
    })
    const service = new MutationProposalService({
      projectId: value.manifest.projectId,
      projectSessionId,
      database: value.database,
      manuscript: value.manuscript,
      editorPersistence: value.persistence,
      manuscriptAssets: new ManuscriptAssetService({
        projectRoot: value.projectRoot,
        projectId: value.manifest.projectId,
        database: value.database,
        log
      }),
      modelExecution: { generateImage } as never,
      flushForMutation: async () => undefined,
      log
    })
    const proposed = service.proposeGeneratedImage(
      {
        sectionId: opened.section.sectionId,
        anchor: null,
        placement: 'end',
        prompt: 'An image that must not be billed after a stale edit',
        altText: 'Stale image',
        caption: '',
        aspectRatio: 'auto',
        imageSize: '1K'
      },
      snapshot,
      value.toolCall('generate_image')
    )
    const edited = await value.persistence.save({
      projectSessionId,
      sectionId: opened.section.sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash,
      document: [paragraph('new-base', 'Changed before approval')]
    })

    const refreshed = await service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: proposed.proposalId
    })
    expect(refreshed).toMatchObject({
      outcome: 'refresh_required',
      previousProposal: { status: 'superseded' },
      proposal: { status: 'pending', kind: 'generated_image_insert' }
    })
    expect(generateImage).not.toHaveBeenCalled()
    if (
      refreshed.outcome !== 'refresh_required' ||
      refreshed.proposal.payload.kind !== 'generated_image_insert'
    ) {
      throw new Error('Expected a refreshed image proposal')
    }
    expect(refreshed.proposal.payload.mutation).toMatchObject({
      baseRevisionId: edited.revision.sectionRevisionId,
      assetId: null
    })

    const applied = await service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: refreshed.proposal.proposalId
    })
    expect(applied).toMatchObject({ outcome: 'applied', proposal: { status: 'applied' } })
    expect(generateImage).toHaveBeenCalledTimes(1)
    value.database.close()
  })

  it('resolves an image proposal as conflicted when its section was removed before approval', async () => {
    const value = await fixture()
    const opened = value.persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const snapshot = new AgentContextBuilder(value.manuscript).capture('missing-image-snapshot', {
      activeSectionId: opened.section.sectionId,
      selectedBlockIds: [],
      activeBlockId: null
    })
    const generateImage = vi.fn()
    const service = new MutationProposalService({
      projectId: value.manifest.projectId,
      projectSessionId,
      database: value.database,
      manuscript: value.manuscript,
      editorPersistence: value.persistence,
      manuscriptAssets: new ManuscriptAssetService({
        projectRoot: value.projectRoot,
        projectId: value.manifest.projectId,
        database: value.database,
        log
      }),
      modelExecution: { generateImage } as never,
      flushForMutation: async () => undefined,
      log
    })
    const proposed = service.proposeGeneratedImage(
      {
        sectionId: opened.section.sectionId,
        anchor: null,
        placement: 'end',
        prompt: 'An image whose target section is removed before approval',
        altText: 'Removed target image',
        caption: '',
        aspectRatio: 'auto',
        imageSize: '1K'
      },
      snapshot,
      value.toolCall('generate_image')
    )
    value.database.immediate((database) =>
      database
        .prepare('UPDATE sections SET deleted_at = ? WHERE section_id = ?')
        .run('2026-07-21T00:02:00.000Z', opened.section.sectionId)
    )

    const result = await service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: proposed.proposalId
    })
    expect(result).toMatchObject({
      outcome: 'conflict',
      conflict: { code: 'target_missing' },
      proposal: { status: 'conflicted' }
    })
    expect(generateImage).not.toHaveBeenCalled()
    value.database.close()
  })

  it('generates an immutable image candidate and replaces only the figure URL through a normal proposal', async () => {
    const value = await fixture()
    const opened = value.persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    seedImageModelRequest(value.database)
    const assets = new ManuscriptAssetService({
      projectRoot: value.projectRoot,
      projectId: value.manifest.projectId,
      database: value.database,
      log
    })
    const parent = await assets.store({
      bytes: png(64, 36),
      mimeType: 'image/png',
      sourceType: 'generated',
      generationRequest: {
        prompt: 'A blue systems diagram with three labeled layers',
        aspectRatio: '16:9',
        requestedImageSize: '1K',
        effectiveImageSize: '1K'
      },
      modelRequestId: imageModelRequestId,
      agentRunId,
      agentToolCallId: 'original-image-call'
    })
    const imageBlock: BlockNoteDocument[number] = {
      id: 'stable-figure-block',
      type: 'image',
      props: {
        backgroundColor: 'default',
        textAlignment: 'center',
        name: 'Original systems diagram',
        url: parent.logicalUrl,
        caption: 'Architecture overview',
        figureId: 'figure:stable-architecture',
        altText: 'Three-layer systems architecture',
        showPreview: true,
        previewWidth: 680
      },
      children: []
    }
    const saved = await value.persistence.save({
      projectSessionId,
      sectionId: opened.section.sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash,
      document: [paragraph('context', 'The manuscript discusses a modular system.'), imageBlock]
    })
    const candidateModelRequestId = '019c6a5c-8d34-4a8e-a602-3d37a52dc798'
    const generateImage = vi.fn(async (_database, input: { prompt: string }) => {
      seedImageModelRequest(value.database, candidateModelRequestId)
      expect(input.prompt).toContain('A blue systems diagram with three labeled layers')
      expect(input.prompt).toContain('Use warmer colors and simplify the labels')
      expect(input.prompt).toContain('The manuscript discusses a modular system.')
      return {
        dataBase64: png(80, 45).toString('base64'),
        mimeType: 'image/png',
        effectiveImageSize: '1K',
        modelRequestId: candidateModelRequestId,
        metadata: {
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            estimatedCostUsdMicros: null
          },
          responseIds: ['candidate-response'],
          retryCount: 0,
          providerModelId: 'gemini-3.1-flash-image'
        }
      }
    })
    const service = new MutationProposalService({
      projectId: value.manifest.projectId,
      projectSessionId,
      database: value.database,
      manuscript: value.manuscript,
      editorPersistence: value.persistence,
      manuscriptAssets: assets,
      modelExecution: { generateImage } as never,
      flushForMutation: async () => undefined,
      log
    })
    const snapshot = new AgentContextBuilder(value.manuscript).capture('iteration-snapshot', {
      activeSectionId: opened.section.sectionId,
      selectedBlockIds: ['stable-figure-block'],
      activeBlockId: 'stable-figure-block'
    })
    const proposed = service.proposeGeneratedImage(
      {
        sectionId: opened.section.sectionId,
        anchor: null,
        placement: 'end',
        prompt: 'Use warmer colors and simplify the labels',
        altText: 'Ignored replacement alt text',
        caption: 'Ignored replacement caption',
        aspectRatio: '16:9',
        imageSize: '1K',
        iteration: {
          sourceBlock: {
            blockId: 'stable-figure-block',
            expectedBlockHash: createHash('sha256').update(JSON.stringify(imageBlock)).digest('hex')
          },
          disposition: 'replace'
        }
      },
      snapshot,
      value.toolCall('generate_image')
    )

    const candidateReady = await service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: proposed.proposalId
    })
    expect(candidateReady).toMatchObject({
      outcome: 'refresh_required',
      previousProposal: { kind: 'generated_image_insert', status: 'superseded' },
      proposal: { kind: 'section_patch', status: 'pending' }
    })
    if (
      candidateReady.outcome !== 'refresh_required' ||
      candidateReady.proposal.payload.kind !== 'section_patch'
    ) {
      throw new Error('Expected a reviewable candidate section proposal')
    }
    expect(candidateReady.proposal.payload.mutation.operations).toEqual([
      {
        type: 'updateBlock',
        blockId: 'stable-figure-block',
        update: { props: { url: expect.stringMatching(/^writellm-asset:/) } }
      }
    ])
    const lineage = value.database.immediate(
      (database) =>
        database.prepare('SELECT * FROM manuscript_asset_variants').get() as {
          parent_asset_id: string
          candidate_asset_id: string
          candidate_model_request_id: string
          generation_proposal_id: string
          section_proposal_id: string
        }
    )
    expect(lineage).toMatchObject({
      parent_asset_id: parent.assetId,
      candidate_model_request_id: candidateModelRequestId,
      generation_proposal_id: proposed.proposalId,
      section_proposal_id: candidateReady.proposal.proposalId
    })
    const applied = await service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: candidateReady.proposal.proposalId
    })
    expect(applied.outcome).toBe('applied')
    const replaced = value.manuscript.getRevision(applied.proposal.appliedRevisionId ?? '')
    expect(replaced.content[1]).toMatchObject({
      id: 'stable-figure-block',
      type: 'image',
      props: {
        url: `writellm-asset:${lineage.candidate_asset_id}`,
        caption: 'Architecture overview',
        figureId: 'figure:stable-architecture',
        altText: 'Three-layer systems architecture',
        previewWidth: 680
      }
    })
    const undone = await service.undo({
      projectSessionId,
      agentSessionId,
      proposalId: candidateReady.proposal.proposalId
    })
    expect(value.manuscript.getRevision(undone.proposal.undoRevisionId ?? '').content[1]).toEqual(
      imageBlock
    )
    const workspace = await assets.listWorkspace({
      projectSessionId,
      usage: 'all',
      source: 'generated',
      limit: 40
    })
    expect(
      workspace.items.find((item) => item.assetId === parent.assetId)?.candidates[0]
    ).toMatchObject({
      assetId: lineage.candidate_asset_id,
      modelRequestId: candidateModelRequestId,
      agentRunId,
      agentToolCallId: expect.stringMatching(/^tool-call-/)
    })
    expect(
      workspace.items.every((item) => item.protectionReasons.includes('candidate_lineage'))
    ).toBe(true)
    expect(saved.revision.sectionRevisionId).toBeTruthy()
    value.database.close()
  })

  it('presents Writing Rules as a concise typed proposal and applies them through Brief versioning', async () => {
    const value = await fixture()
    const workspace = value.manuscript.assemble()
    const ruleId = '019c6a5c-8d34-7a8e-a602-3d37a52dc750'
    const proposed = value.service.propose(
      'submit_writing_rules_change',
      {
        schemaVersion: 1,
        manuscriptId: workspace.manuscriptId,
        baseBriefVersion: workspace.brief.version,
        changes: {
          extensible: {
            ...workspace.brief.extensible,
            writingRulesV1: {
              schemaVersion: 1,
              rules: [
                {
                  ruleId,
                  category: 'translation',
                  instruction: 'Translate LLM consistently.',
                  preferredForm: '大型语言模型',
                  discouragedForms: ['大语言模型'],
                  rationale: null,
                  active: true
                }
              ]
            }
          }
        },
        citationIds: []
      },
      value.toolCall('submit_writing_rules_change')
    )

    expect(proposed.preview).toMatchObject({
      summary: 'Update project Writing Rules',
      beforeText: 'No Writing Rules'
    })
    expect(proposed.preview.afterText).toContain('Active · translation')
    expect(proposed.preview.afterText).toContain('Translate LLM consistently.')
    expect(proposed.preview.afterText).not.toContain('targetAudience')
    expect(proposed.preview.presentation).toMatchObject({
      schemaVersion: 1,
      kind: 'writing_rules',
      changes: [
        {
          action: 'add',
          ruleId,
          before: null,
          after: { instruction: 'Translate LLM consistently.', active: true }
        }
      ]
    })

    const applied = await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: proposed.proposalId
    })
    expect(applied.outcome).toBe('applied')
    expect(value.manuscript.assemble().brief).toMatchObject({
      version: workspace.brief.version + 1,
      extensible: {
        writingRulesV1: {
          schemaVersion: 1,
          rules: [expect.objectContaining({ ruleId, active: true })]
        }
      }
    })
    value.database.close()
  })

  it('resolves linked claimed issues, reopens them on undo, and reports version races without rolling back edits', async () => {
    const value = await fixture()
    const opened = value.persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const base = await value.persistence.save({
      projectSessionId,
      sectionId: opened.section.sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash,
      document: [paragraph('review-target', 'Before review fix')]
    })
    const snapshot = new AgentContextBuilder(value.manuscript).capture('review-fix-snapshot', {
      activeSectionId: opened.section.sectionId,
      activeBlockId: 'review-target',
      selectedBlockIds: ['review-target']
    })
    const reviewIssues = new ReviewIssueService({ database: value.database, log })
    const created = reviewIssues.record(
      {
        issues: [
          {
            priority: 'P1',
            category: 'consistency',
            title: 'Fix this sentence',
            description: 'The sentence contradicts the next section.',
            evidence: 'Before review fix',
            citationIds: [],
            sourceKind: 'semantic',
            checkId: null,
            anchor: {
              sectionId: opened.section.sectionId,
              revisionId: base.revision.sectionRevisionId,
              blockId: 'review-target'
            }
          }
        ]
      },
      { agentSessionId, agentRunId },
      snapshot
    ).issues[0]
    if (created === undefined) throw new Error('Missing review issue')
    const claimed = reviewIssues.update(
      { operations: [{ action: 'claim', issueId: created.issueId, expectedVersion: 1 }] },
      { agentSessionId, agentRunId }
    ).issues[0]
    if (claimed === undefined) throw new Error('Missing claimed review issue')
    const service = new MutationProposalService({
      projectId: value.manifest.projectId,
      projectSessionId,
      database: value.database,
      manuscript: value.manuscript,
      editorPersistence: value.persistence,
      reviewIssues,
      log
    })
    const target = {
      issueId: claimed.issueId,
      expectedVersion: claimed.version,
      resolutionSummary: 'Reconciled the contradictory sentence.'
    }
    const context = { ...value.toolCall('submit_section_change'), resolvesReviewIssues: [target] }
    const proposed = service.propose(
      'submit_section_change',
      {
        schemaVersion: 1,
        sectionId: opened.section.sectionId,
        baseRevisionId: base.revision.sectionRevisionId,
        operations: [
          {
            type: 'updateBlock',
            blockId: 'review-target',
            update: { content: inline('After review fix') }
          }
        ],
        citationIds: []
      },
      context
    )
    expect(
      reviewIssues.linkProposal(proposed.proposalId, [target], { agentSessionId, agentRunId })
    ).toEqual([])
    const applied = await service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: proposed.proposalId
    })
    expect(applied).toMatchObject({ outcome: 'applied', warnings: [] })
    expect(reviewIssues.list({ limit: 50 }).issues[0]).toMatchObject({
      status: 'resolved',
      resolvedByProposalId: proposed.proposalId
    })

    const undone = await service.undo({
      projectSessionId,
      agentSessionId,
      proposalId: proposed.proposalId
    })
    expect(undone.warnings).toEqual([])
    const reopened = reviewIssues.list({ limit: 50 }).issues[0]
    expect(reopened).toMatchObject({ status: 'open', resolvedByProposalId: null })
    if (reopened === undefined) throw new Error('Missing reopened issue')

    const reclaimed = reviewIssues.update(
      {
        operations: [
          { action: 'claim', issueId: reopened.issueId, expectedVersion: reopened.version }
        ]
      },
      { agentSessionId, agentRunId }
    ).issues[0]
    if (reclaimed === undefined) throw new Error('Missing reclaimed issue')
    const current = value.manuscript.getSection(opened.section.sectionId)
    const racedTarget = {
      issueId: reclaimed.issueId,
      expectedVersion: reclaimed.version,
      resolutionSummary: 'Apply a second valid manuscript edit.'
    }
    const raced = service.propose(
      'submit_section_change',
      {
        schemaVersion: 1,
        sectionId: opened.section.sectionId,
        baseRevisionId: current.currentRevisionId,
        operations: [
          {
            type: 'updateBlock',
            blockId: 'review-target',
            update: { content: inline('Applied despite issue race') }
          }
        ],
        citationIds: []
      },
      { ...value.toolCall('submit_section_change'), resolvesReviewIssues: [racedTarget] }
    )
    reviewIssues.updateByUser({
      action: 'setPriority',
      issueId: reclaimed.issueId,
      expectedVersion: reclaimed.version,
      priority: 'P0'
    })
    const raceApplied = await service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: raced.proposalId
    })
    expect(raceApplied).toMatchObject({ outcome: 'applied' })
    expect(raceApplied.warnings).toEqual([
      `Review issue ${reclaimed.issueId} changed and was not resolved.`
    ])
    expect(reviewIssues.list({ limit: 50 }).issues[0]).toMatchObject({
      status: 'in_progress',
      priority: 'P0'
    })
    expect(
      value.manuscript.getRevision(
        value.manuscript.getSection(opened.section.sectionId).currentRevisionId
      ).content
    ).toEqual([paragraph('review-target', 'Applied despite issue race')])
    value.database.close()
  })

  it('relocates the SPACE image by applying a target copy before removing the source without generation', async () => {
    const value = await imageRelocationFixture()
    const tools = new MainAgentTools(
      { contextBuilder: () => value.contextBuilder, execute: vi.fn() } as never,
      value.service
    )
    const insertion = await tools.execute({
      toolName: 'submit_section_change',
      args: {
        sectionId: value.targetSection.sectionId,
        operations: [
          {
            type: 'insertExistingImage',
            source: {
              sectionId: value.sourceSection.sectionId,
              blockId: value.imageBlock.id,
              expectedBlockHash: value.imageHash
            },
            anchor: { blockId: value.targetAnchor.id, expectedBlockHash: value.targetAnchorHash },
            placement: 'after'
          }
        ]
      },
      editorContext: value.snapshot.editorContext,
      snapshot: value.snapshot,
      ...value.toolCall('submit_section_change')
    })

    expect(insertion).toMatchObject({ kind: 'section_patch', status: 'pending' })
    expect(currentContent(value, value.sourceSection.sectionId)).toContainEqual(value.imageBlock)
    expect(currentContent(value, value.targetSection.sectionId).filter(isImage)).toHaveLength(0)

    const inserted = await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: insertion.proposalId
    })
    expect(inserted).toMatchObject({ outcome: 'applied' })
    const targetImage = currentContent(value, value.targetSection.sectionId).find(isImage)
    expect(targetImage).toMatchObject({ type: 'image', props: value.imageBlock.props })
    expect(targetImage?.id).not.toBe(value.imageBlock.id)
    expect(currentContent(value, value.sourceSection.sectionId)).toContainEqual(value.imageBlock)

    const removalSnapshot = value.contextBuilder.capture('space-removal-snapshot', {
      activeSectionId: value.sourceSection.sectionId,
      activeBlockId: value.imageBlock.id,
      selectedBlockIds: [value.imageBlock.id]
    })
    const removal = await tools.execute({
      toolName: 'submit_section_change',
      args: {
        sectionId: value.sourceSection.sectionId,
        operations: [
          {
            type: 'removeBlocks',
            targets: [{ blockId: value.imageBlock.id, expectedBlockHash: value.imageHash }]
          }
        ]
      },
      editorContext: removalSnapshot.editorContext,
      snapshot: removalSnapshot,
      ...value.toolCall('submit_section_change')
    })
    const removed = await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: removal.proposalId
    })
    expect(removed).toMatchObject({ outcome: 'applied' })
    expect(currentContent(value, value.sourceSection.sectionId).filter(isImage)).toHaveLength(0)
    expect(currentContent(value, value.targetSection.sectionId).filter(isImage)).toHaveLength(1)
    expect(
      value.database.immediate((database) =>
        database
          .prepare("SELECT COUNT(*) FROM model_requests WHERE operation_kind = 'image'")
          .pluck()
          .get()
      )
    ).toBe(0)
    value.database.close()
  })

  it('rejects an existing image relocation with an active annotation before proposal creation', async () => {
    const value = await imageRelocationFixture()
    new AnnotationService({ database: value.database, log }).create({
      kind: 'note',
      body: 'Keep this figure anchored here.',
      sectionId: value.sourceSection.sectionId,
      blockId: value.imageBlock.id
    })
    const tools = new MainAgentTools(
      { contextBuilder: () => value.contextBuilder, execute: vi.fn() } as never,
      value.service
    )

    await expect(submitExistingImage(tools, value)).rejects.toMatchObject({
      code: 'invalid_arguments',
      message: expect.stringContaining('active section-scoped')
    })
    expect(value.service.list(agentSessionId)).toHaveLength(0)
    value.database.close()
  })

  it('rejects an existing image relocation without a matching current-run read', async () => {
    const value = await imageRelocationFixture()
    value.database.immediate((database) =>
      database.prepare("DELETE FROM agent_events WHERE type = 'tool_result'").run()
    )
    const tools = new MainAgentTools(
      { contextBuilder: () => value.contextBuilder, execute: vi.fn() } as never,
      value.service
    )

    await expect(submitExistingImage(tools, value)).rejects.toMatchObject({
      code: 'invalid_arguments',
      message: expect.stringContaining('current Agent run')
    })
    expect(value.service.list(agentSessionId)).toHaveLength(0)
    value.database.close()
  })

  it('keeps the applied target copy when the original source hash changes before deletion', async () => {
    const value = await imageRelocationFixture()
    const tools = new MainAgentTools(
      { contextBuilder: () => value.contextBuilder, execute: vi.fn() } as never,
      value.service
    )
    const insertion = await submitExistingImage(tools, value)
    expect(
      await value.service.approve({
        projectSessionId,
        agentSessionId,
        proposalId: insertion.proposalId
      })
    ).toMatchObject({ outcome: 'applied' })
    const currentSource = value.manuscript.getSection(value.sourceSection.sectionId)
    const currentSourceRevision = value.manuscript.getRevision(currentSource.currentRevisionId)
    const changedImage = {
      ...value.imageBlock,
      props: { ...value.imageBlock.props, caption: 'Caption changed after insertion.' }
    } as BlockNoteDocument[number]
    await value.persistence.save({
      projectSessionId,
      sectionId: currentSource.sectionId,
      baseRevisionId: currentSourceRevision.sectionRevisionId,
      baseContentHash: currentSourceRevision.contentHash,
      document: [changedImage, paragraph('background-body', 'Background text.')]
    })
    const removalSnapshot = value.contextBuilder.capture('changed-source-removal-snapshot', {
      activeSectionId: currentSource.sectionId,
      activeBlockId: changedImage.id,
      selectedBlockIds: [changedImage.id]
    })

    await expect(
      tools.execute({
        toolName: 'submit_section_change',
        args: {
          sectionId: currentSource.sectionId,
          operations: [
            {
              type: 'removeBlocks',
              targets: [{ blockId: changedImage.id, expectedBlockHash: value.imageHash }]
            }
          ]
        },
        editorContext: removalSnapshot.editorContext,
        snapshot: removalSnapshot,
        ...value.toolCall('submit_section_change')
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(currentContent(value, currentSource.sectionId).filter(isImage)).toHaveLength(1)
    expect(currentContent(value, value.targetSection.sectionId).filter(isImage)).toHaveLength(1)
    expect(value.service.list(agentSessionId)).toHaveLength(1)
    value.database.close()
  })

  it('rejects an existing image relocation with an unavailable asset before proposal creation', async () => {
    const value = await imageRelocationFixture()
    value.database.immediate((database) =>
      database
        .prepare("UPDATE manuscript_assets SET deletion_state = 'deleting' WHERE asset_id = ?")
        .run(value.assetId)
    )
    const tools = new MainAgentTools(
      { contextBuilder: () => value.contextBuilder, execute: vi.fn() } as never,
      value.service
    )

    await expect(submitExistingImage(tools, value)).rejects.toMatchObject({
      code: 'invalid_arguments',
      message: 'Mutation references an unavailable manuscript asset'
    })
    expect(value.service.list(agentSessionId)).toHaveLength(0)
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
  const writingTasks = new WritingTaskService({ database, log })
  const service = new MutationProposalService({
    projectId: manifest.projectId,
    projectSessionId,
    database,
    manuscript,
    editorPersistence: persistence,
    writingTasks,
    log
  })
  let sequence = 0
  return {
    projectRoot,
    database,
    manuscript,
    persistence,
    manifest,
    service,
    writingTasks,
    toolCall(
      toolName:
        | 'submit_brief_change'
        | 'submit_writing_rules_change'
        | 'submit_outline_change'
        | 'submit_section_change'
        | 'generate_image'
    ) {
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

async function imageRelocationFixture() {
  const value = await fixture()
  const opened = value.persistence.openEditor().activeSection
  if (opened === null) throw new Error('Missing source section')
  const assets = new ManuscriptAssetService({
    projectRoot: value.projectRoot,
    projectId: value.manifest.projectId,
    database: value.database,
    log
  })
  const asset = await assets.store({
    bytes: png(96, 54),
    mimeType: 'image/png',
    sourceType: 'upload',
    originalName: 'space-taxonomy.png'
  })
  const imageBlock: BlockNoteDocument[number] = {
    id: 'space-taxonomy-image',
    type: 'image',
    props: {
      backgroundColor: 'default',
      textAlignment: 'center',
      name: 'SPACE taxonomy',
      url: asset.logicalUrl,
      caption: 'The SPACE taxonomy and reference loop.',
      figureId: 'figure:space-taxonomy',
      altText: 'SPACE taxonomy diagram',
      showPreview: true,
      previewWidth: 960
    },
    children: []
  }
  const sourceSaved = await value.persistence.save({
    projectSessionId,
    sectionId: opened.section.sectionId,
    baseRevisionId: opened.revision.sectionRevisionId,
    baseContentHash: opened.revision.contentHash,
    document: [imageBlock, paragraph('background-body', 'Background text.')]
  })
  const targetSection = value.manuscript.createSection({
    baseOutlineVersion: value.manuscript.getWorkspace().outlineVersion,
    title: 'Scope, Reference Loop, and the SPACE Taxonomy',
    parentSectionId: null,
    position: 1
  })
  const targetBase = value.manuscript.getRevision(targetSection.currentRevisionId)
  const targetAnchor = paragraph('scope-third-paragraph', 'Third paragraph.')
  await value.persistence.save({
    projectSessionId,
    sectionId: targetSection.sectionId,
    baseRevisionId: targetBase.sectionRevisionId,
    baseContentHash: targetBase.contentHash,
    document: [targetAnchor]
  })
  const sourceSection = value.manuscript.getSection(opened.section.sectionId)
  const currentTargetSection = value.manuscript.getSection(targetSection.sectionId)
  const imageHash = createHash('sha256').update(JSON.stringify(imageBlock)).digest('hex')
  seedReadSectionResult(value.database, {
    section: sourceSection,
    revision: sourceSaved.revision,
    block: imageBlock,
    blockHash: imageHash
  })
  const contextBuilder = new AgentContextBuilder(value.manuscript)
  const snapshot = contextBuilder.capture('space-relocation-snapshot', {
    activeSectionId: targetSection.sectionId,
    activeBlockId: targetAnchor.id,
    selectedBlockIds: [targetAnchor.id]
  })
  return {
    ...value,
    assetId: asset.assetId,
    sourceSection,
    targetSection: currentTargetSection,
    imageBlock,
    imageHash,
    targetAnchor,
    targetAnchorHash: createHash('sha256').update(JSON.stringify(targetAnchor)).digest('hex'),
    contextBuilder,
    snapshot
  }
}

function submitExistingImage(
  tools: MainAgentTools,
  value: Awaited<ReturnType<typeof imageRelocationFixture>>
) {
  return tools.execute({
    toolName: 'submit_section_change',
    args: {
      sectionId: value.targetSection.sectionId,
      operations: [
        {
          type: 'insertExistingImage',
          source: {
            sectionId: value.sourceSection.sectionId,
            blockId: value.imageBlock.id,
            expectedBlockHash: value.imageHash
          },
          anchor: null,
          placement: 'end'
        }
      ]
    },
    editorContext: value.snapshot.editorContext,
    snapshot: value.snapshot,
    ...value.toolCall('submit_section_change')
  })
}

function seedReadSectionResult(
  database: ProjectDatabase,
  input: {
    section: ReturnType<ManuscriptService['getSection']>
    revision: ReturnType<ManuscriptService['getRevision']>
    block: BlockNoteDocument[number]
    blockHash: string
  }
): void {
  const payload = {
    toolCallId: 'read-source-image',
    toolName: 'read_section',
    contractVersion: 8,
    isError: false,
    result: {
      section: {
        sectionId: input.section.sectionId,
        parentSectionId: input.section.parentSectionId,
        position: input.section.position,
        level: input.section.level,
        title: input.section.title,
        objective: input.section.objective,
        status: input.section.status,
        currentRevisionId: input.section.currentRevisionId,
        wordCount: input.revision.wordCount,
        characterCount: input.revision.characterCount
      },
      revisionId: input.revision.sectionRevisionId,
      blocks: [
        {
          blockId: input.block.id,
          blockType: input.block.type,
          parentBlockId: null,
          depth: 0,
          ordinal: 0,
          text: '',
          textTruncated: false,
          blockHash: input.blockHash,
          childBlockIds: input.block.children.map((child) => child.id),
          hasRichContent: true
        }
      ],
      canonicalBlock: null,
      canonicalFragment: null,
      fragmentOffset: null,
      nextFragmentOffset: null,
      missingBlockIds: [],
      nextCursor: null,
      totalBlocks: 2
    },
    error: null,
    citationIds: [],
    knowledgeItemIds: [],
    parseRevisionIds: [],
    timestamp: 1
  }
  database.immediate((native) =>
    native
      .prepare(
        `INSERT INTO agent_events (
           agent_event_id, agent_session_id, agent_run_id, sequence, type,
           payload_json, model_request_id, created_at
         ) VALUES (?, ?, ?, 900, 'tool_result', ?, ?, ?)`
      )
      .run(
        '019d0000-0000-4000-8000-000000000900',
        agentSessionId,
        agentRunId,
        JSON.stringify(payload),
        modelRequestId,
        '2026-07-21T00:00:00.000Z'
      )
  )
}

function currentContent(
  value: Awaited<ReturnType<typeof fixture>>,
  sectionId: string
): BlockNoteDocument {
  const section = value.manuscript.getSection(sectionId)
  return value.manuscript.getRevision(section.currentRevisionId).content
}

function isImage(block: BlockNoteDocument[number]): boolean {
  return block.type === 'image'
}

const imageModelRequestId = '019c6a5c-8d34-4a8e-a602-3d37a52dc799'

function seedImageModelRequest(
  database: ProjectDatabase,
  requestId: string = imageModelRequestId
): void {
  const now = '2026-07-21T00:00:00.000Z'
  database.immediate((native) =>
    native
      .prepare(
        `INSERT INTO model_requests (
           model_request_id, operation_kind, provider_id, model_id, provider_fingerprint,
           request_fingerprint, status, attempt_count, retry_count, input_tokens, output_tokens,
           cache_read_tokens, cache_write_tokens, input_items, output_items,
           estimated_cost_usd_micros, usage_json, response_ids_json, error_json,
           operation_id, job_id, agent_run_id, started_at, completed_at, duration_ms,
           created_at, updated_at
         ) VALUES (?, 'image', 'google-gemini', 'gemini-3.1-flash-image', ?, ?, 'succeeded',
                   1, 0, 10, 20, NULL, NULL, 1, 1, NULL, '{}', '["gemini-response"]', NULL,
                   'image-operation', NULL, ?, ?, ?, 1, ?, ?)`
      )
      .run(requestId, 'c'.repeat(64), 'd'.repeat(64), agentRunId, now, now, now, now)
  )
}

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
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
