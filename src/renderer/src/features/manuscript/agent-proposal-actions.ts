import type {
  MutationProposalActionResult,
  MutationProposalRecord
} from '../../../../shared/contracts/agent-mutations'

export async function approveProposalAfterEditorFlush(input: {
  proposal: MutationProposalRecord
  activeSectionId: string | null
  flushCurrent(): Promise<boolean>
  approve(): Promise<MutationProposalActionResult>
}): Promise<MutationProposalActionResult | null> {
  const targetSectionIds = new Set<string>()
  if (input.proposal.payload.kind === 'section_patch') {
    targetSectionIds.add(input.proposal.payload.mutation.sectionId)
  } else if (input.proposal.payload.kind === 'outline_patch') {
    for (const operation of input.proposal.payload.mutation.operations) {
      if (operation.type === 'deleteSection') targetSectionIds.add(operation.sectionId)
    }
  }
  if (
    input.activeSectionId !== null &&
    targetSectionIds.has(input.activeSectionId) &&
    !(await input.flushCurrent())
  ) {
    return null
  }
  return input.approve()
}
