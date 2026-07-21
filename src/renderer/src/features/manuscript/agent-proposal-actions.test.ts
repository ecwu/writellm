import { describe, expect, it, vi } from 'vitest'
import type {
  MutationProposalActionResult,
  MutationProposalRecord
} from '../../../../shared/contracts/agent-mutations'
import { approveProposalAfterEditorFlush } from './agent-proposal-actions'

describe('Agent proposal approval sequencing', () => {
  it('flushes the active target section before sending approval', async () => {
    const order: string[] = []
    const result = await approveProposalAfterEditorFlush({
      proposal: proposal(),
      activeSectionId: sectionId,
      flushCurrent: vi.fn(async () => {
        order.push('flush')
        return true
      }),
      approve: vi.fn(async () => {
        order.push('approve')
        return actionResult
      })
    })
    expect(order).toEqual(['flush', 'approve'])
    expect(result).toBe(actionResult)
  })

  it('does not approve when the editor flush fails', async () => {
    const approve = vi.fn(async () => actionResult)
    const result = await approveProposalAfterEditorFlush({
      proposal: proposal(),
      activeSectionId: sectionId,
      flushCurrent: vi.fn(async () => false),
      approve
    })
    expect(result).toBeNull()
    expect(approve).not.toHaveBeenCalled()
  })
})

const sectionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc801'
const proposalId = '019c6a5c-8d34-7a8e-a602-3d37a52dc802'
const now = '2026-07-21T00:00:00.000Z'

function proposal(): MutationProposalRecord {
  return {
    proposalId,
    agentSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc803',
    agentRunId: '019c6a5c-8d34-7a8e-a602-3d37a52dc804',
    agentToolCallId: 'tool-call',
    kind: 'section_patch',
    payload: {
      schemaVersion: 1,
      kind: 'section_patch',
      mutation: {
        schemaVersion: 1,
        sectionId,
        baseRevisionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc805',
        operations: [
          {
            type: 'insertBlocks',
            anchorBlockId: null,
            placement: 'end',
            blocks: [
              {
                id: 'block',
                type: 'paragraph',
                props: {},
                content: [],
                children: []
              }
            ]
          }
        ],
        citationIds: []
      },
      preview: {
        summary: 'Insert block',
        affectedSectionIds: [sectionId],
        beforeText: '',
        afterText: 'block',
        beforeTextTruncated: false,
        afterTextTruncated: false,
        citedSources: []
      },
      provenance: {
        modelRequestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc806',
        citedSources: []
      }
    },
    status: 'pending',
    decisionAt: null,
    appliedRevisionId: null,
    appliedBriefVersion: null,
    appliedOutlineVersion: null,
    undoRevisionId: null,
    rejectedReason: null,
    createdAt: now,
    updatedAt: now
  }
}

const actionResult = {
  proposal: proposal(),
  sectionChanged: null
} satisfies MutationProposalActionResult
