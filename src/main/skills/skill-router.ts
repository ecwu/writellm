import { createHash } from 'node:crypto'
import { formatSkillsForSystemPrompt } from '@earendil-works/pi-agent-core'
import type { Logger } from 'pino'
import {
  skillRunSnapshotSchema,
  type SkillRunResource,
  type SkillRunSnapshot
} from '../../shared/contracts/skills'
import { parseLeadingSkillMentions } from '../../shared/skill-mentions'
import { estimateAgentTokens } from '../../shared/agent-context-budget'
import { MAX_SYSTEM_PROMPT_BYTES, type AgentSkillPromptInput } from '../agent/context'
import { formatWriteLlmSkill, virtualSkillPath, type WriteLlmSkill } from './prompt'
import type { SkillService } from './skill-service'

interface LoadedReference {
  skill: WriteLlmSkill
  resource: SkillRunResource
  content: string
}

export interface SkillRunState {
  readonly mode: 'auto' | 'explicit' | 'none'
  readonly candidates: Map<string, WriteLlmSkill>
  readonly automaticCandidateUris: Set<string>
  /** The subset of automatic candidates that fits the available prompt space. */
  catalogSkills?: readonly WriteLlmSkill[]
  readonly requestedSkills: WriteLlmSkill[]
  readonly invocationSources: Map<string, 'user' | 'agent'>
  readonly dependencyCandidates: Map<string, WriteLlmSkill>
  activeSkills: WriteLlmSkill[]
  dependencies: WriteLlmSkill[]
  readonly readResources: Map<string, LoadedReference>
}

export interface SkillRouteResult {
  snapshot: SkillRunSnapshot
  prompt: AgentSkillPromptInput
  modelRequestId: null
  state?: SkillRunState
}

interface SkillMentionResolution {
  attempted: boolean
  requested: WriteLlmSkill[]
  errorCode: SkillRouteError['code'] | null
}

interface SkillReferenceDescriptor {
  skillId: string
  displayName: string
  relativePath: string
  uri: string
  sha256: string
  byteSize: number
}

interface SkillDocumentResult {
  skillId: string
  displayName: string
  commit: string
  relativePath: string
  sha256: string
  byteSize: number
  content: string
  references: SkillReferenceDescriptor[]
}

interface SkillDependencyDescriptor {
  skillId: string
  displayName: string
  commit: string
  relativePath: 'SKILL.md'
  uri: string
  sha256: string
  byteSize: number
}

export interface SkillReadResult {
  data: SkillDocumentResult & { dependencies: SkillDependencyDescriptor[] }
  snapshot: SkillRunSnapshot
  prompt: AgentSkillPromptInput
}

/** Main-owned progressive disclosure runtime. The historical class name is retained for wiring compatibility. */
export class WritingSkillRuntime {
  constructor(
    private readonly skills: SkillService,
    private readonly log: Pick<Logger, 'info' | 'warn' | 'error'>
  ) {}

