import { createHash } from 'node:crypto'
import { formatSkillsForSystemPrompt } from '@earendil-works/pi-agent-core'
import type { Logger } from 'pino'
import {
  skillRunSnapshotSchema,
  type SkillRunSnapshot,
  type SkillSelection
} from '../../shared/contracts/skills'
import type { AgentSkillPromptInput } from '../agent/context'
import { formatWriteLlmSkill, virtualSkillPath, type WriteLlmSkill } from './prompt'
import type { SkillService } from './skill-service'

const MAX_CATALOG_SKILLS = 32
const MAX_CATALOG_BYTES = 16 * 1024

export interface SkillRunState {
  readonly mode: 'auto' | 'explicit' | 'none'
  readonly candidates: Map<string, WriteLlmSkill>
  primary: WriteLlmSkill | null
  lockingPrimaryUri: string | null
  dependencies: WriteLlmSkill[]
  readonly readResources: Set<string>
  readonly readingResources: Set<string>
}

export interface SkillRouteResult {
  snapshot: SkillRunSnapshot
  prompt: AgentSkillPromptInput
  modelRequestId: null
  state?: SkillRunState
}

export interface SkillReadResult {
  data: {
    skillId: string
    commit: string
    relativePath: string
    sha256: string
    byteSize: number
    content: string
    references: Array<{
      relativePath: string
      uri: string
      sha256: string
      byteSize: number
    }>
    dependencies: Array<{
      skillId: string
      commit: string
      relativePath: 'SKILL.md'
      sha256: string
      byteSize: number
      content: string
    }>
  }
  snapshot: SkillRunSnapshot
}

/** Main-owned progressive disclosure runtime. The historical class name is retained for wiring compatibility. */
export class WritingSkillRuntime {
  constructor(
    private readonly skills: SkillService,
    private readonly log: Pick<Logger, 'info' | 'warn' | 'error'>
  ) {}

  async validateSelection(selection: SkillSelection): Promise<void> {
    if (selection.mode === 'explicit') await this.skills.loadById(selection.skillId)
  }

  async route(input: {
    selection: SkillSelection
    reuseSnapshot?: SkillRunSnapshot
    signal: AbortSignal
    [key: string]: unknown
  }): Promise<SkillRouteResult> {
    if (input.reuseSnapshot !== undefined) return this.#reuse(input.reuseSnapshot)
    if (input.selection.mode === 'none') return emptyResult('none')
    if (input.selection.mode === 'explicit') {
      const primary = await this.skills.loadById(input.selection.skillId)
      return this.#explicit(primary)
    }

    const loaded = (await this.skills.loadEnabled())
      .filter((skill) => skill.disableModelInvocation !== true)
      .sort((a, b) => a.name.localeCompare(b.name) || a.skillId.localeCompare(b.skillId))
    const candidates = new Map<string, WriteLlmSkill>()
    let catalog = ''
    let truncated = false
    for (const skill of loaded) {
      if (candidates.size >= MAX_CATALOG_SKILLS) {
        truncated = true
        break
      }
      const next = [...candidates.values(), skill]
      const formatted = formatSkillsForSystemPrompt(next)
      if (Buffer.byteLength(formatted) > MAX_CATALOG_BYTES) {
        truncated = true
        break
      }
      candidates.set(skill.filePath, skill)
      catalog = formatted
    }
    if (truncated) {
      this.log.warn(
        {
          event: 'skill.catalog.truncated',
          candidateCount: loaded.length,
          includedCount: candidates.size
        },
        'Writing skill catalog was truncated'
      )
    }
    if (candidates.size === 0) return emptyResult('auto')
    return {
      snapshot: skillRunSnapshotSchema.parse({
        mode: 'auto',
        routingStatus: 'available',
        primary: null,
        dependencies: [],
        resources: [],
        safeError: truncated ? 'skill_catalog_truncated' : null
      }),
      prompt: { mode: 'auto', mandatory: catalog, references: [] },
      modelRequestId: null,
      state: {
        mode: 'auto',
        candidates,
        primary: null,
        lockingPrimaryUri: null,
        dependencies: [],
        readResources: new Set(),
        readingResources: new Set()
      }
    }
  }

