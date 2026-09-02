import { describe, expect, it, vi } from 'vitest'
import { estimateAgentTokens } from '../../shared/agent-context-budget'
import { WritingSkillRuntime } from './skill-router'
import { virtualSkillPath, type WriteLlmSkill } from './prompt'
import type { SkillService } from './skill-service'

describe('Pi-native progressive Writing Skill routing', () => {
  it('bounds the catalog by prompt bytes without a fixed Skill count', async () => {
    const skills = Array.from({ length: 40 }, (_, index) =>
      skill(`method-${String(index + 1).padStart(2, '0')}`, `Instructions ${index + 1}`)
    )
    const log = logger()
    const router = new WritingSkillRuntime(serviceFor(skills), log)

    const routed = await router.route({
      maxCatalogBytes: 65_536,
      signal: new AbortController().signal
    })

    expect(routed.snapshot).toMatchObject({
      schemaVersion: 4,
      mode: 'auto',
      routingStatus: 'available',
      safeError: null
    })
    for (const entry of skills) expect(routed.prompt.mandatory).toContain(entry.description)
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('uses the actual formatted catalog token estimate when Main supplies token pressure', async () => {
    const skills = Array.from({ length: 20 }, (_, index) =>
      skill(`token-method-${String(index + 1).padStart(2, '0')}`, `Instructions ${index + 1}`)
    )
    const log = logger()
    const maxCatalogTokens = 512
    const router = new WritingSkillRuntime(serviceFor(skills), log)

    const routed = await router.route({
      maxCatalogBytes: 65_536,
      maxCatalogTokens,
      signal: new AbortController().signal
    })

    expect(estimateAgentTokens(routed.prompt.mandatory)).toBeLessThanOrEqual(maxCatalogTokens)
    expect(routed.prompt.mandatory).toContain('token-method-01')
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('injects only explicit roots and advertises dependencies for progressive reads', async () => {
    const root = skill('root-method', 'Root instructions', 1, ['first-dependency'])
    const firstDependency = skill('first-dependency', 'First dependency', 0, ['second-dependency'])
    const secondDependency = skill('second-dependency', 'Second dependency')
    const service = serviceFor([root, firstDependency, secondDependency])
    const router = new WritingSkillRuntime(service, logger())

    const routed = await router.route({
      userPrompt: '$root-method Rewrite this passage.',
      signal: new AbortController().signal
    })

    expect(routed.snapshot).toMatchObject({
      schemaVersion: 4,
      mode: 'explicit',
      routingStatus: 'selected',
      requestedSkills: [{ skillId: root.skillId }],
      skills: [{ skillId: root.skillId, invocationSource: 'user' }],
      dependencies: []
    })
    expect(routed.prompt.mandatory).toContain('Root instructions')
    expect(routed.prompt.mandatory).not.toContain('First dependency')
    expect(routed.prompt.mandatory).not.toContain('Second dependency')
    expect(routed.prompt.mandatory).toContain(firstDependency.filePath)
    expect(service.loadById).toHaveBeenCalledWith(firstDependency.skillId)
    expect(service.loadById).not.toHaveBeenCalledWith(secondDependency.skillId)
    if (routed.state === undefined) throw new Error('Missing explicit state')

    const dependency = await router.read(routed.state, firstDependency.filePath)
    expect(dependency.data.content).toBe('First dependency')
    expect(dependency.data.dependencies).toEqual([
      expect.objectContaining({ skillId: secondDependency.skillId })
    ])
    expect(dependency.prompt.mandatory).not.toContain('First dependency')
    expect(dependency.prompt.mandatory).not.toContain('Second dependency')

    const reference = await router.read(
      routed.state,
      virtualSkillPath(root.skillId, root.commit, 'reference-1.md')
    )
    expect(reference.data.content).toBe('Reference reference-1.md')
    expect(reference.prompt.references).toEqual([])
  })

  it('allows multiple automatic entrypoints in one assistant response', async () => {
    const skills = Array.from({ length: 6 }, (_, index) =>
      skill(`automatic-${index + 1}`, `Automatic ${index + 1}`)
    )
    const router = new WritingSkillRuntime(serviceFor(skills), logger())
    const routed = await router.route({ signal: new AbortController().signal })
    if (routed.state === undefined) throw new Error('Missing Auto state')

    await Promise.all(
      skills
        .slice(0, 6)
        .map((entry) => router.read(routed.state as never, entry.filePath, 'request-1'))
    )

    expect(routed.state.activeSkills.map((entry) => entry.skillId)).toHaveLength(6)
    expect(new Set(routed.state.activeSkills.map((entry) => entry.skillId)).size).toBe(6)
  })

  it('retains more than the historical reference count and byte budgets', async () => {
    const primary = skill('reference-method', 'Reference instructions', 20)
    const router = new WritingSkillRuntime(serviceFor([primary]), logger())
    const routed = await router.route({ signal: new AbortController().signal })
    if (routed.state === undefined) throw new Error('Missing Auto state')
    await router.read(routed.state, primary.filePath)

    for (const file of primary.files.filter((entry) => entry.path !== 'SKILL.md')) {
      await router.read(routed.state, virtualSkillPath(primary.skillId, primary.commit, file.path))
    }

    expect(routed.state.readResources.size).toBe(20)
    const last = await router.read(
      routed.state,
      virtualSkillPath(primary.skillId, primary.commit, 'reference-20.md')
    )
    expect(last.snapshot.resources).toHaveLength(20)
    expect(last.prompt.references).toEqual([])
  })

  it('allows more than four explicit roots and more than eight direct dependencies', async () => {
    const dependencies = Array.from({ length: 9 }, (_, index) =>
      skill(`dependency-${index + 1}`, `Dependency ${index + 1}`)
    )
    const roots = Array.from({ length: 5 }, (_, index) =>
      skill(`explicit-${index + 1}`, `Explicit ${index + 1}`)
    )
    const rootWithDependencies = skill(
      'root-with-dependencies',
      'Root with dependencies',
      0,
      dependencies.map((entry) => entry.skillId)
    )
    const router = new WritingSkillRuntime(
      serviceFor([...roots, rootWithDependencies, ...dependencies]),
      logger()
    )

    const routed = await router.route({
      userPrompt: [
        ...roots.map((entry) => `$${entry.name}`),
        `$${rootWithDependencies.name}`,
        'revise'
      ].join(' '),
      signal: new AbortController().signal
    })

    expect(routed.snapshot.skills).toHaveLength(6)
    expect(routed.snapshot.dependencies).toEqual([])
    expect(routed.prompt.mandatory).toContain(dependencies[8]?.filePath ?? '')
    if (routed.state === undefined) throw new Error('Missing explicit state')
    expect(routed.state.dependencyCandidates.size).toBe(9)

    const loaded = await router.read(routed.state, dependencies[8]?.filePath ?? '')
    expect(loaded.data.content).toBe('Dependency 9')
  })

  it('keeps automatic Skill content out of the next system prompt', async () => {
    const automatic = skill('automatic-method', 'Private automatic instructions', 1)
    const router = new WritingSkillRuntime(serviceFor([automatic]), logger())
    const routed = await router.route({ signal: new AbortController().signal })
    if (routed.state === undefined) throw new Error('Missing Auto state')

    const entrypoint = await router.read(routed.state, automatic.filePath)
    expect(entrypoint.data.content).toBe('Private automatic instructions')
    expect(entrypoint.prompt.mandatory).not.toContain('Private automatic instructions')
    expect(entrypoint.prompt.references).toEqual([])

    const reference = await router.read(
      routed.state,
      virtualSkillPath(automatic.skillId, automatic.commit, 'reference-1.md')
    )
    expect(reference.data.content).toBe('Reference reference-1.md')
    expect(reference.prompt.mandatory).not.toContain('Private automatic instructions')
    expect(reference.prompt.references).toEqual([])
  })

  it('keeps manifest URI authorization while surfacing integrity failures', async () => {
    const primary = skill('authorized-method', 'Authorized instructions', 1)
    const readResource = vi.fn(async () => {
      throw new Error('Writing skill resource failed integrity check')
    })
    const service = serviceFor([primary], [], readResource)
    const router = new WritingSkillRuntime(service, logger())
    const routed = await router.route({ signal: new AbortController().signal })
    if (routed.state === undefined) throw new Error('Missing Auto state')
    await router.read(routed.state, primary.filePath)

    await expect(
      router.read(routed.state, virtualSkillPath(primary.skillId, 'b'.repeat(40), 'reference-1.md'))
    ).rejects.toMatchObject({ code: 'unauthorized' })
    await expect(
      router.read(routed.state, virtualSkillPath(primary.skillId, primary.commit, 'reference-1.md'))
    ).rejects.toThrow('integrity check')
    expect(readResource).toHaveBeenCalledTimes(1)
  })

  it('authorizes references from the run manifest without an entrypoint loading prerequisite', async () => {
    const primary = skill('direct-reference', 'Instructions', 1)
    const router = new WritingSkillRuntime(serviceFor([primary]), logger())
    const routed = await router.route({ signal: new AbortController().signal })
    if (routed.state === undefined) throw new Error('Missing Auto state')
    const result = await router.read(
      routed.state,
      virtualSkillPath(primary.skillId, primary.commit, 'reference-1.md')
    )
    expect(result.data.content).toBe('Reference reference-1.md')
    expect(result.snapshot.skills).toEqual([])
    expect(result.snapshot.resources).toHaveLength(1)
    await expect(
      router.read(routed.state, virtualSkillPath(primary.skillId, primary.commit, '../private.md'))
    ).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('does not degrade a useful root when a dependency is unavailable', async () => {
    const root = skill('available-root', 'Available root', 0, ['missing-dependency'])
    const router = new WritingSkillRuntime(serviceFor([root]), logger())

    const routed = await router.route({
      userPrompt: '$available-root revise',
      signal: new AbortController().signal
    })

    expect(routed.snapshot).toMatchObject({
      mode: 'explicit',
      routingStatus: 'selected',
      skills: [{ skillId: root.skillId }],
      safeError: null
    })
    expect(routed.prompt.mandatory).toContain('Available root')
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

  it('degrades ambiguous and unavailable explicit mentions without failing the run', async () => {
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
    const unavailableRouter = new WritingSkillRuntime(
      serviceFor([], [{ skillId: unavailable.skillId, name: unavailable.name }]),
      logger()
    )
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
  })

  it('degrades an explicit package only when roots cannot fit the generic system prompt bound', async () => {
    const first = skill('large-first', 'a'.repeat(40_000))
    const second = skill('large-second', 'b'.repeat(40_000))
    const router = new WritingSkillRuntime(serviceFor([first, second]), logger())

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
  })
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
  additionalInstalled: Array<{ skillId: string; name: string }> = [],
  readResource: SkillService['readResource'] = vi.fn(async (_skill, path) => `Reference ${path}`)
): SkillService {
  return {
    loadEnabled: vi.fn(async () => loaded),
    loadById: vi.fn(async (id: string) => {
      const found = loaded.find((candidate) => candidate.skillId === id)
      if (found === undefined) throw new Error('unknown skill')
      return found
    }),
    loadVersion: vi.fn(),
    readResource,
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
        byteSize: Buffer.byteLength(content),
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
