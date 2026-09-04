import { describe, expect, it } from 'vitest'
import {
  bibliographyConfirmImportInputSchema,
  bibliographyPrepareImportInputSchema,
  referenceSearchCandidateSchema,
  referenceSearchInputSchema,
  referenceSearchResultSchema
} from './references'

const projectSessionId = '11111111-1111-4111-8111-111111111111'
const connectorId = '22222222-2222-4222-8222-222222222222'
const previewId = '33333333-3333-4333-8333-333333333333'
const candidateIds = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => index.toString(16).padStart(64, '0'))

describe('unified bibliography import contracts', () => {
  it('uses the same 500-candidate boundary for metadata-only and PDF review', () => {
    expect(
      bibliographyPrepareImportInputSchema.safeParse({
        projectSessionId,
        connectorId,
        candidateIds: candidateIds(500),
        includePdf: false
      }).success
    ).toBe(true)
    expect(
      bibliographyPrepareImportInputSchema.safeParse({
        projectSessionId,
        connectorId,
        candidateIds: candidateIds(501),
        includePdf: false
      }).success
    ).toBe(false)
    expect(
      bibliographyPrepareImportInputSchema.safeParse({
        projectSessionId,
        connectorId,
        candidateIds: candidateIds(500),
        includePdf: true
      }).success
    ).toBe(true)
    expect(
      bibliographyPrepareImportInputSchema.safeParse({
        projectSessionId,
        connectorId,
        candidateIds: candidateIds(501),
        includePdf: true
      }).success
    ).toBe(false)
  })

  it('rejects duplicate targets, duplicate candidates, and supplements without a primary', () => {
    const candidateId = candidateIds(1)[0]
    const targetReferenceId = '44444444-4444-4444-8444-444444444444'
    const primaryAttachmentId = '55555555-5555-4555-8555-555555555555'
    const selection = {
      candidateId,
      targetReferenceId,
      primaryAttachmentId,
      supplementAttachmentIds: []
    }
    expect(
      bibliographyConfirmImportInputSchema.safeParse({
        projectSessionId,
        previewId,
        selections: [selection, selection]
      }).success
    ).toBe(false)
    expect(
      bibliographyConfirmImportInputSchema.safeParse({
        projectSessionId,
        previewId,
        selections: [
          {
            ...selection,
            primaryAttachmentId: null,
            supplementAttachmentIds: [primaryAttachmentId]
          }
        ]
      }).success
    ).toBe(false)
  })

  it('confirms up to 500 references regardless of PDF selection', () => {
    const selections = candidateIds(500).map((candidateId, index) => ({
      candidateId,
      targetReferenceId: null,
      primaryAttachmentId: `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString().padStart(12, '0')}`,
      supplementAttachmentIds: []
    }))
    expect(
      bibliographyConfirmImportInputSchema.safeParse({ projectSessionId, previewId, selections })
        .success
    ).toBe(true)
    expect(
      bibliographyConfirmImportInputSchema.safeParse({
        projectSessionId,
        previewId,
        selections: [...selections, { ...selections[0], candidateId: 'f'.repeat(64) }]
      }).success
    ).toBe(false)
  })

  it('allows more than 49 supplemental attachments within the byte-bounded confirmation', () => {
    expect(
      bibliographyConfirmImportInputSchema.safeParse({
        projectSessionId,
        previewId,
        selections: [
          {
            candidateId: candidateIds(1)[0],
            targetReferenceId: null,
            primaryAttachmentId: '55555555-5555-4555-8555-555555555555',
            supplementAttachmentIds: Array.from(
              { length: 75 },
              (_, index) => `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString().padStart(12, '0')}`
            )
          }
        ]
      }).success
    ).toBe(true)
  })
})

describe('Reference search contracts', () => {
  it('accepts a bounded search request and compact candidate result', () => {
    expect(referenceSearchInputSchema.parse({ projectSessionId, query: '  Attention  ' })).toEqual({
      projectSessionId,
      query: 'Attention'
    })
    const candidate = referenceSearchCandidateSchema.parse({
      referenceId: connectorId,
      citationKey: 'attention2026',
      title: 'Attention',
      authors: ['A. Author'],
      issuedYear: 2026
    })
    expect(referenceSearchResultSchema.parse({ items: [candidate], hasReferences: true })).toEqual({
      items: [candidate],
      hasReferences: true
    })
  })

  it('rejects oversized queries, author projections, and result lists', () => {
    expect(
      referenceSearchInputSchema.safeParse({
        projectSessionId,
        query: 'x'.repeat(513)
      }).success
    ).toBe(false)
    const oversizedAuthors = Array.from({ length: 21 }, () => 'Author')
    expect(
      referenceSearchCandidateSchema.safeParse({
        referenceId: connectorId,
        citationKey: 'attention2026',
        title: 'Attention',
        authors: oversizedAuthors,
        issuedYear: null
      }).success
    ).toBe(false)
    const candidate = {
      referenceId: connectorId,
      citationKey: 'attention2026',
      title: 'Attention',
      authors: [],
      issuedYear: null
    }
    expect(
      referenceSearchResultSchema.safeParse({
        items: [candidate, candidate, candidate, candidate],
        hasReferences: true
      }).success
    ).toBe(false)
  })
})
