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
  it('retains the 500 metadata-only boundary and limits PDF review to 50 references', () => {
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
        candidateIds: candidateIds(50),
        includePdf: true
      }).success
    ).toBe(true)
    expect(
      bibliographyPrepareImportInputSchema.safeParse({
        projectSessionId,
        connectorId,
        candidateIds: candidateIds(51),
        includePdf: true
      }).success
    ).toBe(false)
  })

  it('rejects duplicate targets, duplicate candidates, supplements without a primary, and over 50 PDFs', () => {
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
    expect(
      bibliographyConfirmImportInputSchema.safeParse({
        projectSessionId,
        previewId,
        selections: [
          {
            ...selection,
            supplementAttachmentIds: Array.from(
              { length: 50 },
              (_, index) => `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString().padStart(12, '0')}`
            )
          }
        ]
      }).success
    ).toBe(false)
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
