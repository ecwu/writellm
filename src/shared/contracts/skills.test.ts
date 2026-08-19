import { describe, expect, it } from 'vitest'
import { skillRunSnapshotSchema } from './skills'

const commit = 'a'.repeat(40)
const manifestSha256 = 'b'.repeat(64)

describe('Writing Skill composition contracts', () => {
  it('normalizes a v1 run snapshot into immutable v3 provenance and resources', () => {
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
      schemaVersion: 3,
      mode: 'explicit',
      routingStatus: 'selected',
      requestedSkills: [
        {
          skillId: 'nature-writing',
          displayName: 'nature-writing',
          name: 'nature-writing',
          commit,
          manifestSha256
        }
      ],
      skills: [
        {
          skillId: 'nature-writing',
          displayName: 'nature-writing',
          name: 'nature-writing',
          commit,
          manifestSha256,
          invocationSource: 'user'
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

  it('upgrades v2 explicit and Auto snapshots with deterministic invocation sources', () => {
    const topLevel = {
      skillId: 'nature-writing',
      displayName: 'Nature Writing',
      name: 'nature-writing',
      commit,
      manifestSha256
    }
    expect(
      skillRunSnapshotSchema.parse({
        schemaVersion: 2,
        mode: 'explicit',
        routingStatus: 'selected',
        skills: [topLevel],
        dependencies: [],
        resources: [],
        safeError: null
      })
    ).toMatchObject({
      schemaVersion: 3,
      requestedSkills: [topLevel],
      skills: [{ ...topLevel, invocationSource: 'user' }]
    })
    expect(
      skillRunSnapshotSchema.parse({
        schemaVersion: 2,
        mode: 'auto',
        routingStatus: 'selected',
        skills: [topLevel],
        dependencies: [],
        resources: [],
        safeError: null
      })
    ).toMatchObject({
      schemaVersion: 3,
      requestedSkills: [],
      skills: [{ ...topLevel, invocationSource: 'agent' }]
    })
  })
})
