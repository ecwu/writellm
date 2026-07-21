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
  const targetSectionId =
    input.proposal.payload.kind === 'section_patch'
      ? input.proposal.payload.mutation.sectionId
      : null
  if (
    targetSectionId !== null &&
    targetSectionId === input.activeSectionId &&
    !(await input.flushCurrent())
  ) {
    return null
  }
  return input.approve()
}
