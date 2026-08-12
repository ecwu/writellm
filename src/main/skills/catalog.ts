import {
  SKILL_MAX_ENTRYPOINT_BYTES,
  SKILL_MAX_PROGRESSIVE_REFERENCE_BYTES
} from '../../shared/contracts/skills'

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
  },
  {
    skillId: 'ccf-visual-composer',
    displayName: 'CCF Visual Composer',
    description:
      'Design publication-grade scientific figures, tables, method and architecture diagrams, captions, palettes, and visual QA without inventing evidence.',
    repository: 'mikubaka88/CCFA-Skills',
    directory: 'ccf-visual-composer',
    commit: '6bab955140bbe21e0a0543c6788f6502842ab685',
    license: 'MIT',
    dependencies: [],
    files: [
      file('SKILL.md', 8925, 'a6c8a24149183bc8f669dee0bc644a20fa80d354'),
      file(
        'references/architecture-diagram-generation.md',
        9499,
        'facfc6cb8c2de4aa4cc8d430fb0bccf330c8f09c'
      ),
      file('references/figure-table-layout.md', 2697, '586238bf76b57f39e4d6ec84fb2fa4117b4c2d29'),
      file(
        'references/palette-and-accessibility.md',
        2280,
        'cabf780bb0ee110a8e80bf570a3e5a76cb7ed7d8'
      ),
      file('references/plot-inspiration-map.md', 3688, '345ea7febbb76060a4d1492a27af6affdb0c5790'),
      file('references/python-plot-recipes.md', 5385, '1818e7de845413297674e639d05c80108d476d13'),
      file('references/render-qa.md', 2935, 'cafb3e12b483c1c4512dc6205d40245ec0a0f815'),
      file('references/visual-contract.md', 3066, '25ed058b5e41c307f9177740694e6aab1fd67f3b')
    ]
  },
  {
    skillId: 'ccf-paper-reviewer',
    displayName: 'CCF Paper Reviewer',
    description:
      'Review scientific novelty, soundness, evidence, writing, venue fit, and revision priorities through reviewer and area-chair perspectives.',
    repository: 'mikubaka88/CCFA-Skills',
    directory: 'ccf-paper-reviewer',
    commit: '6bab955140bbe21e0a0543c6788f6502842ab685',
    license: 'MIT',
    dependencies: [],
    files: [
      file('SKILL.md', 5394, '5c36a4c1b1755da138cdfa0d6b7357d97b618cc0'),
      file('references/calibration-and-rank.md', 5193, '132b7f2305c56e1ce701405e0618f953b9d6292a'),
      file('references/desk-checks.md', 1562, '64c36db86eb9c207d82189dffc44701ed067cf35'),
      file('references/fixed-output-format.md', 4169, '926001c3b95509fe7553e435ccd84e0f5daa4371'),
      file('references/review-workflow.md', 2685, '6da85ee77047def504e15106844930b0514a9cbb'),
      file('references/reviewer-panel.md', 4669, 'fba621fedab1da0e42e796a65f5c8148451a7dfc'),
      file('references/source-notes.md', 1130, '4ef3456f42b51105113842b784151ce0efc8b0e4'),
      file(
        'references/universal-review-rubric.md',
        4856,
        '7c027e0bb90498d6177f6ce088f1f0593c6a0102'
      ),
      file('references/venue-review-styles.md', 7287, 'edcdd077774148193f88440d0d49d1ce13051d13'),
      file(
        'references/writing-review/latex-format-audit.md',
        2752,
        '6643eae8ab21694a2c80656acb3826493762cf52'
      ),
      file(
        'references/writing-review/paragraph-review-protocol.md',
        2877,
        '5c337d6758527f9257a668feefbe96db78daef3d'
      ),
      file(
        'references/writing-review/review-checklists.md',
        5045,
        '0a1f19243f43251ace06c0ddd5467ec4c5104f80'
      ),
      file(
        'references/writing-review/revision-actions.md',
        9325,
        'ab720630975695c8ff46ec445ad60455a93c5702'
      ),
      file(
        'references/writing-review/source-notes.md',
        1408,
        '919912ee13bcb4cc71f254e0df90b4b6b33b47bf'
      ),
      file(
        'references/writing-review/writing-review-rubric.md',
        6927,
        'e70c5f53f8a1e33382add5f3e0eb9fded8a15b6a'
      )
    ]
  },
  {
    skillId: 'ccf-integrity-auditor',
    displayName: 'CCF Integrity Auditor',
    description:
      'Audit claim-evidence alignment, numeric and terminology consistency, figure and table references, and existing citation support.',
    repository: 'mikubaka88/CCFA-Skills',
    directory: 'ccf-integrity-auditor',
    commit: '6bab955140bbe21e0a0543c6788f6502842ab685',
    license: 'MIT',
    dependencies: [],
    files: [file('SKILL.md', 2397, '026c877d3cff59b334f3af77ef51f640cc1ffa63')]
  },
  {
    skillId: 'nature-statistics',
    displayName: 'Nature Statistics',
    description:
      'Audit and revise statistical reporting, experimental units, replication, p values, uncertainty, multiple comparisons, and figure legends.',
    repository: 'Yuan1z0825/nature-skills',
    directory: 'skills/nature-statistics',
    commit: '1ea82ffff20f40077bf84b74182f55eeaf3d111d',
    license: 'Apache-2.0',
    dependencies: [],
    files: [
      file('SKILL.md', 8248, 'e2b746e2d900d1173effb18f63eabb6ceb3bda81'),
      file('references/common-failure-modes.md', 4206, 'b87f172c53145d19ceb4836a183a4080bbabd5d5'),
      file('references/figure-statistics.md', 2905, 'b12bdfca75abeba2fe9bd21540d134651e8cc2a5'),
      file(
        'references/nature-article-requirements.md',
        3420,
        '8a09a2fa2f25274337d8c5a6ec40e3655697d8aa'
      ),
      file('references/reviewer-checklist.md', 3591, 'b97da8bece0f49388327ae383cacc97d090a6c84'),
      file('references/source-basis.md', 3638, '5be35af49549928883041ffd9754724c324e2451'),
      file('references/statistical-reporting.md', 4037, '47aec2e06c48c4313a80a3a26aabbc3fd886d2f8')
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
    for (const item of entry.files) {
      const limit =
        item.path === 'SKILL.md'
          ? SKILL_MAX_ENTRYPOINT_BYTES
          : SKILL_MAX_PROGRESSIVE_REFERENCE_BYTES
      if (item.byteSize < 1 || item.byteSize > limit) {
        throw new Error(`Curated skill ${entry.skillId} file ${item.path} exceeds its byte limit`)
      }
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
