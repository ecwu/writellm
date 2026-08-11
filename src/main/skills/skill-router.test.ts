import { describe, expect, it, vi } from 'vitest'
import { SkillReadError, WritingSkillRuntime } from './skill-router'
import { virtualSkillPath, type WriteLlmSkill } from './prompt'
import type { SkillService } from './skill-service'

describe('Pi-native progressive Writing Skill routing', () => {
  it('publishes only Auto metadata, locks one primary, bundles dependencies, and caps references', async () => {
    const primary = skill('primary-method', 'Primary body', 5, ['support-method'])
    const other = skill('other-method', 'Other private body')
    const dependency = skill('support-method', 'Dependency body')
    const readResource = vi.fn(async (_skill: WriteLlmSkill, path: string) => `Reference ${path}`)
    const service = {
      loadEnabled: vi.fn(async () => [other, primary]),
      loadById: vi.fn(async (id: string) => {
        if (id === dependency.skillId) return dependency
        throw new Error('unknown skill')
      }),
      loadVersion: vi.fn(),
      readResource
    } as unknown as SkillService
    const router = new WritingSkillRuntime(service, {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })

    const routed = await router.route({
      selection: { mode: 'auto' },
      signal: new AbortController().signal
    })
    expect(routed.snapshot.routingStatus).toBe('available')
    expect(routed.prompt.mandatory).toContain(primary.description)
    expect(routed.prompt.mandatory).not.toContain('Primary body')
    expect(routed.prompt.mandatory).not.toContain('Other private body')
    if (routed.state === undefined) throw new Error('Missing progressive state')

    const selected = await router.read(routed.state, primary.filePath)
    expect(selected.snapshot).toMatchObject({
      routingStatus: 'selected',
      primary: { skillId: 'primary-method' },
      dependencies: [{ skillId: 'support-method' }]
    })
    expect(selected.data.content).toBe('Primary body')
    expect(selected.data.dependencies[0]?.content).toBe('Dependency body')
    expect(selected.data.references).toHaveLength(5)
    await expect(router.read(routed.state, other.filePath)).rejects.toBeInstanceOf(SkillReadError)

    for (const file of primary.files.filter((entry) => entry.path !== 'SKILL.md').slice(0, 4)) {
      await router.read(routed.state, virtualSkillPath(primary.skillId, primary.commit, file.path))
    }
    await expect(
      router.read(routed.state, virtualSkillPath(primary.skillId, primary.commit, 'reference-5.md'))
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(readResource).toHaveBeenCalledTimes(4)
  })

  it('injects an explicit session skill immediately without an auxiliary model call', async () => {
    const primary = skill('explicit-method', 'Always active')
    const service = {
      loadEnabled: vi.fn(),
      loadById: vi.fn(async () => primary),
      loadVersion: vi.fn(),
      readResource: vi.fn()
    } as unknown as SkillService
    const router = new WritingSkillRuntime(service, {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })

    const routed = await router.route({
      selection: { mode: 'explicit', skillId: primary.skillId },
      signal: new AbortController().signal
    })

    expect(routed.snapshot.routingStatus).toBe('selected')
    expect(routed.prompt.mandatory).toContain('Always active')
    expect(routed.modelRequestId).toBeNull()
  })
})

function skill(
  skillId: string,
  content: string,
  referenceCount = 0,
  dependencies: readonly string[] = []
): WriteLlmSkill {
  const commit = 'a'.repeat(40)
  return {
    skillId,
    name: skillId,
    description: `Use ${skillId} when appropriate.`,
    content,
    filePath: virtualSkillPath(skillId, commit),
    commit,
    license: 'MIT',
    source: 'curated',
    dependencies,
    files: [
      {
        path: 'SKILL.md',
        byteSize: content.length,
        gitBlobSha: 'b'.repeat(40),
        sha256: 'c'.repeat(64)
      },
      ...Array.from({ length: referenceCount }, (_, index) => ({
        path: `reference-${index + 1}.md`,
        byteSize: 20,
        gitBlobSha: 'd'.repeat(40),
        sha256: `${index}`.padStart(64, '0')
      }))
    ]
  }
}
