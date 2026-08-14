import { describe, expect, it } from 'vitest'
import type { AgentApprovalMode } from '../../shared/contracts/agent'
import type { MutationProposalRecord } from '../../shared/contracts/agent-mutations'
import { MainAgentTools } from './tools'

const PROPOSAL_KINDS = ['brief_update', 'outline_patch', 'section_patch', 'generated_image_insert']

function toolsWithProposal(kind: string): MainAgentTools {
  const proposal = { proposalId: 'proposal-1', payload: { kind } } as MutationProposalRecord
  const mutations = { list: () => [proposal] }
  return new MainAgentTools({ contextBuilder: () => null } as never, mutations as never)
}

describe('Agent approval policy', () => {
  it.each(PROPOSAL_KINDS)('manual mode reviews every %s proposal', (kind) => {
    expect(toolsWithProposal(kind).shouldAutoApprove('session-1', 'proposal-1', 'manual')).toBe(
      false
    )
  })

  it.each([
    'outline_patch',
    'section_patch',
    'generated_image_insert'
  ])('write auto mode applies every %s proposal without size or operation limits', (kind) => {
    expect(
      toolsWithProposal(kind).shouldAutoApprove('session-1', 'proposal-1', 'section_auto')
    ).toBe(true)
  })

  it('write auto mode still reviews Brief and Writing Rules proposals', () => {
    expect(
      toolsWithProposal('brief_update').shouldAutoApprove('session-1', 'proposal-1', 'section_auto')
    ).toBe(false)
  })

  it.each(PROPOSAL_KINDS)('yolo mode applies every %s proposal including Brief changes', (kind) => {
    expect(toolsWithProposal(kind).shouldAutoApprove('session-1', 'proposal-1', 'yolo')).toBe(true)
  })

  it.each([
    'manual',
    'section_auto',
    'yolo'
  ] satisfies AgentApprovalMode[])('never auto-approves an unknown proposal in %s mode', (mode) => {
    expect(toolsWithProposal('section_patch').shouldAutoApprove('session-1', 'missing', mode)).toBe(
      false
    )
  })
})
