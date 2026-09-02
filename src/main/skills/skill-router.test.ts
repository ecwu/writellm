import { describe, expect, it, vi } from 'vitest'
import { SkillReadError, WritingSkillRuntime } from './skill-router'
import { virtualSkillPath, type WriteLlmSkill } from './prompt'
import type { SkillService } from './skill-service'

describe('Pi-native progressive Writing Skill routing', () => {
  it('publishes metadata, visibly loads ordered Skills and dependencies, and caps references', async () => {
    const primary = skill('primary-method', 'Primary body', 13, ['support-method'])
    const other = skill('other-method', 'Other private body')
    const dependency = skill('support-method', 'Dependency body')
    const readResource = vi.fn(async (_skill: WriteLlmSkill, path: string) => `Reference ${path}`)
    const service = {
      loadEnabled: vi.fn(async () => [other, primary]),
      loadById: vi.fn(async (id: string) => {
        if (id === dependency.skillId) return dependency
        if (id === primary.skillId) return primary
        if (id === other.skillId) return other
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
      signal: new AbortController().signal
    })
    expect(routed.snapshot.routingStatus).toBe('available')
    expect(routed.prompt.mandatory).toContain(primary.description)
    expect(routed.prompt.mandatory).not.toContain('Primary body')
    expect(routed.prompt.mandatory).not.toContain('Other private body')
    if (routed.state === undefined) throw new Error('Missing progressive state')

    await expect(
      router.read(routed.state, virtualSkillPath(primary.skillId, primary.commit, 'reference-1.md'))
    ).rejects.toMatchObject({
      code: 'unauthorized',
      recoveryUri: other.filePath,
      message: expect.stringContaining(other.filePath)
    })

    const selected = await router.read(routed.state, primary.filePath, 'request-1')
    expect(selected.snapshot).toMatchObject({
      routingStatus: 'selected',
      skills: [{ skillId: 'primary-method' }],
      dependencies: []
    })
    expect(selected.data.content).toBe('Primary body')
    expect(selected.data.dependencies).toEqual([
      expect.objectContaining({
        skillId: 'support-method',
        uri: dependency.filePath
      })
    ])
    expect(selected.data.references).toHaveLength(13)
    const earlyReference = await router.read(
      routed.state,
      virtualSkillPath(primary.skillId, primary.commit, 'reference-1.md'),
      'request-before-dependency'
    )
    expect(earlyReference.snapshot.resources).toEqual([
      expect.objectContaining({ skillId: primary.skillId, relativePath: 'reference-1.md' })
    ])
    await expect(router.read(routed.state, other.filePath, 'request-1')).rejects.toBeInstanceOf(
      SkillReadError
    )
    const loadedDependency = await router.read(routed.state, dependency.filePath, 'request-2')
    expect(loadedDependency.snapshot.dependencies).toEqual([
      expect.objectContaining({ skillId: 'support-method' })
    ])
    expect(loadedDependency.data.content).toBe('Dependency body')
    const combined = await router.read(routed.state, other.filePath, 'request-3')
    expect(combined.snapshot.skills.map((entry) => entry.skillId)).toEqual([
      'primary-method',
      'other-method'
    ])

    for (const file of primary.files
      .filter((entry) => entry.path !== 'SKILL.md' && entry.path !== 'reference-1.md')
      .slice(0, 11)) {
      await router.read(routed.state, virtualSkillPath(primary.skillId, primary.commit, file.path))
    }
    const duplicate = await router.read(
      routed.state,
      virtualSkillPath(primary.skillId, primary.commit, 'reference-5.md')
    )
    expect(duplicate.snapshot.resources).toHaveLength(12)
    await expect(
      router.read(
        routed.state,
        virtualSkillPath(primary.skillId, primary.commit, 'reference-13.md')
      )
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(readResource).toHaveBeenCalledTimes(12)
    router.closePreparation(routed.state)
    await expect(
      router.read(routed.state, primary.filePath, 'request-after-preparation')
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('allows dependency references and atomically releases byte reservations after cancellation', async () => {
    const primary = skill('primary-method', 'Primary body', 0, ['support-method'])
    const dependency = skill('support-method', 'Dependency body', 2)
    const dependencyReferences = dependency.files.filter((file) => file.path !== 'SKILL.md')
    for (const file of dependencyReferences) file.byteSize = 20 * 1024
    let releaseFirst: (() => void) | undefined
    const firstRead = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const readResource = vi
      .fn()
      .mockImplementationOnce(async () => {
        await firstRead
        return 'cancelled content'
      })
      .mockResolvedValue('retained content')
    const service = {
      loadEnabled: vi.fn(async () => [primary]),
      loadById: vi.fn(async (id: string) => (id === primary.skillId ? primary : dependency)),
      loadVersion: vi.fn(),
      readResource
    } as unknown as SkillService
    const router = new WritingSkillRuntime(service, {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
    const routed = await router.route({
      signal: new AbortController().signal
    })
    if (routed.state === undefined) throw new Error('Missing progressive state')
    const primaryRead = await router.read(routed.state, primary.filePath, 'request-1')
    const dependencyUri = primaryRead.data.dependencies[0]?.uri
    if (dependencyUri === undefined) throw new Error('Missing dependency URI')
    await router.read(routed.state, dependencyUri, 'request-2')
    const firstUri = virtualSkillPath(
      dependency.skillId,
      dependency.commit,
      dependencyReferences[0]?.path ?? ''
    )
    const secondUri = virtualSkillPath(
      dependency.skillId,
      dependency.commit,
      dependencyReferences[1]?.path ?? ''
    )
    const controller = new AbortController()
    const pending = router.read(routed.state, firstUri, 'request-3', controller.signal)
    await vi.waitFor(() => expect(readResource).toHaveBeenCalledTimes(1))
    await expect(router.read(routed.state, secondUri, 'request-4')).rejects.toMatchObject({
      code: 'conflict'
    })
    controller.abort()
    releaseFirst?.()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })

    const retained = await router.read(routed.state, secondUri, 'request-5')
    expect(retained.snapshot.resources).toEqual([
      expect.objectContaining({
        skillId: dependency.skillId,
        relativePath: dependencyReferences[1]?.path,
        byteSize: 20 * 1024
      })
    ])
  })

  it('rejects an over-budget Auto addition without mutating the loaded ordered set', async () => {
    const skills = [
      skill('first-method', 'a'.repeat(21_000)),
      skill('second-method', 'b'.repeat(21_000)),
      skill('third-method', 'c'.repeat(21_000)),
      skill('fourth-method', 'd'.repeat(21_000))
    ]
    const service = {
      loadEnabled: vi.fn(async () => skills),
      loadById: vi.fn(async (id: string) => {
        const selected = skills.find((candidate) => candidate.skillId === id)
        if (selected === undefined) throw new Error('unknown skill')
        return selected
      }),
      loadVersion: vi.fn(),
      readResource: vi.fn()
    } as unknown as SkillService
    const router = new WritingSkillRuntime(service, {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
    const routed = await router.route({
      signal: new AbortController().signal
    })
    if (routed.state === undefined) throw new Error('Missing Auto state')
    await router.read(routed.state, skills[0]?.filePath ?? '', 'request-1')
    await router.read(routed.state, skills[1]?.filePath ?? '', 'request-2')
    await router.read(routed.state, skills[2]?.filePath ?? '', 'request-3')
    await expect(router.read(routed.state, skills[3]?.filePath ?? '', 'request-4')).rejects.toThrow(
      'system prompt budget'
    )
    expect(routed.state.activeSkills.map((entry) => entry.skillId)).toEqual([
      'first-method',
      'second-method',
      'third-method'
    ])
  })

  it('injects leading user mentions with their dependency closure, then permits discovery', async () => {
    const requestedFirst = skill('nature-writing', 'Nature instructions', 1, ['support-method'])
    requestedFirst.disableModelInvocation = true
    const requestedSecond = skill('ccf-humanization', 'Humanization instructions')
    const dependency = skill('support-method', 'Supporting instructions')
    const discovered = skill('structure-review', 'Structure instructions')
    const loaded = [discovered, dependency, requestedFirst, requestedSecond]
    const service = serviceFor(loaded)
    const router = new WritingSkillRuntime(service, logger())

    const routed = await router.route({
      userPrompt: '$nature-writing $ccf-humanization Rewrite this passage.',
      signal: new AbortController().signal
    })
    expect(routed.snapshot).toMatchObject({
      schemaVersion: 3,
      mode: 'explicit',
      requestedSkills: [{ skillId: 'nature-writing' }, { skillId: 'ccf-humanization' }],
      routingStatus: 'selected',
      skills: [
        { skillId: 'nature-writing', invocationSource: 'user' },
        { skillId: 'ccf-humanization', invocationSource: 'user' }
      ],
      dependencies: [{ skillId: 'support-method' }]
    })
    expect(routed.prompt.mandatory.indexOf('Nature instructions')).toBeLessThan(
      routed.prompt.mandatory.indexOf('Humanization instructions')
    )
    expect(routed.prompt.mandatory.indexOf('Humanization instructions')).toBeLessThan(
      routed.prompt.mandatory.indexOf('Supporting instructions')
    )
    expect(routed.fallbackPrompt?.mandatory).not.toContain('Nature instructions')
    if (routed.state === undefined) throw new Error('Missing explicit state')

    const reference = await router.read(
      routed.state,
      virtualSkillPath(requestedFirst.skillId, requestedFirst.commit, 'reference-1.md'),
      'explicit-reference'
    )
    expect(reference.snapshot.resources).toEqual([
      expect.objectContaining({ skillId: requestedFirst.skillId, relativePath: 'reference-1.md' })
    ])
    await expect(
      router.read(
        routed.state,
        virtualSkillPath(requestedFirst.skillId, requestedFirst.commit, 'not-authorized.md'),
        'unauthorized-reference'
      )
    ).rejects.toMatchObject({ code: 'unauthorized' })

    const complementary = await router.read(routed.state, discovered.filePath, 'agent-1')
    expect(complementary.snapshot.skills.at(-1)).toMatchObject({
      skillId: discovered.skillId,
      invocationSource: 'agent'
    })
  })

  it('deduplicates repeated mentions and leaves unknown names as ordinary prompt text', async () => {
    const available = skill('nature-writing', 'Nature instructions')
    const router = new WritingSkillRuntime(serviceFor([available]), logger())
    const routed = await router.route({
      userPrompt: '$unknown $nature-writing $nature-writing Rewrite this.',
      signal: new AbortController().signal
    })
    expect(routed.snapshot.requestedSkills.map((entry) => entry.skillId)).toEqual([
      'nature-writing'
    ])
  })

  it('degrades ambiguous, unavailable, and over-limit explicit packages without failing', async () => {
    const ambiguousOne = skill('first-source', 'One')
    ambiguousOne.name = 'shared-name'
    const ambiguousTwo = skill('second-source', 'Two')
    ambiguousTwo.name = 'shared-name'
    const ambiguousRouter = new WritingSkillRuntime(
      serviceFor([ambiguousOne, ambiguousTwo]),
      logger()
    )
    await expect(
      ambiguousRouter.route({
        userPrompt: '$shared-name revise',
        signal: new AbortController().signal
      })
    ).resolves.toMatchObject({
      snapshot: {
        mode: 'explicit',
        routingStatus: 'degraded',
        safeError: 'skill_mention_ambiguous'
      }
    })

    const unavailable = skill('disabled-method', 'Disabled')
    const unavailableService = serviceFor(
      [],
      [{ skillId: unavailable.skillId, name: unavailable.name }]
    )
    const unavailableRouter = new WritingSkillRuntime(unavailableService, logger())
    await expect(
      unavailableRouter.route({
        userPrompt: '$disabled-method revise',
        signal: new AbortController().signal
      })
    ).resolves.toMatchObject({
      snapshot: {
        mode: 'explicit',
        routingStatus: 'degraded',
        safeError: 'skill_mention_unavailable'
      }
    })

    const five = Array.from({ length: 5 }, (_, index) =>
      skill(`method-${index + 1}`, `Instructions ${index + 1}`)
    )
    const overLimitRouter = new WritingSkillRuntime(serviceFor(five), logger())
    await expect(
      overLimitRouter.route({
        userPrompt: `${five.map((entry) => `$${entry.name}`).join(' ')} revise`,
        signal: new AbortController().signal
      })
    ).resolves.toMatchObject({
      snapshot: { mode: 'explicit', routingStatus: 'degraded', safeError: 'skill_mention_limit' }
    })
  })

  it('atomically degrades an explicit combination whose prompt exceeds the budget', async () => {
    const first = skill('large-first', 'a'.repeat(40_000))
    const second = skill('large-second', 'b'.repeat(40_000))
    const service = serviceFor([first, second])
    const router = new WritingSkillRuntime(service, logger())

    const routed = await router.route({
      userPrompt: '$large-first $large-second Revise.',
      signal: new AbortController().signal
    })
    expect(routed.snapshot).toMatchObject({
      mode: 'explicit',
      routingStatus: 'degraded',
      requestedSkills: [],
      skills: [],
      dependencies: [],
      safeError: 'skill_prompt_budget_exceeded'
    })
    expect(routed.prompt.mandatory).not.toContain('a'.repeat(100))
    expect(routed.prompt.mandatory).not.toContain('b'.repeat(100))
    expect(service.readResource).not.toHaveBeenCalled()
  })

  it('uses stable dependency order, de-duplicates shared dependencies, and rejects no partial package', async () => {
    const shared = skill('shared-method', 'Shared instructions')
    const firstDependency = skill('first-dependency', 'First dependency', 0, [shared.skillId])
    const secondDependency = skill('second-dependency', 'Second dependency')
    const first = skill('first-root', 'First root', 0, [firstDependency.skillId, shared.skillId])
    const second = skill('second-root', 'Second root', 0, [
      secondDependency.skillId,
      shared.skillId
    ])
    const router = new WritingSkillRuntime(
      serviceFor([second, secondDependency, shared, firstDependency, first]),
      logger()
    )

    const routed = await router.route({
      userPrompt: '$first-root $second-root revise',
      signal: new AbortController().signal
    })
    expect(routed.snapshot.skills.map((entry) => entry.skillId)).toEqual([
      first.skillId,
      second.skillId
    ])
    expect(routed.snapshot.dependencies.map((entry) => entry.skillId)).toEqual([
      shared.skillId,
      firstDependency.skillId,
      secondDependency.skillId
    ])
    expect(routed.prompt.mandatory.indexOf('First root')).toBeLessThan(
      routed.prompt.mandatory.indexOf('Second root')
    )
    expect(routed.prompt.mandatory.match(/Shared instructions/g)).toHaveLength(1)
  })

  it.each([
    {
      name: 'cycles',
      expectedCode: 'skill_dependency_cycle',
      createSkills: () => {
        const root = skill('cycle-root', 'Cycle root', 0, ['cycle-dependency'])
        const dependency = skill('cycle-dependency', 'Cycle dependency', 0, [root.skillId])
        return { root, loaded: [root, dependency] }
      }
    },
    {
      name: 'dependency limits',
      expectedCode: 'skill_dependency_limit',
      createSkills: () => {
        const dependencies = Array.from({ length: 9 }, (_, index) =>
          skill(`dependency-${index + 1}`, `Dependency ${index + 1}`)
        )
        const root = skill(
          'limited-root',
          'Limited root',
          0,
          dependencies.map((entry) => entry.skillId)
        )
        return { root, loaded: [root, ...dependencies] }
      }
    },
    {
      name: 'unavailable dependencies',
      expectedCode: 'skill_dependency_unavailable',
      createSkills: () => {
        const root = skill('missing-root', 'Missing root', 0, ['not-installed'])
        return { root, loaded: [root] }
      }
    }
  ])(
    'degrades explicit packages with $name without injecting a partial closure',
    async (fixture) => {
      const { root, loaded } = fixture.createSkills()
      const routed = await new WritingSkillRuntime(serviceFor(loaded), logger()).route({
        userPrompt: `$${root.name} revise`,
        signal: new AbortController().signal
      })
      expect(routed.snapshot).toMatchObject({
        mode: 'explicit',
        routingStatus: 'degraded',
        requestedSkills: [],
        skills: [],
        dependencies: [],
        safeError: fixture.expectedCode
      })
      expect(routed.prompt.mandatory).not.toContain(root.content)
    }
  )
})

function logger(): {
  info: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
} {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function serviceFor(
  loaded: WriteLlmSkill[],
  additionalInstalled: Array<{ skillId: string; name: string }> = []
): SkillService {
  return {
    loadEnabled: vi.fn(async () => loaded),
    loadById: vi.fn(async (id: string) => {
      const found = loaded.find((candidate) => candidate.skillId === id)
      if (found === undefined) throw new Error('unknown skill')
      return found
    }),
    loadVersion: vi.fn(),
    readResource: vi.fn(),
    snapshot: vi.fn(() => ({
      available: [],
      revision: 1,
      installed: [
        ...loaded.map((entry) => ({ skillId: entry.skillId, name: entry.name })),
        ...additionalInstalled
      ]
    }))
  } as unknown as SkillService
}

function skill(
  skillId: string,
  content: string,
  referenceCount = 0,
  dependencies: readonly string[] = []
): WriteLlmSkill {
  const commit = 'a'.repeat(40)
  return {
    skillId,
    displayName: skillId,
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
