import { describe, expect, it } from 'vitest'
import { skillRunSnapshotSchema } from './skills'

const commit = 'a'.repeat(40)
const manifestSha256 = 'b'.repeat(64)

describe('Writing Skill composition contracts', () => {
  it('normalizes a v1 run snapshot into immutable v4 provenance and resources', () => {
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
      schemaVersion: 4,
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
      schemaVersion: 4,
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
      schemaVersion: 4,
      requestedSkills: [],
      skills: [{ ...topLevel, invocationSource: 'agent' }]
    })
  })

  it('normalizes an existing v3 snapshot without applying the former runtime caps', () => {
    const provenance = (index: number) => ({
      skillId: `skill-${index}`,
      displayName: `Skill ${index}`,
      name: `skill-${index}`,
      commit,
      manifestSha256
    })
    const skills = Array.from({ length: 5 }, (_, index) => ({
      ...provenance(index),
      invocationSource: 'agent' as const
    }))
    const dependencies = Array.from({ length: 9 }, (_, index) => provenance(index + 10))
    const resources = Array.from({ length: 13 }, (_, index) => ({
      skillId: `skill-${index % 5}`,
      commit,
      relativePath: `reference-${index + 1}.md`,
      sha256: manifestSha256,
      byteSize: 20
    }))

    expect(
      skillRunSnapshotSchema.parse({
        schemaVersion: 3,
        mode: 'auto',
        routingStatus: 'selected',
        requestedSkills: [],
        skills,
        dependencies,
        resources,
        safeError: null
      })
    ).toMatchObject({ schemaVersion: 4, skills, dependencies, resources })
  })

  it('enforces only the generic serialized snapshot byte bound', () => {
    const oversized = {
      schemaVersion: 4,
      mode: 'auto' as const,
      routingStatus: 'selected' as const,
      requestedSkills: [],
      skills: [],
      dependencies: [],
      resources: [],
      safeError: 'x'.repeat(2_100_000)
    }
    expect(() => skillRunSnapshotSchema.parse(oversized)).toThrow('generic byte bound')
  })
})
