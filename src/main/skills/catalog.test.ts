import { describe, expect, it } from 'vitest'
import { CURATED_SKILL_CATALOG, validateCuratedSkillCatalog } from './catalog'

describe('curated writing skill catalog', () => {
  it('is commit- and blob-anchored to reviewed text allowlists', () => {
    expect(() => validateCuratedSkillCatalog()).not.toThrow()
    expect(CURATED_SKILL_CATALOG.map((entry) => entry.skillId)).toEqual([
      'nature-writing',
      'ccf-humanization',
      'ccf-paper-writer'
    ])
    for (const entry of CURATED_SKILL_CATALOG) {
      expect(entry.commit).toMatch(/^[a-f0-9]{40}$/)
      expect(entry.files[0]?.path).toBe('SKILL.md')
      for (const file of entry.files) {
        expect(file.path).toMatch(/\.(?:md|txt)$/i)
        expect(file.gitBlobSha).toMatch(/^[a-f0-9]{40}$/)
        expect(file.byteSize).toBeGreaterThan(0)
      }
    }
    expect(
      CURATED_SKILL_CATALOG.find((entry) => entry.skillId === 'ccf-paper-writer')?.dependencies
    ).toEqual(['ccf-humanization'])
  })
})
