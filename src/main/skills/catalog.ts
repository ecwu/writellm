export interface CuratedSkillFile {
  path: string
  byteSize: number
  gitBlobSha: string
}

export interface CuratedSkillCatalogEntry {
  skillId: string
  displayName: string
  description: string
  repository: string
  directory: string
  commit: string
  license: string
  dependencies: readonly string[]
  files: readonly CuratedSkillFile[]
}

const file = (path: string, byteSize: number, gitBlobSha: string): CuratedSkillFile => ({
  path,
  byteSize,
  gitBlobSha
})

export const CURATED_SKILL_CATALOG = [
  {
    skillId: 'nature-writing',
    displayName: 'Nature Writing',
    description:
      'Plan and revise research manuscripts with claim-evidence structure, section-specific workflows, and concise Nature-family academic prose.',
    repository: 'Yuan1z0825/nature-skills',
    directory: 'skills/nature-writing',
    commit: '1ea82ffff20f40077bf84b74182f55eeaf3d111d',
    license: 'Apache-2.0',
    dependencies: [],
    files: [
      file('SKILL.md', 6488, 'ad52508a47d3ceaa9945016e13b74af062ba961b'),
      file('references/abstract.md', 4067, '2bcd3ee42b4cbac33056c21a94e211b44de06062'),
      file('references/conclusion.md', 1244, '60209f9f1442847724efa36c9465888fa148048f'),
      file('references/experiments.md', 4860, '6e76195b742c526368774d0a6572f0f2cd33c26c'),
      file('references/introduction.md', 15709, '5babc13f1e27a53e8f426587f4ba233cfef5c255'),
      file('references/method.md', 7102, 'b9c3820c9293ab75c463d72d8b082df21f37cc9b'),
      file('references/paragraph-flow.md', 1695, 'dccc564c4a89379b089ae3652cbc7a3b46543aa3'),
      file('references/related-work.md', 1283, 'dff0c70908292e55782c8a76c087658b5a3f3f64'),
      file('static/core/output-format.md', 1276, '429394d1ca0b8f988be3cdfca510fb2ef18f8d7a'),
      file('static/core/stance.md', 2279, 'b35c14d8119e1342b3fea05e547812cbf52d7cd1'),
      file('static/core/workflow.md', 5914, 'd66f5bc0d7ce40645735f612fc21d0d9a7568d08')
    ]
  },
  {
    skillId: 'ccf-humanization',
    displayName: 'CCF Humanization',
    description:
      'Revise academic prose toward direct, specific, human-authored language while preserving evidence, terminology, and experimental discipline.',
    repository: 'mikubaka88/CCFA-Skills',
    directory: 'ccf-humanization',
    commit: '6bab955140bbe21e0a0543c6788f6502842ab685',
    license: 'MIT',
    dependencies: [],
    files: [
      file('SKILL.md', 6606, '8b1681bf710c29dacd8dbe105bfdab3c0d0d79f7'),
      file('references/experiment-discipline.md', 3458, '4aa3936d337dc4d50982b74c14afd4f1ee132029'),
      file('references/humanization-policy.md', 5181, 'ba87e32247106e8ec14e02044581e8b82b6bfaba')
    ]
  },
  {
    skillId: 'ccf-paper-writer',
    displayName: 'CCF Paper Writer',
    description:
      'Plan, draft, review, and compress computer-science papers with citation discipline, venue-aware structure, and evidence-backed revision loops.',
    repository: 'mikubaka88/CCFA-Skills',
    directory: 'ccf-paper-writer',
    commit: '6bab955140bbe21e0a0543c6788f6502842ab685',
    license: 'MIT',
    dependencies: ['ccf-humanization'],
    files: [
      file('SKILL.md', 16572, '0a49392f4b7bc9feb3dffcbae1188eff33209e88'),
      file('references/citation-workflow.md', 7422, 'd807c1d9911ecdc2f1f5ffe6e7951c9e8fca314e'),
      file('references/compression-rules.md', 4650, '1a22ee760f3e34fa54eeec6b3087ba3e55657ef0'),
      file(
        'references/prose-quality-guardrails.md',
        6472,
        'ee5e4dd5e746b94430a6fe3895aeef61d04e8744'
      ),
      file(
        'references/research-writing-patterns.md',
        13960,
        '75a01f78993b3e25ab2a96e9676651d67b1b81e0'
      ),
      file('references/section-modules.md', 13183, '5c90fea5a01968b261e9dff7c458c288794da73b'),
      file('references/storyline-blueprint.md', 15496, '48509608bcdcc955840e6e019d7df3973d49dd35'),
      file('references/table-style-guide.md', 7703, '1808267ad1857e4684cbba68717341e3028066bc'),
      file('references/venue-adapters.md', 7416, '678d3a622de28e0a9eca8316ddd4d0c9220af6a4')
    ]
  }
] as const satisfies readonly CuratedSkillCatalogEntry[]

export function validateCuratedSkillCatalog(): void {
  const ids = new Set(CURATED_SKILL_CATALOG.map((entry) => entry.skillId))
  for (const entry of CURATED_SKILL_CATALOG) {
    if (!entry.files.some((file) => file.path === 'SKILL.md')) {
      throw new Error(`Curated skill ${entry.skillId} has no SKILL.md`)
    }
    if (new Set(entry.files.map((file) => file.path)).size !== entry.files.length) {
      throw new Error(`Curated skill ${entry.skillId} repeats an allowlisted file`)
    }
    for (const dependency of entry.dependencies) {
      if (!ids.has(dependency)) throw new Error(`Curated skill dependency ${dependency} is unknown`)
    }
  }
  for (const entry of CURATED_SKILL_CATALOG) visit(entry.skillId, [], new Set())
  for (const entry of CURATED_SKILL_CATALOG) {
    const closure = collectClosure(entry.skillId)
    const entrypointBytes = closure.reduce((sum, item) => {
      const skillFile = item.files.find((candidate) => candidate.path === 'SKILL.md')
      return sum + (skillFile?.byteSize ?? 0) + 1_024
    }, 0)
    const fixedMeasuredBytes = 5_218 + 551 + 165
    const referenceReserveBytes = 8 * 1_024
    if (fixedMeasuredBytes + entrypointBytes + referenceReserveBytes > 65_536) {
      throw new Error(`Curated skill ${entry.skillId} cannot fit the prompt budget`)
    }
  }
}

function collectClosure(skillId: string): CuratedSkillCatalogEntry[] {
  const result: CuratedSkillCatalogEntry[] = []
  const visited = new Set<string>()
  const collect = (id: string): void => {
    if (visited.has(id)) return
    const entry = CURATED_SKILL_CATALOG.find((candidate) => candidate.skillId === id)
    if (entry === undefined) throw new Error(`Curated skill ${id} is unknown`)
    visited.add(id)
    for (const dependency of entry.dependencies) collect(dependency)
    result.push(entry)
  }
  collect(skillId)
  return result
}

function visit(skillId: string, path: string[], visited: Set<string>): void {
  if (path.includes(skillId))
    throw new Error(`Curated skill dependency cycle: ${[...path, skillId]}`)
  if (visited.has(skillId)) return
  const entry = CURATED_SKILL_CATALOG.find((candidate) => candidate.skillId === skillId)
  if (entry === undefined) throw new Error(`Curated skill ${skillId} is unknown`)
  for (const dependency of entry.dependencies) visit(dependency, [...path, skillId], visited)
  visited.add(skillId)
}
