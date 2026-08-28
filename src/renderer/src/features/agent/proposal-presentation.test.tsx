import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  MutationProposalRecord,
  ProposalPresentation as ProposalPresentationData
} from '../../../../shared/contracts/agent-mutations'
import { ProposalPresentation } from './proposal-presentation'

describe('ProposalPresentation', () => {
  it('renders Brief changes as named fields instead of a JSON diff', () => {
    const html = render(
      briefProposal({
        schemaVersion: 1,
        kind: 'brief_fields',
        fields: [
          {
            field: 'targetAudience',
            before: { text: 'Researchers', truncated: false },
            after: { text: 'Policy researchers', truncated: false }
          }
        ]
      })
    )

    expect(html).toContain('data-testid="brief-proposal-view"')
    expect(html).toContain('Target audience · Before')
    expect(html).toContain('Policy researchers')
    expect(html).not.toContain('agent-proposal-diff')
  })

  it('renders ordered Outline operations with resolved locations', () => {
    const html = render(
      outlineProposal({
        schemaVersion: 1,
        kind: 'outline_operations',
        operations: [
          {
            type: 'move',
            sectionId: 'section-2',
            title: 'Methods',
            before: {
              parentSectionId: null,
              parentTitle: null,
              position: 1
            },
            after: {
              parentSectionId: 'section-1',
              parentTitle: 'Research design',
              position: 0
            }
          }
        ]
      })
    )

    expect(html).toContain('data-testid="outline-proposal-view"')
    expect(html).toContain('Move “Methods”')
    expect(html).toContain('Top level · position 2')
    expect(html).toContain('Under “Research design” · position 1')
  })

  it('distinguishes Writing Rule removal from disabling a rule', () => {
    const baseRule = {
      ruleId: '019c6a5c-8d34-7a8e-a602-3d37a52dc750',
      category: 'translation' as const,
      instruction: 'Use the expanded term.',
      preferredForm: 'Large language model',
      discouragedForms: ['LLM'],
      rationale: null,
      active: true
    }
    const html = render(
      briefProposal({
        schemaVersion: 1,
        kind: 'writing_rules',
        changes: [
          {
            action: 'disable',
            ruleId: baseRule.ruleId,
            before: baseRule,
            after: { ...baseRule, active: false }
          },
          { action: 'remove', ruleId: baseRule.ruleId, before: baseRule, after: null }
        ]
      })
    )

    expect(html).toContain('data-testid="writing-rules-proposal-view"')
    expect(html).toContain('Disable')
    expect(html).toContain('Remove')
  })

  it('renders a bounded table diff with structure and changed cells', () => {
    const html = render(
      briefProposal({
        schemaVersion: 1,
        kind: 'table_diff',
        tables: [
          {
            blockId: 'table-1',
            beforeRows: 2,
            beforeColumns: 2,
            afterRows: 3,
            afterColumns: 2,
            structuralChanges: ['Rows: 2 → 3'],
            changedCells: [
              {
                row: 1,
                column: 0,
                before: { text: 'Old', truncated: false },
                after: { text: 'New', truncated: false }
              }
            ],
            truncated: true
          }
        ]
      })
    )

    expect(html).toContain('data-testid="table-diff-view"')
    expect(html).toContain('2×2 → 3×2')
    expect(html).toContain('R2C1')
    expect(html).toContain('Old')
    expect(html).toContain('New')
    expect(html).toContain('Table preview truncated')
  })

  it('falls back to the existing diff for proposals created before semantic presentations', () => {
    const html = render(briefProposal())

    expect(html).toContain('data-testid="legacy-proposal-view"')
    expect(html).toContain('Legacy preview')
  })
})

function render(proposal: MutationProposalRecord): string {
  return renderToStaticMarkup(
    <ProposalPresentation
      proposal={proposal}
      projectSessionId='019c6a5c-8d34-7a8e-a602-3d37a52dc701'
      sectionTitles={{}}
      dark={false}
    />
  )
}

function briefProposal(presentation?: ProposalPresentationData): MutationProposalRecord {
  return proposal('brief_update', presentation)
}

function outlineProposal(presentation: ProposalPresentationData): MutationProposalRecord {
  return proposal('outline_patch', presentation)
}

function proposal(
  kind: 'brief_update' | 'outline_patch',
  presentation?: ProposalPresentationData
): MutationProposalRecord {
  const mutation =
    kind === 'brief_update'
      ? {
          schemaVersion: 1 as const,
          manuscriptId: 'manuscript-1',
          baseBriefVersion: 1,
          changes: { title: 'After' },
          citationIds: []
        }
      : {
          schemaVersion: 1 as const,
          manuscriptId: 'manuscript-1',
          baseOutlineVersion: 1,
          operations: [
            {
              type: 'moveSection' as const,
              sectionId: 'section-2',
              parentSectionId: 'section-1',
              position: 0
            }
          ],
          citationIds: []
        }
  return {
    proposalId: '019c6a5c-8d34-7a8e-a602-3d37a52dc710',
    agentSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc711',
    agentRunId: '019c6a5c-8d34-7a8e-a602-3d37a52dc712',
    agentToolCallId: 'tool-call-1',
    kind,
    payload: {
      schemaVersion: 1,
      kind,
      mutation,
      preview: {
        summary: 'Proposal',
        affectedSectionIds: [],
        beforeText: 'Before',
        afterText: 'After',
        beforeTextTruncated: false,
        afterTextTruncated: false,
        citedSources: [],
        ...(presentation === undefined ? {} : { presentation })
      },
      provenance: {
        modelRequestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc713',
        citedSources: []
      }
    } as MutationProposalRecord['payload'],
    status: 'pending',
    decisionAt: null,
    appliedRevisionId: null,
    appliedBriefVersion: null,
    appliedOutlineVersion: null,
    undoRevisionId: null,
    replacesProposalId: null,
    rejectedReason: null,
    writingTaskId: null,
    writingTaskStepId: null,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z'
  }
}