  async route(input: {
    userPrompt?: string
    maxCatalogBytes?: number
    maxCatalogTokens?: number
    signal: AbortSignal
    [key: string]: unknown
  }): Promise<SkillRouteResult> {
    const startedAt = Date.now()
    input.signal.throwIfAborted()
    const loaded = [...(await this.skills.loadEnabled())].sort(
      (a, b) => a.name.localeCompare(b.name) || a.skillId.localeCompare(b.skillId)
    )
    input.signal.throwIfAborted()
    const resolution = this.#resolveMentions(input.userPrompt ?? '', loaded)
    const requested = resolution.errorCode === null ? resolution.requested : []
    const automatic = loaded.filter((skill) => skill.disableModelInvocation !== true)
    const candidates = new Map<string, WriteLlmSkill>()
    for (const skill of requested) candidates.set(skill.filePath, skill)
    for (const skill of automatic) candidates.set(skill.filePath, skill)
    const automaticCandidateUris = new Set(automatic.map((skill) => skill.filePath))
    const mode = resolution.attempted ? 'explicit' : 'auto'
    const state = createState(mode, candidates, {
      automaticCandidateUris,
      catalogSkills: [],
      requestedSkills: requested,
      invocationSources: new Map(requested.map((skill) => [skill.skillId, 'user'] as const))
    })

    if (resolution.errorCode !== null) {
      state.catalogSkills = selectCatalogSkills(
        automatic,
        catalogBudget(input.maxCatalogBytes),
        catalogTokenBudget(input.maxCatalogTokens)
      )
      logCatalogBound(
        this.log,
        automatic.length,
        state.catalogSkills.length,
        catalogBudget(input.maxCatalogBytes),
        catalogTokenBudget(input.maxCatalogTokens)
      )
      return degradedResult(state, resolution.errorCode, startedAt, this.log)
    }

    if (requested.length > 0) {
      try {
        input.signal.throwIfAborted()
        state.activeSkills = [...requested]
        for (const skill of requested) await this.#prepareDependencyCandidates(state, skill)
        const rootPrompt = mandatoryPrompt(state)
        const availableBytes = Math.max(
          0,
          catalogBudget(input.maxCatalogBytes) - Buffer.byteLength(rootPrompt)
        )
        const catalogTokens = catalogTokenBudget(input.maxCatalogTokens)
        const availableTokens =
          catalogTokens === undefined
            ? undefined
            : Math.max(0, catalogTokens - estimateAgentTokens(rootPrompt))
        const catalogCandidates = automatic.filter(
          (skill) => !requested.some((requestedSkill) => requestedSkill.skillId === skill.skillId)
        )
        state.catalogSkills = selectCatalogSkills(
          catalogCandidates,
          availableBytes,
          availableTokens
        )
        logCatalogBound(
          this.log,
          catalogCandidates.length,
          state.catalogSkills.length,
          availableBytes,
          availableTokens
        )
        const prompt = promptFor(state)
        assertMandatoryBudget(prompt.mandatory)
        const snapshot = {
          ...snapshotFor(state, 'selected'),
          safeError: null
        }
        this.log.info(
          {
            event: 'skill.selection.injected',
            skillMode: mode,
            skillIds: requested.map((skill) => skill.skillId),
            skillVersions: requested.map((skill) => ({
              skillId: skill.skillId,
              commit: skill.commit
            })),
            dependencyVersions: [...state.dependencyCandidates.values()].map((skill) => ({
              skillId: skill.skillId,
              commit: skill.commit
            })),
            requestedCount: requested.length,
            selectedCount: requested.length,
            dependencyCount: state.dependencyCandidates.size,
            durationMs: Date.now() - startedAt
          },
          'Requested Writing Skill combination was injected'
        )
        return {
          snapshot,
          prompt,
          modelRequestId: null,
          state
        }
      } catch (err) {
        const code = routeFailureCode(err)
        this.log.warn(
          {
            event: 'skill.selection.rejected',
            err,
            code,
            skillMode: mode,
            skillIds: requested.map((skill) => skill.skillId),
            skillVersions: requested.map((skill) => ({
              skillId: skill.skillId,
              commit: skill.commit
            })),
            requestedCount: requested.length,
            dependencyCount: state.dependencies.length,
            durationMs: Date.now() - startedAt
          },
          'Requested Writing Skill combination was rejected'
        )
        state.activeSkills = []
        state.dependencies = []
        state.catalogSkills = selectCatalogSkills(
          automatic,
          catalogBudget(input.maxCatalogBytes),
          catalogTokenBudget(input.maxCatalogTokens)
        )
        logCatalogBound(
          this.log,
          automatic.length,
          state.catalogSkills.length,
          catalogBudget(input.maxCatalogBytes),
          catalogTokenBudget(input.maxCatalogTokens)
        )
        return degradedResult(state, code, startedAt, this.log)
      }
    }

    if (candidates.size === 0) return emptyResult('auto')
    const catalogBytes = catalogBudget(input.maxCatalogBytes)
    const catalogTokens = catalogTokenBudget(input.maxCatalogTokens)
    state.catalogSkills = selectCatalogSkills(automatic, catalogBytes, catalogTokens)
    logCatalogBound(
      this.log,
      automatic.length,
      state.catalogSkills.length,
      catalogBytes,
      catalogTokens
    )
    const mandatory = mandatoryPrompt(state)
    assertMandatoryBudget(mandatory)
    const snapshot = skillRunSnapshotSchema.parse({
      schemaVersion: 4,
      mode,
      routingStatus: 'available',
      requestedSkills: requested.map(provenance),
      skills: [],
      dependencies: [],
      resources: [],
      safeError: null
    })
    this.log.info(
      {
        event: 'skill.selection.prepared',
        skillMode: mode,
        candidateCount: candidates.size,
        requestedCount: requested.length,
        selectedCount: 0,
        dependencyCount: 0,
        durationMs: Date.now() - startedAt
      },
      'Writing Skill catalog prepared'
    )
    return {
      snapshot,
      prompt: { mode, mandatory, references: [] },
      modelRequestId: null,
      state
    }
  }

