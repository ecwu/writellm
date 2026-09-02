import { createHash } from 'node:crypto'
import { formatSkillsForSystemPrompt } from '@earendil-works/pi-agent-core'
import type { Logger } from 'pino'
import {
  SKILL_MAX_ACTIVE_SKILLS,
  SKILL_MAX_DEPENDENCIES,
  SKILL_MAX_RUN_REFERENCES,
  SKILL_MAX_RUN_REFERENCE_BYTES,
  skillRunSnapshotSchema,
  type SkillRunResource,
  type SkillRunSnapshot
} from '../../shared/contracts/skills'
import { parseLeadingSkillMentions } from '../../shared/skill-mentions'
import { MAX_SYSTEM_PROMPT_BYTES, type AgentSkillPromptInput } from '../agent/context'
import { formatWriteLlmSkill, virtualSkillPath, type WriteLlmSkill } from './prompt'
import type { SkillService } from './skill-service'

const MAX_CATALOG_SKILLS = 32
const MAX_CATALOG_BYTES = 16 * 1024

interface LoadedReference {
  skill: WriteLlmSkill
  resource: SkillRunResource
  content: string
}

export interface SkillRunState {
  readonly mode: 'auto' | 'explicit' | 'none'
  readonly candidates: Map<string, WriteLlmSkill>
  readonly automaticCandidateUris: Set<string>
  readonly requestedSkills: WriteLlmSkill[]
  readonly invocationSources: Map<string, 'user' | 'agent'>
  readonly dependencyCandidates: Map<string, WriteLlmSkill>
  activeSkills: WriteLlmSkill[]
  dependencies: WriteLlmSkill[]
  loadingEntrypointUri: string | null
  readonly entrypointModelRequestIds: Set<string>
  readonly readResources: Map<string, LoadedReference>
  readonly readingResources: Map<string, number>
  preparationClosed: boolean
}

export interface SkillRouteResult {
  snapshot: SkillRunSnapshot
  prompt: AgentSkillPromptInput
  fallbackPrompt?: AgentSkillPromptInput
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
    const automaticCandidateUris = new Set<string>()
    let truncated = false
    const catalogSkills: WriteLlmSkill[] = []
    for (const skill of automatic) {
      if (catalogSkills.length >= MAX_CATALOG_SKILLS) {
        truncated = true
        break
      }
      const next = [...catalogSkills, skill]
      const formatted = formatSkillsForSystemPrompt(next)
      if (Buffer.byteLength(formatted) > MAX_CATALOG_BYTES) {
        truncated = true
        break
      }
      candidates.set(skill.filePath, skill)
      automaticCandidateUris.add(skill.filePath)
      catalogSkills.push(skill)
    }
    if (truncated) {
      this.log.warn(
        {
          event: 'skill.catalog.truncated',
          candidateCount: automatic.length,
          includedCount: catalogSkills.length
        },
        'Writing skill catalog was truncated'
      )
    }
    const mode = resolution.attempted ? 'explicit' : 'auto'
    const state = createState(mode, candidates, {
      automaticCandidateUris,
      requestedSkills: requested,
      invocationSources: new Map(requested.map((skill) => [skill.skillId, 'user'] as const))
    })

    if (resolution.errorCode !== null) {
      return degradedResult(state, resolution.errorCode, truncated, startedAt, this.log)
    }

    if (requested.length > 0) {
      try {
        const requestedDependencies = await this.#dependenciesFor(requested)
        input.signal.throwIfAborted()
        state.activeSkills = [...requested]
        state.dependencies = requestedDependencies
        const prompt = promptFor(state)
        assertMandatoryBudget(prompt.mandatory)
        const snapshot = {
          ...snapshotFor(state, 'selected'),
          safeError: truncated ? 'skill_catalog_truncated' : null
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
            dependencyVersions: requestedDependencies.map((skill) => ({
              skillId: skill.skillId,
              commit: skill.commit
            })),
            requestedCount: requested.length,
            selectedCount: requested.length,
            dependencyCount: requestedDependencies.length,
            durationMs: Date.now() - startedAt
          },
          'Requested Writing Skill combination was injected'
        )
        return {
          snapshot,
          prompt,
          fallbackPrompt: automaticPromptFor(state),
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
        return degradedResult(state, code, truncated, startedAt, this.log)
      }
    }