  async read(state: SkillRunState, uri: string): Promise<SkillReadResult> {
    if (state.mode === 'none')
      throw new SkillReadError('unauthorized', 'Writing Skills are disabled')
    const candidate = state.candidates.get(uri)
    if (candidate !== undefined) {
      if (state.primary !== null && state.primary.skillId !== candidate.skillId) {
        throw new SkillReadError(
          'conflict',
          'A different primary Writing Skill is already selected'
        )
      }
      if (state.primary === null) {
        if (state.lockingPrimaryUri !== null) {
          throw new SkillReadError(
            'conflict',
            'A primary Writing Skill read is already in progress'
          )
        }
        state.lockingPrimaryUri = uri
        try {
          const dependencies = await this.#dependencies(candidate)
          state.primary = candidate
          state.dependencies = dependencies
        } finally {
          state.lockingPrimaryUri = null
        }
      }
      return {
        data: {
          ...entrypointData(candidate),
          references: candidate.files
            .filter((file) => file.path !== 'SKILL.md')
            .map((file) => ({
              relativePath: file.path,
              uri: virtualSkillPath(candidate.skillId, candidate.commit, file.path),
              sha256: file.sha256,
              byteSize: file.byteSize
            })),
          dependencies: state.dependencies.map(dependencyEntrypointData)
        },
        snapshot: snapshotFor(state, 'selected')
      }
    }
    if (state.primary === null) {
      const recoveryUri = [...state.candidates.keys()][0]
      throw new SkillReadError(
        'unauthorized',
        recoveryUri === undefined
          ? 'No run-authorized Writing Skill entrypoint is available'
          : `Expected a Writing Skill entrypoint before references; the next authorized URI is ${recoveryUri}`,
        recoveryUri
      )
    }
    const primary = state.primary
    const file = primary.files.find(
      (entry) =>
        entry.path !== 'SKILL.md' &&
        virtualSkillPath(primary.skillId, primary.commit, entry.path) === uri
    )
    if (file === undefined)
      throw new SkillReadError('unauthorized', 'Writing Skill URI is not authorized')
    const alreadyRead = state.readResources.has(file.path)
    if (!alreadyRead) {
      if (state.readingResources.has(file.path)) {
        throw new SkillReadError('conflict', 'Writing Skill reference read is already in progress')
      }
      if (state.readResources.size + state.readingResources.size >= 4) {
        throw new SkillReadError('conflict', 'The Writing Skill reference limit has been reached')
      }
      state.readingResources.add(file.path)
    }
    let content: string
    try {
      content = await this.skills.readResource(primary, file.path)
      state.readResources.add(file.path)
    } finally {
      state.readingResources.delete(file.path)
    }
    return {
      data: {
        skillId: primary.skillId,
        commit: primary.commit,
        relativePath: file.path,
        sha256: file.sha256,
        byteSize: file.byteSize,
        content,
        references: [],
        dependencies: []
      },
      snapshot: snapshotFor(state, 'selected')
    }
  }