  async read(
    state: SkillRunState,
    uri: string,
    modelRequestId = 'direct',
    signal?: AbortSignal
  ): Promise<SkillReadResult> {
    signal?.throwIfAborted()
    if (state.mode === 'none') {
      throw new SkillReadError('unauthorized', 'Writing Skills are disabled')
    }
    void modelRequestId
    const candidate = state.candidates.get(uri)
    if (candidate !== undefined) {
      return this.#readEntrypoint(state, candidate, uri, signal)
    }
    const dependency = state.dependencyCandidates.get(uri)
    if (dependency !== undefined) {
      return this.#readDependencyEntrypoint(state, dependency, uri, signal)
    }
    return this.#readReference(state, uri, signal)
  }

  displayNameForUri(state: SkillRunState, uri: string): string | null {
    const candidate = state.candidates.get(uri)
    if (candidate !== undefined) return candidate.displayName
    const dependency = state.dependencyCandidates.get(uri)
    if (dependency !== undefined) return dependency.displayName
    for (const skill of [...state.activeSkills, ...state.dependencies]) {
      if (
        uri === skill.filePath ||
        skill.files.some((file) => virtualSkillPath(skill.skillId, skill.commit, file.path) === uri)
      ) {
        return skill.displayName
      }
    }
    return null
  }