    if (candidates.size === 0) return emptyResult('auto')
    const mandatory = mandatoryPrompt(state)
    assertMandatoryBudget(mandatory)
    const snapshot = skillRunSnapshotSchema.parse({
      schemaVersion: 3,
      mode,
      routingStatus: 'available',
      requestedSkills: requested.map(provenance),
      skills: [],
      dependencies: [],
      resources: [],
      safeError: truncated ? 'skill_catalog_truncated' : null
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
    if (state.preparationClosed) {
      throw new SkillReadError('conflict', 'Writing Skill preparation is already complete')
    }
    if (state.mode === 'none') {
      throw new SkillReadError('unauthorized', 'Writing Skills are disabled')
    }
    const candidate = state.candidates.get(uri)
    if (candidate !== undefined) {
      return this.#readEntrypoint(state, candidate, uri, modelRequestId, signal)
    }
    const dependency = state.dependencyCandidates.get(uri)
    if (dependency !== undefined) {
      return this.#readDependencyEntrypoint(state, dependency, uri, modelRequestId, signal)
    }
    return this.#readReference(state, uri, signal)
  }

  closePreparation(state: SkillRunState): void {
    state.preparationClosed = true
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
    uri: string,
    modelRequestId: string,
    signal?: AbortSignal
  ): Promise<SkillReadResult> {
    const existing = state.activeSkills.find((skill) => skill.skillId === candidate.skillId)
    if (existing !== undefined) return readResult(state, existing, true)
    if (state.entrypointModelRequestIds.has(modelRequestId)) {
      throw new SkillReadError(
        'conflict',
        'Only one new Writing Skill entrypoint may be loaded in one assistant response'
      )
    }
    if (state.activeSkills.length >= SKILL_MAX_ACTIVE_SKILLS) {
      throw new SkillReadError('conflict', 'The Writing Skill selection limit has been reached')
    }
    if (state.loadingEntrypointUri !== null) {
      throw new SkillReadError('conflict', 'A Writing Skill entrypoint read is already in progress')
    }
    state.loadingEntrypointUri = uri
    const startedAt = Date.now()
    try {
      const activeSkills = [...state.activeSkills, candidate]
      const dependencyClosure = await this.#dependenciesFor(activeSkills)
      signal?.throwIfAborted()
      assertMandatoryBudget(mandatoryPrompt(state, activeSkills, dependencyClosure))
      state.activeSkills = activeSkills
      if (!state.invocationSources.has(candidate.skillId)) {
        state.invocationSources.set(candidate.skillId, 'agent')
      }
      const closureIds = new Set(dependencyClosure.map((skill) => skill.skillId))
      state.dependencies = state.dependencies.filter((skill) => closureIds.has(skill.skillId))
      state.dependencyCandidates.clear()
      for (const dependency of dependencyClosure) {
        if (!state.dependencies.some((skill) => skill.skillId === dependency.skillId)) {
          state.dependencyCandidates.set(dependency.filePath, dependency)
        }
      }
      state.entrypointModelRequestIds.add(modelRequestId)
      this.log.info(
        {
          event: 'skill.entrypoint.loaded',
          skillMode: state.mode,
          skillId: candidate.skillId,
          invocationSource: state.invocationSources.get(candidate.skillId) ?? 'agent',
          commit: candidate.commit,
          selectedCount: activeSkills.length,
          dependencyCount: dependencyClosure.length,
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
    } finally {
      state.loadingEntrypointUri = null
    }
  }

  async #readDependencyEntrypoint(
    state: SkillRunState,
    dependency: WriteLlmSkill,
    uri: string,
    modelRequestId: string,
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
    if (state.entrypointModelRequestIds.has(modelRequestId)) {
      throw new SkillReadError(
        'conflict',
        'Only one new Writing Skill entrypoint may be loaded in one assistant response'
      )
    }
    if (state.loadingEntrypointUri !== null) {
      throw new SkillReadError('conflict', 'A Writing Skill entrypoint read is already in progress')
    }
    state.loadingEntrypointUri = uri
    const startedAt = Date.now()
    try {
      signal?.throwIfAborted()
      state.dependencies = [...state.dependencies, dependency]
      state.dependencyCandidates.delete(uri)
      assertMandatoryBudget(mandatoryPrompt(state))
      state.entrypointModelRequestIds.add(modelRequestId)
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
      state.dependencyCandidates.set(uri, dependency)
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
    } finally {
      state.loadingEntrypointUri = null
    }
  }

  async #readReference(
    state: SkillRunState,
    uri: string,
    signal?: AbortSignal
  ): Promise<SkillReadResult> {
    if (state.activeSkills.length === 0) {
      const recoveryUri = [...state.candidates.keys()][0]
      throw new SkillReadError(
        'unauthorized',
        recoveryUri === undefined
          ? 'No run-authorized Writing Skill entrypoint is available'
          : `Expected a Writing Skill entrypoint before references; the next authorized URI is ${recoveryUri}`,
        recoveryUri
      )
    }
    const located = locateReference(state, uri)
    if (located === null) {
      throw new SkillReadError('unauthorized', 'Writing Skill URI is not authorized')
    }
    const key = resourceKey(located.skill, located.file.path)
    const alreadyRead = state.readResources.get(key)
    if (alreadyRead !== undefined) return referenceReadResult(state, alreadyRead)
    if (state.readingResources.has(key)) {
      throw new SkillReadError('conflict', 'Writing Skill reference read is already in progress')
    }
    if (state.readResources.size + state.readingResources.size >= SKILL_MAX_RUN_REFERENCES) {
      throw new SkillReadError(
        'conflict',
        'The Writing Skill reference file limit has been reached'
      )
    }
    const retainedBytes = [...state.readResources.values()].reduce(
      (total, entry) => total + (entry.resource.byteSize ?? 0),
      0
    )
    const readingBytes = [...state.readingResources.values()].reduce(
      (total, byteSize) => total + byteSize,
      0
    )
    if (retainedBytes + readingBytes + located.file.byteSize > SKILL_MAX_RUN_REFERENCE_BYTES) {
      throw new SkillReadError(
        'conflict',
        'The Writing Skill reference byte budget has been reached'
      )
    }
    state.readingResources.set(key, located.file.byteSize)
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
    } finally {
      state.readingResources.delete(key)
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
    if (requested.length > SKILL_MAX_ACTIVE_SKILLS) {
      return this.#rejectMention(
        'skill_mention_limit',
        requested.map((skill) => skill.skillId),
        `Up to ${SKILL_MAX_ACTIVE_SKILLS} Writing Skills may be requested`,
        startedAt
      )
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

  async #dependenciesFor(activeSkills: readonly WriteLlmSkill[]): Promise<WriteLlmSkill[]> {
    const topLevelIds = new Set(activeSkills.map((skill) => skill.skillId))
    const loaded = new Map(activeSkills.map((skill) => [skill.skillId, skill]))
    const result: WriteLlmSkill[] = []
    const emitted = new Set<string>()
    const visiting = new Set<string>()
    const visit = async (skill: WriteLlmSkill): Promise<void> => {
      if (visiting.has(skill.skillId)) throw new Error('Writing Skill dependency cycle detected')
      visiting.add(skill.skillId)
      try {
        for (const id of skill.dependencies) {
          let dependency = loaded.get(id)
          if (dependency === undefined) {
            dependency = await this.skills.loadById(id)
            loaded.set(id, dependency)
          }
          await visit(dependency)
          if (!topLevelIds.has(id) && !emitted.has(id)) {
            emitted.add(id)
            result.push(dependency)
            if (result.length > SKILL_MAX_DEPENDENCIES) {
              throw new Error('Writing Skill dependency limit exceeded')
            }
          }
        }
      } finally {
        visiting.delete(skill.skillId)
      }
    }
    for (const skill of activeSkills) await visit(skill)
    return result
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
    requestedSkills?: WriteLlmSkill[]
    invocationSources?: Map<string, 'user' | 'agent'>
    dependencyCandidates?: Map<string, WriteLlmSkill>
  } = {}
): SkillRunState {
  return {
    mode,
    candidates,
    automaticCandidateUris: options.automaticCandidateUris ?? new Set(),
    requestedSkills: options.requestedSkills ?? [],
    invocationSources: options.invocationSources ?? new Map(),
    dependencyCandidates: options.dependencyCandidates ?? new Map(),
    activeSkills: [],
    dependencies: [],
    loadingEntrypointUri: null,
    entrypointModelRequestIds: new Set(),
    readResources: new Map(),
    readingResources: new Map(),
    preparationClosed: false
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
  topLevel: boolean
): SkillReadResult {
  return {
    data: {
      ...entrypointData(state, skill),
      dependencies: topLevel
        ? [...state.dependencyCandidates.values()].map(dependencyDescriptor)
        : []
    },
    snapshot: snapshotFor(state, 'selected'),
    prompt: promptFor(state)
  }
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
  for (const skill of [...state.activeSkills, ...state.dependencies]) {
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

function mandatoryPrompt(
  state: SkillRunState,
  activeSkills: readonly WriteLlmSkill[] = state.activeSkills,
  dependencies: readonly WriteLlmSkill[] = state.dependencies
): string {
  const loaded = [...activeSkills, ...dependencies]
  const invocation = loaded.map(formatWriteLlmSkill).join('\n\n')
  const catalogs = loaded
    .map((skill) => referenceCatalog(state, skill))
    .filter(Boolean)
    .join('\n\n')
  const loadedIds = new Set([...activeSkills, ...dependencies].map((skill) => skill.skillId))
  const remaining = [...state.candidates.values()].filter(
    (skill) => state.automaticCandidateUris.has(skill.filePath) && !loadedIds.has(skill.skillId)
  )
  const catalog = remaining.length === 0 ? '' : formatSkillsForSystemPrompt(remaining)
  return [invocation, catalogs, catalog].filter(Boolean).join('\n\n')
}

function promptFor(state: SkillRunState): AgentSkillPromptInput {
  return {
    mode: state.mode,
    mandatory: mandatoryPrompt(state),
    references: [...state.readResources.values()].map((entry) => ({
      path: virtualSkillPath(entry.skill.skillId, entry.skill.commit, entry.resource.relativePath),
      content: entry.content
    }))
  }
}

function assertMandatoryBudget(mandatory: string): void {
  if (Buffer.byteLength(mandatory) > MAX_SYSTEM_PROMPT_BYTES) {
    throw new Error('The selected Writing Skill combination exceeds the system prompt budget')
  }
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
    schemaVersion: 3,
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

function automaticPromptFor(state: SkillRunState): AgentSkillPromptInput {
  const candidates = [...state.candidates.values()].filter((skill) =>
    state.automaticCandidateUris.has(skill.filePath)
  )
  return {
    mode: 'auto',
    mandatory: candidates.length === 0 ? '' : formatSkillsForSystemPrompt(candidates),
    references: []
  }
}

function degradedResult(
  state: SkillRunState,
  code: string,
  catalogTruncated: boolean,
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
      catalogTruncated,
      durationMs: Date.now() - startedAt
    },
    'Requested Writing Skill injection degraded without failing the Agent run'
  )
  return {
    snapshot: skillRunSnapshotSchema.parse({
      schemaVersion: 3,
      mode: 'explicit',
      routingStatus: 'degraded',
      requestedSkills: [],
      skills: [],
      dependencies: [],
      resources: [],
      safeError: code
    }),
    prompt,
    fallbackPrompt: prompt,
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
      schemaVersion: 3,
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
