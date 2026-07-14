import { describe, expect, it } from 'vitest'
import { parseProjectManifest } from './project-manifest'

const validManifest = {
  format: 'writellm-project',
  formatVersion: 1,
  projectId: '019c6a5c-8d34-7a8e-a602-3d37a52dc001',
  createdAt: '2026-07-14T00:00:00.000Z'
}

describe('project manifest', () => {
  it('validates the supported manifest', () => {
    expect(parseProjectManifest(validManifest)).toEqual(validManifest)
  })

  it('rejects unsupported versions', () => {
    expect(() => parseProjectManifest({ ...validManifest, formatVersion: 2 })).toThrow(
      'Unsupported project format version 2'
    )
  })

  it.each([
    { ...validManifest, format: 'other' },
    { ...validManifest, projectId: 'not-a-uuid' },
    { ...validManifest, createdAt: 'yesterday' },
    { ...validManifest, extra: true }
  ])('rejects malformed manifest %#', (value) => {
    expect(() => parseProjectManifest(value)).toThrow()
  })
})
