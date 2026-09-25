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
    commit: '28150f30f8b4017991fca8c7b2839f02c6586d2f',
    license: 'Apache-2.0',
    dependencies: [],
    files: [
      file('SKILL.md', 9628, '847d5555ad3bc959ffa7c0815f7c7e0285da6072'),
      file('references/abstract.md', 4067, '2bcd3ee42b4cbac33056c21a94e211b44de06062'),
      file('references/conclusion.md', 1244, '60209f9f1442847724efa36c9465888fa148048f'),
      file('references/experiments.md', 4860, '6e76195b742c526368774d0a6572f0f2cd33c26c'),
      file('references/introduction.md', 15709, '5babc13f1e27a53e8f426587f4ba233cfef5c255'),
      file('references/method.md', 7102, 'b9c3820c9293ab75c463d72d8b082df21f37cc9b'),
      file('references/paragraph-flow.md', 1695, 'dccc564c4a89379b089ae3652cbc7a3b46543aa3'),
      file('references/related-work.md', 1283, 'dff0c70908292e55782c8a76c087658b5a3f3f64'),
      file('static/core/output-format.md', 1828, 'ed2d6f27626971d16bc516a9efaae990907efe40'),
      file('static/core/stance.md', 2279, 'b35c14d8119e1342b3fea05e547812cbf52d7cd1'),
      file('static/core/workflow.md', 6718, 'b81df655629bcb18d6265df7a13a38f98fde4522'),
      file(
        'static/fragments/journal/nat-mach-intell.md',
        6033,
        '22995b94c64d03d2be3b0556c90b971da97599f7'
      )
    ]
  },
  {
    skillId: 'ccf-humanization',
    displayName: 'CCF Humanization',
    description:
      'Revise academic prose toward direct, specific, human-authored language while preserving evidence, terminology, and experimental discipline.',
    repository: 'mikubaka88/CCFA-Skills',
    directory: 'ccf-humanization',
    commit: '217f68774a6703ba8b8fad602fdb47641ff77c6d',
    license: 'MIT',
    dependencies: [],
    files: [
      file('SKILL.md', 5806, 'd29eaa4998a55da3a22d2e0a3f79a042a06fb78c'),
      file('references/experiment-discipline.md', 4008, 'f5ffeca983913fb9760f2454177156ca2f9613e6'),
      file('references/humanization-policy.md', 11814, 'ebf70ce1b3ef5dc2fae5570ba0b339d3b7a87480')
    ]
  },
  {
    skillId: 'ccf-paper-writer',
    displayName: 'CCF Paper Writer',
    description:
      'Plan, draft, review, and compress computer-science papers with citation discipline, venue-aware structure, and evidence-backed revision loops.',
    repository: 'mikubaka88/CCFA-Skills',
    directory: 'ccf-paper-writer',
    commit: '217f68774a6703ba8b8fad602fdb47641ff77c6d',
    license: 'MIT',
    dependencies: ['ccf-humanization'],
    files: [
      file('SKILL.md', 10059, '45958c9ce04919946edce3aef166dabb9e7411bb'),
      file('references/citation-workflow.md', 4607, '171475e160616a08cbd12a3d38c6740e806df6ce'),
      file('references/compression-rules.md', 4650, '1a22ee760f3e34fa54eeec6b3087ba3e55657ef0'),
      file(
        'references/prose-quality-guardrails.md',
        8051,
        '27be3b3cc122dc2e8ce0f9d19ad20a1decc35a50'
      ),
      file(
        'references/research-writing-patterns.md',
        14161,
        '98456ca5a384dec7a16bec2943ad3e62f21c0e9d'
      ),
      file('references/section-modules.md', 13343, '9f15a807d8555649191f5141734a1abac0d880f6'),
      file('references/storyline-blueprint.md', 16086, 'd072f1f88d627a60ce5e10bd2d948fae4fc191eb'),
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
    commit: '217f68774a6703ba8b8fad602fdb47641ff77c6d',
    license: 'MIT',
    dependencies: [],
    files: [
      file('SKILL.md', 7179, '61613ec2957f38736e30942a32fe9c7189eae636'),
      file(
        'references/architecture-diagram-generation.md',
        9086,
        '31fb7a05696ff97c032aeb159f40c98c04831ecd'
      ),
      file('references/figure-table-layout.md', 2697, '586238bf76b57f39e4d6ec84fb2fa4117b4c2d29'),
      file(
        'references/palette-and-accessibility.md',
        2280,
        'cabf780bb0ee110a8e80bf570a3e5a76cb7ed7d8'
      ),
      file('references/plot-inspiration-map.md', 3688, '345ea7febbb76060a4d1492a27af6affdb0c5790'),
      file('references/python-plot-recipes.md', 5919, '7dda9bc4e796820066ecb6c3d853f5eddc6182c6'),
      file('references/render-qa.md', 5151, 'ab7c772a6dcda1d0d33f3a40801b3a2eb17fa219'),
      file('references/visual-contract.md', 4440, 'b9b7729a9aef7428517184ca212f7decf30ff1b8'),
      file(
        'references/adaptive-architecture-style.md',
        6217,
        '484276afaec65956e189ddb0092a43da618e277b'
      ),
      file('references/editable-pptx.md', 4796, '5295ca7d30ddcfbde37dc0619b06c693372af3f6'),
      file('references/icon-system.md', 3657, 'daf55f7197a240df8955cb409a1a61e1d5c47883'),
      file(
        'references/paper-vs-presentation-diagrams.md',
        4030,
        'd51dbdcd8572ee6e486192343499978314035f68'
      ),
      file(
        'references/reference-layout-blueprint.md',
        3003,
        'eaa332fc486083b3f77fafd26593e20bfc2a29c2'
      )
    ]
  },
  {
    skillId: 'ccf-paper-reviewer',
    displayName: 'CCF Paper Reviewer',
    description:
      'Review scientific novelty, soundness, evidence, writing, venue fit, and revision priorities through reviewer and area-chair perspectives.',
    repository: 'mikubaka88/CCFA-Skills',
    directory: 'ccf-paper-reviewer',
    commit: '217f68774a6703ba8b8fad602fdb47641ff77c6d',
    license: 'MIT',
    dependencies: [],
    files: [
      file('SKILL.md', 9010, '74eed51681cf13ea7b263707a078eed0eec87798'),
      file('references/calibration-and-rank.md', 6389, 'cec397a4c86cc25ea2577c054f1e15573fcd960a'),
      file('references/desk-checks.md', 1836, '5d05461545f96b306f13a3a867e6a21e7a00cbae'),
      file('references/fixed-output-format.md', 9040, '5537c6d25f46c0d5fe915ba7358655248c487533'),
      file('references/review-workflow.md', 3487, '3ad19474a6818bf5d9b9b361629aecf7c5659566'),
      file('references/reviewer-panel.md', 2860, 'ad1530d1f2d050254f012dc4165aa80d10b69e82'),
      file('references/source-notes.md', 2179, 'c721dc072381500bb0fa10d55e7be3032b6d3ff1'),
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
        1397,
        'ab1db3cb24e512c21871018bd4c987a57d932932'
      ),
      file(
        'references/writing-review/writing-review-rubric.md',
        7295,
        '36e28c081d8ccb2de87a613c3df57386a811c397'
      ),
      file('references/version-comparison.md', 6780, '3b94921b76250f824e1e11e6c937868e4703fb1c')
    ]
  },
  {
    skillId: 'ccf-integrity-auditor',
    displayName: 'CCF Integrity Auditor',
    description:
      'Audit claim-evidence alignment, numeric and terminology consistency, figure and table references, and existing citation support.',
    repository: 'mikubaka88/CCFA-Skills',
    directory: 'ccf-integrity-auditor',
    commit: '217f68774a6703ba8b8fad602fdb47641ff77c6d',
    license: 'MIT',
    dependencies: [],
    files: [file('SKILL.md', 3441, '9e8ce62eb3cafcdbc696f953deca499e59dcb55e')]
  },
  {
    skillId: 'nature-statistics',
    displayName: 'Nature Statistics',
    description:
      'Audit and revise statistical reporting, experimental units, replication, p values, uncertainty, multiple comparisons, and figure legends.',
    repository: 'Yuan1z0825/nature-skills',
    directory: 'skills/nature-statistics',
    commit: '28150f30f8b4017991fca8c7b2839f02c6586d2f',
    license: 'Apache-2.0',
    dependencies: [],
    files: [
      file('SKILL.md', 8728, '0dfa57b2e49ccb15eb8eebed0dc4aa57dc64bab7'),
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
  },
  {
    skillId: 'anti-defensive-writing',
    displayName: 'Anti-Defensive Writing (中文)',
    description: '围绕有证据支持的核心贡献组织论文，修改摘要、引言、实验和结论中的防御性表述。',
    repository: 'Adkid-Zephyr/anti-defensive-writing-Skill',
    directory: 'skills/anti-defensive-writing',
    commit: '102c8b21acf5eda3a0aef3d9779a65db646c8980',
    license: 'MIT',
    dependencies: [],
    files: [file('SKILL.md', 5523, '59879391d4e7eda0d0017cff89f1ecf0b2566b8c')]
  },
  {
    skillId: 'anti-defensive-writing-en',
    displayName: 'Anti-Defensive Writing (English)',
    description:
      'Organize a research paper around its evidence-backed contribution and revise defensive prose in its abstract, introduction, experiments, and conclusion.',
    repository: 'Adkid-Zephyr/anti-defensive-writing-Skill',
    directory: 'skills/anti-defensive-writing-en',
    commit: '102c8b21acf5eda3a0aef3d9779a65db646c8980',
    license: 'MIT',
    dependencies: [],
    files: [file('SKILL.md', 6419, '87a163642daa5674a7fed82eb9112ae703ee0e73')]
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