  async #explicit(primary: WriteLlmSkill): Promise<SkillRouteResult> {
    const dependencies = await this.#dependencies(primary)
    const state: SkillRunState = {
      mode: 'explicit',
      candidates: new Map([[primary.filePath, primary]]),
      primary,
      lockingPrimaryUri: null,
      dependencies,
      readResources: new Set(),
      readingResources: new Set()
    }
    return {
      snapshot: snapshotFor(state, 'selected'),
      prompt: {
        mode: 'explicit',
        mandatory: [
          [primary, ...dependencies].map(formatWriteLlmSkill).join('\n\n'),
          referenceCatalog(primary)
        ]
          .filter(Boolean)
          .join('\n\n'),
        references: []
      },
      modelRequestId: null,
      state
    }
  }

  async #reuse(snapshot: SkillRunSnapshot): Promise<SkillRouteResult> {
    if (snapshot.primary === null) return emptyResult(snapshot.mode)
    const primary = await this.skills.loadVersion(snapshot.primary.skillId, snapshot.primary.commit)
    assertProvenance(primary, snapshot.primary)
    const dependencies: WriteLlmSkill[] = []
    for (const recorded of snapshot.dependencies) {
      const dependency = await this.skills.loadVersion(recorded.skillId, recorded.commit)
      assertProvenance(dependency, recorded)
      dependencies.push(dependency)
    }
    const state: SkillRunState = {
      mode: snapshot.mode,
      candidates: new Map([[primary.filePath, primary]]),
      primary,
      lockingPrimaryUri: null,
      dependencies,
      readResources: new Set(snapshot.resources),
      readingResources: new Set()
    }
    const references = await Promise.all(
      snapshot.resources.map(async (path) => ({
        path: virtualSkillPath(primary.skillId, primary.commit, path),
        content: await this.skills.readResource(primary, path)
      }))
    )
    return {
      snapshot: { ...snapshot, routingStatus: 'selected', safeError: null },
      prompt: {
        mode: snapshot.mode,
        mandatory: [
          [primary, ...dependencies].map(formatWriteLlmSkill).join('\n\n'),
          referenceCatalog(primary)
        ]
          .filter(Boolean)
          .join('\n\n'),
        references
      },
      modelRequestId: null,
      state
    }
  }

  async #dependencies(primary: WriteLlmSkill): Promise<WriteLlmSkill[]> {
    const result: WriteLlmSkill[] = []
    const visited = new Set([primary.skillId])
    const visit = async (skill: WriteLlmSkill): Promise<void> => {
      for (const id of skill.dependencies) {
        if (visited.has(id)) continue
        visited.add(id)
        const dependency = await this.skills.loadById(id)
        await visit(dependency)
        result.push(dependency)
      }
    }
    await visit(primary)
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

function entrypointData(skill: WriteLlmSkill) {
  const file = skill.files.find((entry) => entry.path === 'SKILL.md')
  if (file === undefined) throw new Error('Writing Skill manifest has no entrypoint')
  return {
    skillId: skill.skillId,
    commit: skill.commit,
    relativePath: 'SKILL.md' as const,
    sha256: file.sha256,
    byteSize: file.byteSize,
    content: skill.content,
    references: []
  }
}

function dependencyEntrypointData(skill: WriteLlmSkill) {
  const { references: _references, ...data } = entrypointData(skill)
  return data
}

function referenceCatalog(skill: WriteLlmSkill): string {
  const references = skill.files.filter((file) => file.path !== 'SKILL.md')
  if (references.length === 0) return ''
  return `<available_skill_references>\n${references
    .map(
      (file) =>
        `<reference path="${escapeXml(file.path)}" location="${escapeXml(virtualSkillPath(skill.skillId, skill.commit, file.path))}" bytes="${file.byteSize}" sha256="${file.sha256}" />`
    )
    .join('\n')}\n</available_skill_references>`
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
    mode: state.mode,
    routingStatus,
    primary: state.primary === null ? null : provenance(state.primary),
    dependencies: state.dependencies.map(provenance),
    resources: [...state.readResources],
    safeError: null
  })
}

function provenance(skill: WriteLlmSkill) {
  return {
    skillId: skill.skillId,
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

function assertProvenance(skill: WriteLlmSkill, recorded: ReturnType<typeof provenance>): void {
  if (provenance(skill).manifestSha256 !== recorded.manifestSha256) {
    throw new Error('The recorded Writing Skill manifest no longer matches its run snapshot')
  }
}

function emptyResult(mode: 'auto' | 'explicit' | 'none'): SkillRouteResult {
  return {
    snapshot: skillRunSnapshotSchema.parse({
      mode,
      routingStatus: 'not_needed',
      primary: null,
      dependencies: [],
      resources: [],
      safeError: null
    }),
    prompt: { mode, mandatory: '', references: [] },
    modelRequestId: null,
    state: {
      mode,
      candidates: new Map(),
      primary: null,
      lockingPrimaryUri: null,
      dependencies: [],
      readResources: new Set(),
      readingResources: new Set()
    }
  }
}