  async #readEntrypoint(
    state: SkillRunState,
    candidate: WriteLlmSkill,
    _uri: string,
    signal?: AbortSignal
  ): Promise<SkillReadResult> {
    const existing = state.activeSkills.find((skill) => skill.skillId === candidate.skillId)
    if (existing !== undefined) return readResult(state, existing, true)
    const startedAt = Date.now()
    try {
      signal?.throwIfAborted()
      await this.#prepareDependencyCandidates(state, candidate)
      signal?.throwIfAborted()
      if (!state.activeSkills.some((skill) => skill.skillId === candidate.skillId)) {
        state.activeSkills = [...state.activeSkills, candidate]
      }
      const activeSkills = state.activeSkills
      if (!state.invocationSources.has(candidate.skillId)) {
        state.invocationSources.set(candidate.skillId, 'agent')
      }
      this.log.info(
        {
          event: 'skill.entrypoint.loaded',
          skillMode: state.mode,
          skillId: candidate.skillId,
          invocationSource: state.invocationSources.get(candidate.skillId) ?? 'agent',
          commit: candidate.commit,
          selectedCount: activeSkills.length,
          dependencyCount: candidate.dependencies.length,
          durationMs: Date.now() - startedAt
        },
        'Writing Skill entrypoint loaded'
      )
      return readResult(state, candidate, true)
    } catch (err) {
      this.log.warn(
        {
          event: 'skill.selection.rejected',
          err,
          skillMode: state.mode,
          skillId: candidate.skillId,
          selectedCount: state.activeSkills.length,
          durationMs: Date.now() - startedAt
        },
        'Writing Skill selection was rejected'
      )
      throw err
    }
  }

  async #readDependencyEntrypoint(
    state: SkillRunState,
    dependency: WriteLlmSkill,
    _uri: string,
    signal?: AbortSignal
  ): Promise<SkillReadResult> {
    const existing = state.dependencies.find((skill) => skill.skillId === dependency.skillId)
    if (existing !== undefined) return readResult(state, existing, false)
    if (state.activeSkills.length === 0) {
      throw new SkillReadError(
        'unauthorized',
        'Load a top-level Writing Skill before its dependencies'
      )
    }
    const startedAt = Date.now()
    try {
      signal?.throwIfAborted()
      await this.#prepareDependencyCandidates(state, dependency)
      if (!state.dependencies.some((skill) => skill.skillId === dependency.skillId)) {
        state.dependencies = [...state.dependencies, dependency]
      }
      this.log.info(
        {
          event: 'skill.entrypoint.loaded',
          skillMode: state.mode,
          skillId: dependency.skillId,
          commit: dependency.commit,
          entrypointKind: 'dependency',
          selectedCount: state.activeSkills.length,
          dependencyCount: state.dependencies.length,
          durationMs: Date.now() - startedAt
        },
        'Writing Skill dependency entrypoint loaded'
      )
      return readResult(state, dependency, false)
    } catch (err) {
      state.dependencies = state.dependencies.filter(
        (skill) => skill.skillId !== dependency.skillId
      )
      this.log.warn(
        {
          event: 'skill.selection.rejected',
          err,
          skillMode: state.mode,
          skillId: dependency.skillId,
          entrypointKind: 'dependency',
          durationMs: Date.now() - startedAt
        },
        'Writing Skill dependency load was rejected'
      )
      throw err
    }
  }

  async #readReference(
    state: SkillRunState,
    uri: string,
    signal?: AbortSignal
  ): Promise<SkillReadResult> {
    const located = locateReference(state, uri)
    if (located === null) {
      throw new SkillReadError('unauthorized', 'Writing Skill URI is not authorized')
    }
    const key = resourceKey(located.skill, located.file.path)
    const alreadyRead = state.readResources.get(key)
    if (alreadyRead !== undefined) return referenceReadResult(state, alreadyRead)
    const startedAt = Date.now()
    try {
      const content = await this.skills.readResource(located.skill, located.file.path)
      signal?.throwIfAborted()
      const loaded: LoadedReference = {
        skill: located.skill,
        resource: {
          skillId: located.skill.skillId,
          commit: located.skill.commit,
          relativePath: located.file.path,
          sha256: located.file.sha256,
          byteSize: located.file.byteSize
        },
        content
      }
      state.readResources.set(key, loaded)
      const referenceBytes = [...state.readResources.values()].reduce(
        (total, entry) => total + (entry.resource.byteSize ?? 0),
        0
      )
      this.log.info(
        {
          event: 'skill.reference.loaded',
          skillMode: state.mode,
          skillId: located.skill.skillId,
          commit: located.skill.commit,
          relativePath: located.file.path,
          byteSize: located.file.byteSize,
          referenceCount: state.readResources.size,
          referenceBytes,
          durationMs: Date.now() - startedAt
        },
        'Writing Skill reference loaded'
      )
      return referenceReadResult(state, loaded)
    } catch (err) {
      this.log.warn(
        {
          event: 'skill.selection.rejected',
          err,
          skillMode: state.mode,
          skillId: located.skill.skillId,
          relativePath: located.file.path,
          byteSize: located.file.byteSize,
          durationMs: Date.now() - startedAt
        },
        'Writing Skill reference read was rejected'
      )
      throw err
    }
  }

  #resolveMentions(prompt: string, loaded: readonly WriteLlmSkill[]): SkillMentionResolution {
    const startedAt = Date.now()
    const names = [...new Set(parseLeadingSkillMentions(prompt).map((mention) => mention.name))]
    if (names.length === 0) return { attempted: false, requested: [], errorCode: null }
    const installed = this.skills.snapshot().installed
    const requested: WriteLlmSkill[] = []
    for (const name of names) {
      const matchingInstalled = installed.filter((skill) => skill.name === name)
      const matchingLoaded = loaded.filter((skill) => skill.name === name)
      if (matchingLoaded.length > 1) {
        return this.#rejectMention(
          'skill_mention_ambiguous',
          matchingLoaded.map((skill) => skill.skillId),
          `Writing Skill name is ambiguous: ${name}`,
          startedAt
        )
      }
      if (matchingLoaded.length === 1) requested.push(matchingLoaded[0] as WriteLlmSkill)
      else if (matchingInstalled.length > 0) {
        return this.#rejectMention(
          'skill_mention_unavailable',
          matchingInstalled.map((skill) => skill.skillId),
          `Writing Skill is disabled or unavailable: ${name}`,
          startedAt
        )
      }
    }
    this.log.info(
      {
        event: 'skill.mention.resolved',
        source: 'user',
        requestedCount: requested.length,
        skillIds: requested.map((skill) => skill.skillId),
        durationMs: Date.now() - startedAt
      },
      'Writing Skill mentions resolved'
    )
    return { attempted: requested.length > 0, requested, errorCode: null }
  }

  #rejectMention(
    code: SkillRouteError['code'],
    skillIds: readonly string[],
    message: string,
    startedAt: number
  ): SkillMentionResolution {
    this.log.warn(
      {
        event: 'skill.mention.rejected',
        code,
        reason: message,
        source: 'user',
        candidateCount: skillIds.length,
        skillIds,
        durationMs: Date.now() - startedAt
      },
      'Writing Skill mention rejected'
    )
    return { attempted: true, requested: [], errorCode: code }
  }

  async #prepareDependencyCandidates(state: SkillRunState, skill: WriteLlmSkill): Promise<void> {
    for (const dependencyId of skill.dependencies) {
      if (
        [...state.activeSkills, ...state.dependencies, ...state.dependencyCandidates.values()].some(
          (candidate) => candidate.skillId === dependencyId
        )
      ) {
        continue
      }
      try {
        const dependency = await this.skills.loadById(dependencyId)
        state.dependencyCandidates.set(dependency.filePath, dependency)
      } catch (err) {
        // A missing optional dependency should not prevent its root entrypoint from being useful.
        // The model receives the root content and can continue with the remaining authorized files.
        this.log.info(
          {
            event: 'skill.dependency.unavailable',
            err,
            skillId: skill.skillId,
            dependencyId
          },
          'Writing Skill dependency is unavailable during progressive discovery'
        )
      }
    }
  }
}

