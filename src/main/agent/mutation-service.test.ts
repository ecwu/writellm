import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BlockNoteDocument } from '../../shared/contracts/manuscript'
import { ManuscriptAssetService } from '../manuscript/asset-service'
import { EditorPersistenceService } from '../manuscript/editor-persistence-service'
import { ManuscriptService } from '../manuscript/manuscript-service'
import { initializeProjectDatabase, type ProjectDatabase } from '../project/project-database'
import type { ProjectManifest } from '../project/project-manifest'
import { MutationProposalError, MutationProposalService } from './mutation-service'
import { AgentToolDomainError } from './read-tools'
import { AgentContextBuilder } from './context'

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
  }, 15_000)

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

  it('rejects a stale image base before calling the billable gateway', async () => {
    const value = await fixture()
    const opened = value.persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const snapshot = new AgentContextBuilder(value.manuscript).capture('stale-image-snapshot', {
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
    await value.persistence.save({
      projectSessionId,
      sectionId: opened.section.sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash,
      document: [paragraph('new-base', 'Changed before approval')]
    })
    await expect(
      service.approve({ projectSessionId, agentSessionId, proposalId: proposed.proposalId })
    ).rejects.toMatchObject({ code: 'stale_base' })
    expect(generateImage).not.toHaveBeenCalled()
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
    projectRoot,
    database,
    manuscript,
    persistence,
    manifest,
    service,
    toolCall(
      toolName:
        | 'submit_brief_change'
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

const imageModelRequestId = '019c6a5c-8d34-4a8e-a602-3d37a52dc799'

function seedImageModelRequest(database: ProjectDatabase): void {
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
      .run(imageModelRequestId, 'c'.repeat(64), 'd'.repeat(64), agentRunId, now, now, now, now)
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
