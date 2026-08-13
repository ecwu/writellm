import { describe, expect, it, vi } from 'vitest'
import type { ManuscriptAssembly, SectionRevision } from '../../shared/contracts/manuscript'
import { manuscriptReplacementPlanInputSchema } from '../../shared/contracts/manuscript-replacement'
import { ManuscriptReplacementService } from './manuscript-replacement-service'
import type { EditorPersistenceService } from './editor-persistence-service'
import type { ManuscriptService } from './manuscript-service'

describe('ManuscriptReplacementService', () => {
  it('creates a complete plan with eligible and fixed skipped candidates', async () => {
    const { service } = harness()
    const result = await service.createPlan(input(), new AbortController().signal)
    expect(result).toMatchObject({
      status: 'ready',
      candidateCount: 4,
      eligibleCount: 1,
      skippedCount: 3,
      sectionCount: 1
    })
    if (result.status !== 'ready') throw new Error('Expected ready plan')
    expect(result.candidates.map((candidate) => candidate.skipReason)).toEqual([
      'section_metadata',
      'section_metadata',
      null,
      'readable_citation'
    ])
  })

  it('fails closed for tampered paging and distinguishes expired plans', async () => {
    let now = new Date('2026-08-12T00:00:00.000Z')
    const { service } = harness({ now: () => now })
    const result = await service.createPlan(input(), new AbortController().signal)
    if (result.status !== 'ready') throw new Error('Expected ready plan')
    expect(
      service.page({
        projectSessionId: 'session',
        planId: result.planId,
        cursor: 'tampered',
        limit: 25
      })
    ).toEqual({ status: 'invalid_plan' })
    now = new Date('2026-08-12T00:16:00.000Z')
    expect(service.page({ projectSessionId: 'session', planId: result.planId, limit: 25 })).toEqual(
      { status: 'expired_plan' }
    )
  })

  it('applies one selection idempotently, materializes it, and issues guarded Undo', async () => {
    const { service, manuscript, persistence } = harness()
    const plan = await service.createPlan(input(), new AbortController().signal)
    if (plan.status !== 'ready') throw new Error('Expected ready plan')
    const candidate = plan.candidates.find((item) => item.eligible)
    if (candidate === undefined) throw new Error('Missing eligible candidate')
    const commandId = crypto.randomUUID()
    const applyInput = {
      projectSessionId: 'session',
      planId: plan.planId,
      candidateIds: [candidate.candidateId],
      commandId,
      createCheckpoint: false
    }
    const applied = await service.apply(applyInput, false)
    expect(applied).toMatchObject({ status: 'applied', selectedCount: 1 })
    expect(manuscript.applyReplacementBatch).toHaveBeenCalledOnce()
    expect(persistence.materialize).toHaveBeenCalledOnce()
    expect(await service.apply(applyInput, false)).toMatchObject({ status: 'already_applied' })
    expect(manuscript.applyReplacementBatch).toHaveBeenCalledOnce()
    if (applied.status !== 'applied') throw new Error('Expected applied receipt')
    const capability = applied.affectedSections[0]?.undoCapability
    if (capability === undefined) throw new Error('Missing undo capability')
    expect(await service.undo(capability)).toMatchObject({ status: 'undone', sectionId: 'section' })
    expect(await service.undo(capability)).toEqual({ status: 'already_undone' })
  })
})

function harness(options: { now?: () => Date } = {}) {
  const revision = nextRevision()
  const manuscript = {
    assemble: vi.fn(() => assembly()),
    applyReplacementBatch: vi.fn(() => ({ revisions: [revision], transactionDurationMs: 2 })),
    undoReplacementRevision: vi.fn(() => ({
      ...revision,
      sectionRevisionId: 'undo',
      source: 'undo'
    }))
  }
  const persistence = { materialize: vi.fn(async () => undefined) }
  const service = new ManuscriptReplacementService({
    manuscript: manuscript as unknown as ManuscriptService,
    editorPersistence: persistence as unknown as EditorPersistenceService,
    log: { info: vi.fn(), error: vi.fn() },
    now: options.now,
    yieldToMain: async () => undefined
  })
  return { service, manuscript, persistence }
}

function input() {
  return manuscriptReplacementPlanInputSchema.parse({
    projectSessionId: 'session',
    query: 'alpha',
    replacement: 'beta',
    caseSensitive: false,
    scope: { type: 'manuscript' },
    statuses: []
  })
}

function assembly(): ManuscriptAssembly {
  return {
    manuscriptId: 'manuscript',
    outlineVersion: 1,
    brief: {
      manuscriptBriefId: 'brief',
      manuscriptId: 'manuscript',
      version: 1,
      schemaVersion: 1,
      title: 'Book',
      description: '',
      topic: '',
      targetAudience: '',
      language: '',
      styleTone: '',
      scopeExclusions: '',
      targetLength: '',
      citationRequirements: '',
      additionalInstructions: '',
      extensible: {},
      createdAt: '2026-08-12T00:00:00.000Z'
    },
    sections: [
      {
        section: {
          sectionId: 'section',
          manuscriptId: 'manuscript',
          parentSectionId: null,
          position: 0,
          level: 1,
          title: 'Alpha',
          objective: 'Alpha objective',
          status: 'drafting',
          currentRevisionId: 'revision',
          createdAt: '2026-08-12T00:00:00.000Z',
          updatedAt: '2026-08-12T00:00:00.000Z'
        },
        revision: nextRevision()
      }
    ],
    wordCount: 5,
    characterCount: 40
  }
}

function nextRevision(): SectionRevision {
  return {
    sectionRevisionId: 'revision-next',
    sectionId: 'section',
    revisionNumber: 2,
    source: 'manual',
    sourceClass: 'manual_checkpoint',
    content: [
      {
        id: 'paragraph',
        type: 'paragraph',
        props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
        content: [{ type: 'text', text: 'Alpha body [Source: Alpha]', styles: {} }],
        children: []
      }
    ],
    contentSchemaVersion: 3,
    contentHash: 'a'.repeat(64),
    priorRevisionId: 'revision',
    wordCount: 5,
    characterCount: 27,
    countAlgorithmVersion: 2,
    agentRunId: null,
    agentToolCallId: null,
    agentProposalId: null,
    createdAt: '2026-08-12T00:00:00.000Z'
  }
}