export class SkillReadError extends Error {
  constructor(
    readonly code: 'unauthorized' | 'conflict',
    message: string,
    readonly recoveryUri?: string
  ) {
    super(message)
  }
}

export class SkillRouteError extends Error {
  constructor(
    readonly code:
      | 'skill_mention_ambiguous'
      | 'skill_mention_unavailable'
      | 'skill_mention_limit'
      | 'skill_prompt_budget_exceeded',
    message: string
  ) {
    super(message)
    this.name = 'SkillRouteError'
  }
}

function createState(
  mode: SkillRunState['mode'],
  candidates: Map<string, WriteLlmSkill>,
  options: {
    automaticCandidateUris?: Set<string>
    catalogSkills?: readonly WriteLlmSkill[]
    requestedSkills?: WriteLlmSkill[]
    invocationSources?: Map<string, 'user' | 'agent'>
    dependencyCandidates?: Map<string, WriteLlmSkill>
  } = {}
): SkillRunState {
  return {
    mode,
    candidates,
    automaticCandidateUris: options.automaticCandidateUris ?? new Set(),
    catalogSkills: options.catalogSkills,
    requestedSkills: options.requestedSkills ?? [],
    invocationSources: options.invocationSources ?? new Map(),
    dependencyCandidates: options.dependencyCandidates ?? new Map(),
    activeSkills: [],
    dependencies: [],
    readResources: new Map()
  }
}

