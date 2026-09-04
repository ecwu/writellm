import { describe, expect, it } from 'vitest'
import type { BibliographyImportPlan } from '../../../../shared/contracts/references'
import { referenceImportNeedsAttention } from './knowledge-manager'

type PlanItem = BibliographyImportPlan['items'][number]

const baseItem: PlanItem = {
  candidateId: 'a'.repeat(64),
  upstreamKey: 'compact2026',
  proposedCitationKey: 'compact2026',
  title: 'A Compact Reference Import',
  authors: ['Zhenghao Wu'],
  containerTitle: 'WriteLLM Studies',
  issuedYear: 2026,
  alreadyImportedReferenceId: null,
  attachmentCount: 1,
  pdfStatus: 'available',
  attachments: [
    {
      attachmentId: '11111111-1111-4111-8111-111111111111',
      candidateId: 'a'.repeat(64),
      fileName: 'compact.pdf',
      byteSize: 1024
    }
  ],
  nextAttachmentCursor: null
}

describe('Reference import review grouping', () => {
  it('keeps a single PDF in the compact ready-to-import group', () => {
    expect(referenceImportNeedsAttention(baseItem)).toBe(false)
  })

  it('treats missing PDFs as a ready citation-only outcome', () => {
    expect(
      referenceImportNeedsAttention({
        ...baseItem,
        attachmentCount: 0,
        pdfStatus: 'unavailable',
        attachments: []
      })
    ).toBe(false)
  })

  it('puts multiple or not-yet-fully-loaded PDFs in needs-attention', () => {
    expect(
      referenceImportNeedsAttention({
        ...baseItem,
        attachmentCount: 2,
        attachments: [
          ...baseItem.attachments,
          {
            attachmentId: '22222222-2222-4222-8222-222222222222',
            candidateId: baseItem.candidateId,
            fileName: 'supplement.pdf',
            byteSize: 2048
          }
        ]
      })
    ).toBe(true)
    expect(
      referenceImportNeedsAttention({
        ...baseItem,
        nextAttachmentCursor: '33333333-3333-4333-8333-333333333333'
      })
    ).toBe(true)
  })
})
