import { describe, expect, it } from 'vitest'
import { findCitationClusters } from './citation-cluster'

describe('citation clusters', () => {
  it('parses English and Chinese clusters with one-based page locators', () => {
    expect(
      findCitationClusters('A [@smith2024, p. 12] B 【@smith2024；@lee2023，第 20–22 页】')
    ).toEqual([
      expect.objectContaining({
        syntax: 'english',
        items: [
          {
            citationKey: 'smith2024',
            locator: {
              label: 'page',
              startPageIndex: 11,
              endPageIndex: 11,
              raw: ', p. 12'
            }
          }
        ]
      }),
      expect.objectContaining({
        syntax: 'chinese',
        items: [
          { citationKey: 'smith2024' },
          {
            citationKey: 'lee2023',
            locator: {
              label: 'page',
              startPageIndex: 19,
              endPageIndex: 21,
              raw: '，第 20–22 页'
            }
          }
        ]
      })
    ])
  })

  it('keeps adjacent tokens as separate clusters and rejects malformed locators or keys', () => {
    expect(findCitationClusters('[@a][@b]')).toHaveLength(2)
    expect(findCitationClusters('[@a, p. 0] [@a, pp. 4-2] [@unsafe key]')).toEqual([])
  })

  it('preserves case-sensitive project keys', () => {
    expect(findCitationClusters('[@Smith2024; @smith2024]')[0]?.items).toEqual([
      { citationKey: 'Smith2024' },
      { citationKey: 'smith2024' }
    ])
  })
})