function entrypointData(state: SkillRunState, skill: WriteLlmSkill): SkillDocumentResult {
  const file = skill.files.find((entry) => entry.path === 'SKILL.md')
  if (file === undefined) throw new Error('Writing Skill manifest has no entrypoint')
  return {
    skillId: skill.skillId,
    displayName: skill.displayName,
    commit: skill.commit,
    relativePath: 'SKILL.md',
    sha256: file.sha256,
    byteSize: file.byteSize,
    content: skill.content,
    references: referenceDescriptors(state, skill)
  }
}

function referenceDescriptors(
  _state: SkillRunState,
  skill: WriteLlmSkill
): SkillReferenceDescriptor[] {
  return skill.files
    .filter((file) => file.path !== 'SKILL.md')
    .map((file) => ({
      skillId: skill.skillId,
      displayName: skill.displayName,
      relativePath: file.path,
      uri: virtualSkillPath(skill.skillId, skill.commit, file.path),
      sha256: file.sha256,
      byteSize: file.byteSize
    }))
}

function dependencyDescriptor(skill: WriteLlmSkill): SkillDependencyDescriptor {
  const file = skill.files.find((entry) => entry.path === 'SKILL.md')
  if (file === undefined) throw new Error('Writing Skill manifest has no entrypoint')
  return {
    skillId: skill.skillId,
    displayName: skill.displayName,
    commit: skill.commit,
    relativePath: 'SKILL.md',
    uri: skill.filePath,
    sha256: file.sha256,
    byteSize: file.byteSize
  }
}

function readResult(
  state: SkillRunState,
  skill: WriteLlmSkill,
  _topLevel: boolean
): SkillReadResult {
  return {
    data: {
      ...entrypointData(state, skill),
      dependencies: dependencyDescriptorsFor(state, skill)
    },
    snapshot: snapshotFor(state, 'selected'),
    prompt: promptFor(state)
  }
}

function dependencyDescriptorsFor(
  state: SkillRunState,
  skill: WriteLlmSkill
): SkillDependencyDescriptor[] {
  return skill.dependencies
    .map((dependencyId) =>
      [...state.dependencies, ...state.dependencyCandidates.values()].find(
        (candidate) => candidate.skillId === dependencyId
      )
    )
    .filter((candidate): candidate is WriteLlmSkill => candidate !== undefined)
    .map(dependencyDescriptor)
}

function dependencyCatalog(state: SkillRunState, skill: WriteLlmSkill): string {
  const dependencies = dependencyDescriptorsFor(state, skill)
  if (dependencies.length === 0) return ''
  return `<available_skill_dependencies skillId="${escapeXml(skill.skillId)}" displayName="${escapeXml(skill.displayName)}">\n${dependencies
    .map(
      (dependency) =>
        `<dependency skillId="${escapeXml(dependency.skillId)}" displayName="${escapeXml(dependency.displayName)}" location="${escapeXml(dependency.uri)}" bytes="${dependency.byteSize}" sha256="${dependency.sha256}" />`
    )
    .join('\n')}\n</available_skill_dependencies>`
}

function referenceReadResult(state: SkillRunState, loaded: LoadedReference): SkillReadResult {
  return {
    data: {
      skillId: loaded.skill.skillId,
      displayName: loaded.skill.displayName,
      commit: loaded.skill.commit,
      relativePath: loaded.resource.relativePath,
      sha256: loaded.resource.sha256 ?? '',
      byteSize: loaded.resource.byteSize ?? 0,
      content: loaded.content,
      references: [],
      dependencies: []
    },
    snapshot: snapshotFor(state, 'selected'),
    prompt: promptFor(state)
  }
}

