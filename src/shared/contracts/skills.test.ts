import { describe, expect, it } from 'vitest'
import { skillRunSnapshotSchema } from './skills'

const commit = 'a'.repeat(40)
const manifestSha256 = 'b'.repeat(64)

describe('Writing Skill composition contracts', () => {
  it('normalizes a v1 run snapshot into immutable v2 provenance and resources', () => {
    expect(
      skillRunSnapshotSchema.parse({
        mode: 'explicit',
        routingStatus: 'selected',
        primary: {
          skillId: 'nature-writing',
          name: 'nature-writing',
          commit,
          manifestSha256
        },
        dependencies: [],
        resources: ['references/method.md'],
        safeError: null
      })
    ).toEqual({
      schemaVersion: 2,
      mode: 'explicit',
      routingStatus: 'selected',
      skills: [
        {
          skillId: 'nature-writing',
          displayName: 'nature-writing',
          name: 'nature-writing',
          commit,
          manifestSha256
        }
      ],
      dependencies: [],
      resources: [
        {
          skillId: 'nature-writing',
          commit,
          relativePath: 'references/method.md',
          sha256: null,
          byteSize: null
        }
      ],
      safeError: null
    })
  })
})
