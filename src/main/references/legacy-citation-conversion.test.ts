import { describe, expect, it } from 'vitest'
import type { ReferenceItem } from '../../shared/contracts/references'
import { convertLegacyCitations, planLegacyCitationConversion } from './legacy-citation-conversion'

describe('legacy citation conversion', () => {
  it('plans only unique exact title matches and keeps ambiguous/unmatched entries closed', () => {
    const result = planLegacyCitationConversion(
      {
        outlineVersion: 1,
        entries: [
          { number: 1, title: 'Unique', count: 1, occurrences: [occurrence('Unique')] },
          { number: 2, title: 'Duplicate', count: 1, occurrences: [occurrence('Duplicate')] },
          { number: 3, title: 'Missing', count: 1, occurrences: [occurrence('Missing')] }
        ]
      },
      [reference('u', 'Unique'), reference('d1', 'Duplicate'), reference('d2', 'Duplicate')]
    )
    expect(result.replacements).toEqual([{ title: 'Unique', citationKey: 'u', occurrenceCount: 1 }])
    expect(result.ambiguousTitles).toEqual(['Duplicate'])
    expect(result.unmatchedTitles).toEqual(['Missing'])
  })

  it('converts English and Chinese locators without touching unmatched prose', () => {
    const content = [
      {
        id: 'block',
        type: 'paragraph' as const,
        props: {},
        content: [
          {
            type: 'text' as const,
            text: '[Source: Paper, p. 2] / 【来源：论文，第 3 页】 [Source: Missing]',
            styles: {}
          }
        ],
        children: []
      }
    ]
    const converted = convertLegacyCitations(
      content,
      new Map([
        ['Paper', 'paper-key'],
        ['论文', 'cn-key']
      ])
    )
    expect(converted[0]?.content).toEqual([
      expect.objectContaining({
        text: '[@paper-key, p. 2] / 【@cn-key，第 3 页】 [Source: Missing]'
      })
    ])
  })
})

function occurrence(title: string) {
  return {
    sectionId: crypto.randomUUID(),
    sectionRevisionId: crypto.randomUUID(),
    blockId: 'block',
    ordinal: 0,
    raw: `[Source: ${title}]`,
    syntax: 'english' as const,
    title
  }
}

function reference(citationKey: string, title: string): ReferenceItem {
  const now = '2026-08-31T00:00:00.000Z'
  return {
    referenceId: crypto.randomUUID(),
    citationKey,
    cslType: 'article',
    title,
    containerTitle: null,
    issuedYear: null,
    doi: null,
    isbn: null,
    url: null,
    csl: { id: citationKey, type: 'article', title },
    creators: [],
    metadataCompleteness: 'partial',
    syncStatus: 'unbound',
    evidenceAvailable: false,
    knowledgeItemIds: [],
    createdAt: now,
    updatedAt: now
  }
}