function locateReference(
  state: SkillRunState,
  uri: string
): { skill: WriteLlmSkill; file: WriteLlmSkill['files'][number] } | null {
  for (const skill of [...state.candidates.values(), ...state.dependencyCandidates.values()]) {
    const file = skill.files.find(
      (entry) =>
        entry.path !== 'SKILL.md' &&
        virtualSkillPath(skill.skillId, skill.commit, entry.path) === uri
    )
    if (file !== undefined) return { skill, file }
  }
  return null
}

function referenceCatalog(state: SkillRunState, skill: WriteLlmSkill): string {
  const references = referenceDescriptors(state, skill)
  if (references.length === 0) return ''
  return `<available_skill_references skillId="${escapeXml(skill.skillId)}" displayName="${escapeXml(skill.displayName)}">\n${references
    .map(
      (file) =>
        `<reference path="${escapeXml(file.relativePath)}" location="${escapeXml(file.uri)}" bytes="${file.byteSize}" sha256="${file.sha256}" />`
    )
    .join('\n')}\n</available_skill_references>`
}

function catalogSkills(state: SkillRunState): readonly WriteLlmSkill[] {
  return (
    state.catalogSkills ??
    [...state.candidates.values()].filter((skill) =>
      state.automaticCandidateUris.has(skill.filePath)
    )
  )
}

function mandatoryPrompt(state: SkillRunState): string {
  // Only user-requested roots are prompt instructions. Agent-discovered roots and dependencies
  // are ordinary tool results; retaining their bodies in the next system prompt creates a hidden
  // loading contract and makes every read pay the prompt cost again.
  const loaded = state.requestedSkills
  const invocation = loaded.map(formatWriteLlmSkill).join('\n\n')
  const catalogs = loaded
    .flatMap((skill) => [referenceCatalog(state, skill), dependencyCatalog(state, skill)])
    .filter(Boolean)
    .join('\n\n')
  const loadedIds = new Set(loaded.map((skill) => skill.skillId))
  const remaining = catalogSkills(state).filter((skill) => !loadedIds.has(skill.skillId))
  const catalog = remaining.length === 0 ? '' : formatSkillsForSystemPrompt(remaining)
  return [invocation, catalogs, catalog].filter(Boolean).join('\n\n')
}

function promptFor(state: SkillRunState): AgentSkillPromptInput {
  return {
    mode: state.mode,
    mandatory: mandatoryPrompt(state),
    // Skill reads are ordinary tool results. Persist their provenance in the snapshot and return
    // the content in the tool payload, but do not silently replay it into every later system
    // prompt (including explicit reference reads).
    references: []
  }
}

function assertMandatoryBudget(mandatory: string): void {
  if (Buffer.byteLength(mandatory) > MAX_SYSTEM_PROMPT_BYTES) {
    throw new Error('The selected Writing Skill combination exceeds the system prompt budget')
  }
}

function catalogBudget(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return MAX_SYSTEM_PROMPT_BYTES
  }
  return Math.min(value, MAX_SYSTEM_PROMPT_BYTES)
}

function catalogTokenBudget(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return undefined
  return value
}

function isSkillPromptBudgetError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('system prompt budget')
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function snapshotFor(state: SkillRunState, routingStatus: 'selected'): SkillRunSnapshot {
  return skillRunSnapshotSchema.parse({
    schemaVersion: 4,
    mode: state.mode,
    routingStatus,
    requestedSkills: state.requestedSkills.map(provenance),
    skills: state.activeSkills.map((skill) => ({
      ...provenance(skill),
      invocationSource: state.invocationSources.get(skill.skillId) ?? 'agent'
    })),
    dependencies: state.dependencies.map(provenance),
    resources: [...state.readResources.values()].map((entry) => entry.resource),
    safeError: null
  })
}

