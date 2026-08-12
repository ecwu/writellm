import { describe, expect, it } from 'vitest'
import {
  SKILL_MAX_ENTRYPOINT_BYTES,
  SKILL_MAX_PROGRESSIVE_REFERENCE_BYTES
} from '../../shared/contracts/skills'
import { CURATED_SKILL_CATALOG, validateCuratedSkillCatalog } from './catalog'

describe('curated writing skill catalog', () => {
  it('is commit- and blob-anchored to reviewed text allowlists', () => {
    expect(() => validateCuratedSkillCatalog()).not.toThrow()
    expect(CURATED_SKILL_CATALOG.map((entry) => entry.skillId)).toEqual([
      'nature-writing',
      'ccf-humanization',
      'ccf-paper-writer',
      'ccf-visual-composer',
      'ccf-paper-reviewer',
      'ccf-integrity-auditor',
      'nature-statistics'
    ])
    for (const entry of CURATED_SKILL_CATALOG) {
      expect(entry.commit).toMatch(/^[a-f0-9]{40}$/)
      expect(entry.files[0]?.path).toBe('SKILL.md')
      for (const file of entry.files) {
        expect(file.path).toMatch(/\.(?:md|txt)$/i)
        expect(file.gitBlobSha).toMatch(/^[a-f0-9]{40}$/)
        expect(file.byteSize).toBeGreaterThan(0)
        expect(file.byteSize).toBeLessThanOrEqual(
          file.path === 'SKILL.md'
            ? SKILL_MAX_ENTRYPOINT_BYTES
            : SKILL_MAX_PROGRESSIVE_REFERENCE_BYTES
        )
      }
    }
    expect(
      CURATED_SKILL_CATALOG.find((entry) => entry.skillId === 'ccf-paper-writer')?.dependencies
    ).toEqual(['ccf-humanization'])
    expect(
      CURATED_SKILL_CATALOG.filter((entry) =>
        [
          'ccf-visual-composer',
          'ccf-paper-reviewer',
          'ccf-integrity-auditor',
          'nature-statistics'
        ].includes(entry.skillId)
      ).every((entry) => entry.dependencies.length === 0)
    ).toBe(true)
  })
})