function provenance(skill: WriteLlmSkill) {
  return {
    skillId: skill.skillId,
    displayName: skill.displayName,
    name: skill.name,
    commit: skill.commit,
    manifestSha256: createHash('sha256')
      .update(
        JSON.stringify({
          source: skill.source,
          dependencies: skill.dependencies,
          files: skill.files
        })
      )
      .digest('hex')
  }
}

function resourceKey(skill: WriteLlmSkill, relativePath: string): string {
  return `${skill.skillId}\u0000${skill.commit}\u0000${relativePath}`
}

function automaticPromptFor(
  state: SkillRunState,
  selectedCatalog: readonly WriteLlmSkill[] = catalogSkills(state)
): AgentSkillPromptInput {
  const candidates = selectedCatalog
  return {
    mode: 'auto',
    mandatory: candidates.length === 0 ? '' : formatSkillsForSystemPrompt([...candidates]),
    references: []
  }
}

function selectCatalogSkills(
  candidates: readonly WriteLlmSkill[],
  maxBytes: number,
  maxTokens: number | undefined
): WriteLlmSkill[] {
  const selected: WriteLlmSkill[] = []
  for (const skill of candidates) {
    const next = [...selected, skill]
    const formatted = formatSkillsForSystemPrompt(next)
    if (
      Buffer.byteLength(formatted) <= maxBytes &&
      (maxTokens === undefined || estimateAgentTokens(formatted) <= maxTokens)
    ) {
      selected.push(skill)
    }
  }
  return selected
}

function logCatalogBound(
  log: Pick<Logger, 'info'>,
  candidateCount: number,
  includedCount: number,
  availableBytes: number,
  availableTokens: number | undefined
): void {
  if (includedCount >= candidateCount) return
  log.info(
    {
      event: 'skill.catalog.bounded',
      candidateCount,
      includedCount,
      availableBytes,
      ...(availableTokens === undefined ? {} : { availableTokens })
    },
    'Writing skill catalog was bounded by available system prompt space'
  )
}

function degradedResult(
  state: SkillRunState,
  code: string,
  startedAt: number,
  log: Pick<Logger, 'info' | 'warn' | 'error'>
): SkillRouteResult {
  state.activeSkills = []
  state.dependencies = []
  state.requestedSkills.length = 0
  state.invocationSources.clear()
  for (const uri of state.candidates.keys()) {
    if (!state.automaticCandidateUris.has(uri)) state.candidates.delete(uri)
  }
  const prompt = automaticPromptFor(state)
  log.info(
    {
      event: 'skill.selection.degraded',
      skillMode: 'explicit',
      code,
      candidateCount: state.automaticCandidateUris.size,
      durationMs: Date.now() - startedAt
    },
    'Requested Writing Skill injection degraded without failing the Agent run'
  )
  return {
    snapshot: skillRunSnapshotSchema.parse({
      schemaVersion: 4,
      mode: 'explicit',
      routingStatus: 'degraded',
      requestedSkills: [],
      skills: [],
      dependencies: [],
      resources: [],
      safeError: code
    }),
    prompt,
    modelRequestId: null,
    state
  }
}

function routeFailureCode(error: unknown): string {
  if (isSkillPromptBudgetError(error)) return 'skill_prompt_budget_exceeded'
  if (error instanceof Error && error.message.includes('dependency cycle')) {
    return 'skill_dependency_cycle'
  }
  if (error instanceof Error && error.message.includes('dependency limit')) {
    return 'skill_dependency_limit'
  }
  return 'skill_dependency_unavailable'
}

function emptyResult(mode: 'auto' | 'explicit' | 'none'): SkillRouteResult {
  const state = createState(mode, new Map())
  return {
    snapshot: skillRunSnapshotSchema.parse({
      schemaVersion: 4,
      mode,
      routingStatus: 'not_needed',
      requestedSkills: [],
      skills: [],
      dependencies: [],
      resources: [],
      safeError: null
    }),
    prompt: { mode, mandatory: '', references: [] },
    modelRequestId: null,
    state
  }
}
