import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { Logger } from 'pino'
import {
  MANUSCRIPT_REPLACEMENT_MAX_CANDIDATES,
  MANUSCRIPT_REPLACEMENT_MAX_PAGE_SIZE,
  MANUSCRIPT_REPLACEMENT_MAX_SECTIONS,
  manuscriptReplacementApplyResultSchema,
  manuscriptReplacementPageResultSchema,
  manuscriptReplacementPlanResultSchema,
  manuscriptReplacementUndoResultSchema,
  type ManuscriptReplacementApplyInput,
  type ManuscriptReplacementApplyResult,
  type ManuscriptReplacementCandidate,
  type ManuscriptReplacementPageInput,
  type ManuscriptReplacementPageResult,
  type ManuscriptReplacementPlanInput,
  type ManuscriptReplacementPlanResult,
  type ManuscriptReplacementUndoResult
} from '../../shared/contracts/manuscript-replacement'
import {
  ManuscriptDomainError,
  type ManuscriptAssembly,
  type Section
} from '../../shared/contracts/manuscript'
import type { ManuscriptSearchTargetContract } from '../../shared/contracts/manuscript-search'
import {
  enumerateManuscriptSearchSurfaces,
  findProjectionMatchesCooperatively,
  SearchProjectionSliceLimitError,
  targetForSurfaceMatch,
  type ManuscriptSearchSurface,
  type SearchableSection,
  type Utf16Range
} from '../../shared/manuscript-search'
import {
  classifyReplacementTarget,
  ReplacementPreconditionError,
  type ReplacementOperation
} from '../../shared/manuscript-replacement'
import type { EditorPersistenceService } from './editor-persistence-service'
import type { ManuscriptService } from './manuscript-service'

const PLAN_TTL_MS = 15 * 60 * 1_000
const UNDO_TTL_MS = 30 * 60 * 1_000
const PLAN_BUDGET_MS = 500
const PLAN_MAX_BYTES = 32 * 1024 * 1024
const PLAN_SLICE_MS = 12
const RECEIPT_LIMIT = 32

interface InternalCandidate {
  projection: ManuscriptReplacementCandidate
  target: ManuscriptSearchTargetContract
  sourceSliceHash: string
}

interface LivePlan {
  planId: string
  planIdHash: string
  createdAtMs: number
  expiresAtMs: number
  outlineVersion: number
  replacement: string
  candidates: InternalCandidate[]
  baseSections: Map<string, { revisionId: string; contentHash: string }>
}

interface AppliedReceipt {
  planId: string
  selectionFingerprint: string
  commandId: string
  selectedCount: number
  affectedSections: Extract<
    ManuscriptReplacementApplyResult,
    { status: 'applied' }
  >['affectedSections']
  pendingRepairSectionIds: string[]
  checkpointCreated: boolean
}

interface UndoState {
  capability: string
  sectionId: string
  appliedRevisionId: string
  expiresAtMs: number
  status: 'ready' | 'undone' | 'stale'
}

class PlanBudgetExceededError extends Error {}

export class ManuscriptReplacementService {
  readonly #manuscript: ManuscriptService
  readonly #editorPersistence: EditorPersistenceService
  readonly #log: Pick<Logger, 'info' | 'error'>
  readonly #now: () => Date
  readonly #monotonicNow: () => number
  readonly #createId: () => string
  readonly #yieldToMain: () => Promise<void>
  readonly #cursorSecret = randomBytes(32)
  #plan: LivePlan | null = null
  readonly #expiredPlanIds = new Set<string>()
  readonly #receipts = new Map<string, AppliedReceipt>()
  readonly #undo = new Map<string, UndoState>()

  constructor(options: {
    manuscript: ManuscriptService
    editorPersistence: EditorPersistenceService
    log: Pick<Logger, 'info' | 'error'>
    now?: () => Date
    monotonicNow?: () => number
    createId?: () => string
    yieldToMain?: () => Promise<void>
  }) {
    this.#manuscript = options.manuscript
    this.#editorPersistence = options.editorPersistence
    this.#log = options.log
    this.#now = options.now ?? (() => new Date())
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now())
    this.#createId = options.createId ?? randomUUID
    this.#yieldToMain =
      options.yieldToMain ?? (() => new Promise((resolve) => setImmediate(resolve)))
  }

  scopeSectionIds(input: ManuscriptReplacementPlanInput): string[] {
    return selectSections(this.#manuscript.assemble(), input).map((section) => section.sectionId)
  }

  async createPlan(
    input: ManuscriptReplacementPlanInput,
    signal: AbortSignal
  ): Promise<ManuscriptReplacementPlanResult> {
    const startedAt = this.#monotonicNow()
    const planId = this.#createId()
    const planIdHash = sha256(planId)
    this.#expirePlanIfNeeded()
    this.#plan = null
    try {
      const assembly = this.#manuscript.assemble()
      const searchableSections = selectSections(assembly, input)
      const candidates: InternalCandidate[] = []
      let sliceStartedAt = this.#monotonicNow()
      const checkpoint = async (): Promise<void> => {
        if (signal.aborted) throw new Error('Replacement planning was cancelled')
        const now = this.#monotonicNow()
        if (now - startedAt >= PLAN_BUDGET_MS) throw new PlanBudgetExceededError()
        if (now - sliceStartedAt < PLAN_SLICE_MS) return
        await this.#yieldToMain()
        if (signal.aborted) throw new Error('Replacement planning was cancelled')
        sliceStartedAt = this.#monotonicNow()
      }
      for (const searchable of searchableSections) {
        const entry = assembly.sections.find(
          (candidate) => candidate.section.sectionId === searchable.sectionId
        )
        if (entry === undefined) continue
        for (const surface of enumerateManuscriptSearchSurfaces([searchable])) {
          const remaining = MANUSCRIPT_REPLACEMENT_MAX_CANDIDATES + 1 - candidates.length
          const found = await findProjectionMatchesCooperatively(
            surface.text,
            input.query,
            input.caseSensitive,
            { checkpoint, maxMatches: remaining }
          )
          for (const match of found.matches) {
            if (candidates.length >= MANUSCRIPT_REPLACEMENT_MAX_CANDIDATES) {
              return this.#unavailable('result_limit', planIdHash, startedAt)
            }
            const target = targetForSurfaceMatch(surface, match)
            candidates.push(
              createCandidate(
                assembly,
                entry.section,
                entry.revision.content,
                surface,
                target,
                match,
                input
              )
            )
          }
          await checkpoint()
        }
      }

      const baseSections = new Map(
        assembly.sections
          .filter((entry) =>
            candidates.some(
              (candidate) => candidate.projection.sectionId === entry.section.sectionId
            )
          )
          .map((entry) => [
            entry.section.sectionId,
            {
              revisionId: entry.revision.sectionRevisionId,
              contentHash: entry.revision.contentHash
            }
          ])
      )
      const planBytes = Buffer.byteLength(
        JSON.stringify({
          outlineVersion: assembly.outlineVersion,
          replacement: input.replacement,
          candidates,
          baseSections: [...baseSections]
        })
      )
      if (planBytes > PLAN_MAX_BYTES) return this.#unavailable('plan_size', planIdHash, startedAt)
      const createdAtMs = this.#now().getTime()
      this.#plan = {
        planId,
        planIdHash,
        createdAtMs,
        expiresAtMs: createdAtMs + PLAN_TTL_MS,
        outlineVersion: assembly.outlineVersion,
        replacement: input.replacement,
        candidates,
        baseSections
      }
      const result = this.#page(this.#plan, 0, 25)
      this.#log.info(
        {
          event: 'manuscript.replacement_plan.completed',
          planIdHash,
          queryUtf16Length: input.query.length,
          replacementUtf16Length: input.replacement.length,
          candidateCount: candidates.length,
          eligibleCount: candidates.filter((candidate) => candidate.projection.eligible).length,
          sectionCount: baseSections.size,
          planBytes,
          durationMs: this.#monotonicNow() - startedAt
        },
        'Manuscript replacement plan completed'
      )
      return manuscriptReplacementPlanResultSchema.parse(result)
    } catch (err) {
      if (
        err instanceof PlanBudgetExceededError ||
        err instanceof SearchProjectionSliceLimitError
      ) {
        return this.#unavailable('scan_budget', planIdHash, startedAt)
      }
      this.#log.error(
        {
          event: 'manuscript.replacement_plan.failed',
          err,
          planIdHash,
          queryUtf16Length: input.query.length,
          replacementUtf16Length: input.replacement.length,
          durationMs: this.#monotonicNow() - startedAt
        },
        'Manuscript replacement plan failed'
      )
      throw err
    }
  }

  page(input: ManuscriptReplacementPageInput): ManuscriptReplacementPageResult {
    const plan = this.#planFor(input.planId)
    if (plan === 'expired') return { status: 'expired_plan' }
    if (plan === null) return { status: 'invalid_plan' }
    const offset = this.#decodeCursor(input.cursor, plan)
    return manuscriptReplacementPageResultSchema.parse(this.#page(plan, offset, input.limit))
  }

  dismiss(planId: string): void {
    if (this.#plan?.planId === planId) this.#plan = null
  }

  selectedSectionIds(input: ManuscriptReplacementApplyInput): string[] | null {
    const plan = this.#planFor(input.planId)
    if (plan === null || plan === 'expired') return null
    const selected = new Set(input.candidateIds)
    return [
      ...new Set(
        plan.candidates
          .filter((candidate) => selected.has(candidate.projection.candidateId))
          .map((candidate) => candidate.projection.sectionId)
      )
    ]
  }

  async apply(
    input: ManuscriptReplacementApplyInput,
    checkpointCreated: boolean
  ): Promise<ManuscriptReplacementApplyResult> {
    const selectionFingerprint = fingerprintSelection(input.candidateIds)
    const priorReceipt = this.#receipts.get(input.commandId)
    if (priorReceipt !== undefined) {
      if (
        priorReceipt.planId !== input.planId ||
        priorReceipt.selectionFingerprint !== selectionFingerprint
      ) {
        return { status: 'invalid_plan' }
      }
      return manuscriptReplacementApplyResultSchema.parse({
        status: 'already_applied',
        ...receiptProjection(priorReceipt)
      })
    }
    const plan = this.#planFor(input.planId)
    if (plan === 'expired') return { status: 'expired_plan' }
    if (plan === null) return { status: 'invalid_plan' }
    const selectedIds = new Set(input.candidateIds)
    const selected = plan.candidates.filter((candidate) =>
      selectedIds.has(candidate.projection.candidateId)
    )
    if (
      selected.length !== input.candidateIds.length ||
      selected.some((candidate) => !candidate.projection.eligible)
    ) {
      return { status: 'invalid_plan' }
    }
    const sectionIds = [...new Set(selected.map((candidate) => candidate.projection.sectionId))]
    if (sectionIds.length > MANUSCRIPT_REPLACEMENT_MAX_SECTIONS) return { status: 'invalid_plan' }

    const startedAt = this.#monotonicNow()
    try {
      const sections = sectionIds.map((sectionId) => {
        const base = plan.baseSections.get(sectionId)
        if (base === undefined) throw new Error('Replacement plan section is missing')
        return {
          sectionId,
          baseRevisionId: base.revisionId,
          baseContentHash: base.contentHash,
          operations: selected
            .filter((candidate) => candidate.projection.sectionId === sectionId)
            .map(
              (candidate): ReplacementOperation => ({
                target: candidate.target,
                sourceSliceHash: candidate.sourceSliceHash
              })
            )
        }
      })
      const applied = this.#manuscript.applyReplacementBatch({
        outlineVersion: plan.outlineVersion,
        replacement: plan.replacement,
        sections
      })
      const pendingRepairSectionIds: string[] = []
      for (const revision of applied.revisions) {
        try {
          await this.#editorPersistence.materialize(revision)
        } catch (err) {
          pendingRepairSectionIds.push(revision.sectionId)
          this.#log.error(
            {
              event: 'manuscript.replacement.materialization_pending',
              err,
              planIdHash: plan.planIdHash,
              sectionId: revision.sectionId,
              sectionRevisionId: revision.sectionRevisionId
            },
            'Replacement revision committed but materialization is pending repair'
          )
        }
      }
      const undoExpiresAtMs = this.#now().getTime() + UNDO_TTL_MS
      const affectedSections = applied.revisions.map((revision) => {
        this.#invalidateSectionUndo(revision.sectionId)
        const capability = this.#createId()
        this.#undo.set(capability, {
          capability,
          sectionId: revision.sectionId,
          appliedRevisionId: revision.sectionRevisionId,
          expiresAtMs: undoExpiresAtMs,
          status: 'ready'
        })
        return {
          sectionId: revision.sectionId,
          sectionRevisionId: revision.sectionRevisionId,
          undoCapability: capability,
          undoExpiresAt: new Date(undoExpiresAtMs).toISOString()
        }
      })
      const receipt: AppliedReceipt = {
        planId: plan.planId,
        selectionFingerprint,
        commandId: input.commandId,
        selectedCount: selected.length,
        affectedSections,
        pendingRepairSectionIds,
        checkpointCreated
      }
      this.#rememberReceipt(input.commandId, receipt)
      this.#plan = null
      this.#log.info(
        {
          event: 'manuscript.replacement_apply.completed',
          planIdHash: plan.planIdHash,
          selectedCount: selected.length,
          sectionCount: affectedSections.length,
          pendingRepairCount: pendingRepairSectionIds.length,
          checkpointCreated,
          transactionDurationMs: applied.transactionDurationMs,
          durationMs: this.#monotonicNow() - startedAt
        },
        'Manuscript replacement applied'
      )
      return manuscriptReplacementApplyResultSchema.parse({
        status: 'applied',
        ...receiptProjection(receipt)
      })
    } catch (err) {
      if (err instanceof ManuscriptDomainError || err instanceof ReplacementPreconditionError) {
        this.#plan = null
        this.#log.error(
          {
            event: 'manuscript.replacement_apply.conflict',
            err,
            planIdHash: plan.planIdHash,
            selectedCount: selected.length,
            sectionCount: sectionIds.length,
            durationMs: this.#monotonicNow() - startedAt
          },
          'Manuscript replacement conflicted with current authority'
        )
        return { status: 'conflict' }
      }
      this.#log.error(
        {
          event: 'manuscript.replacement_apply.failed',
          err,
          planIdHash: plan.planIdHash,
          selectedCount: selected.length,
          sectionCount: sectionIds.length,
          durationMs: this.#monotonicNow() - startedAt
        },
        'Manuscript replacement failed'
      )
      throw err
    }
  }

  async undo(capability: string): Promise<ManuscriptReplacementUndoResult> {
    const state = this.#undo.get(capability)
    if (state === undefined) return { status: 'invalid_capability' }
    if (state.status === 'undone') return { status: 'already_undone' }
    if (state.status === 'stale') return { status: 'stale' }
    if (this.#now().getTime() >= state.expiresAtMs) {
      this.#undo.delete(capability)
      return { status: 'expired_capability' }
    }
    try {
      const revision = this.#manuscript.undoReplacementRevision({
        sectionId: state.sectionId,
        appliedRevisionId: state.appliedRevisionId
      })
      let materializationPending = false
      try {
        await this.#editorPersistence.materialize(revision)
      } catch (err) {
        materializationPending = true
        this.#log.error(
          {
            event: 'manuscript.replacement_undo.materialization_pending',
            err,
            sectionId: revision.sectionId,
            sectionRevisionId: revision.sectionRevisionId
          },
          'Replacement undo committed but materialization is pending repair'
        )
      }
      state.status = 'undone'
      return manuscriptReplacementUndoResultSchema.parse({
        status: 'undone',
        sectionId: revision.sectionId,
        sectionRevisionId: revision.sectionRevisionId,
        materializationPending
      })
    } catch (err) {
      if (err instanceof ManuscriptDomainError) {
        state.status = 'stale'
        return { status: 'stale' }
      }
      this.#log.error(
        { event: 'manuscript.replacement_undo.failed', err, sectionId: state.sectionId },
        'Replacement undo failed'
      )
      throw err
    }
  }

  undoSectionId(capability: string): string | null {
    const state = this.#undo.get(capability)
    return state?.status === 'ready' ? state.sectionId : null
  }

  revoke(): void {
    this.#plan = null
    this.#expiredPlanIds.clear()
    this.#receipts.clear()
    this.#undo.clear()
  }

  #unavailable(
    reason: 'result_limit' | 'scan_budget' | 'plan_size',
    planIdHash: string,
    startedAt: number
  ): ManuscriptReplacementPlanResult {
    this.#plan = null
    this.#log.info(
      {
        event: 'manuscript.replacement_plan.unavailable',
        planIdHash,
        reason,
        durationMs: this.#monotonicNow() - startedAt
      },
      'Manuscript replacement plan is unavailable within fixed bounds'
    )
    return { status: 'unavailable', reason }
  }

  #planFor(planId: string): LivePlan | null | 'expired' {
    this.#expirePlanIfNeeded()
    if (this.#expiredPlanIds.has(planId)) return 'expired'
    return this.#plan?.planId === planId ? this.#plan : null
  }

  #expirePlanIfNeeded(): void {
    if (this.#plan !== null && this.#now().getTime() >= this.#plan.expiresAtMs) {
      this.#expiredPlanIds.add(this.#plan.planId)
      while (this.#expiredPlanIds.size > RECEIPT_LIMIT) {
        const oldest = this.#expiredPlanIds.values().next().value
        if (oldest !== undefined) this.#expiredPlanIds.delete(oldest)
      }
      this.#plan = null
    }
  }

  #page(plan: LivePlan, offset: number, limit: number): ManuscriptReplacementPageResult {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > plan.candidates.length) {
      return { status: 'invalid_plan' }
    }
    const pageSize = Math.min(limit, MANUSCRIPT_REPLACEMENT_MAX_PAGE_SIZE)
    const candidates = plan.candidates
      .slice(offset, offset + pageSize)
      .map((candidate) => candidate.projection)
    const nextOffset = offset + candidates.length
    return {
      status: 'ready',
      planId: plan.planId,
      expiresAt: new Date(plan.expiresAtMs).toISOString(),
      candidateCount: plan.candidates.length,
      eligibleCount: plan.candidates.filter((candidate) => candidate.projection.eligible).length,
      skippedCount: plan.candidates.filter((candidate) => !candidate.projection.eligible).length,
      sectionCount: new Set(plan.candidates.map((candidate) => candidate.projection.sectionId))
        .size,
      candidates,
      nextCursor: nextOffset < plan.candidates.length ? this.#encodeCursor(plan, nextOffset) : null
    }
  }

  #encodeCursor(plan: LivePlan, offset: number): string {
    const payload = { version: 1, planId: plan.planId, offset }
    const signature = createHmac('sha256', this.#cursorSecret)
      .update(JSON.stringify(payload))
      .digest('hex')
    return Buffer.from(JSON.stringify({ ...payload, signature })).toString('base64url')
  }

  #decodeCursor(cursor: string | undefined, plan: LivePlan): number {
    if (cursor === undefined) return 0
    try {
      const bytes = Buffer.from(cursor, 'base64url')
      if (bytes.toString('base64url') !== cursor) return Number.NaN
      const parsed = JSON.parse(bytes.toString('utf8')) as {
        version?: unknown
        planId?: unknown
        offset?: unknown
        signature?: unknown
      }
      const payload = { version: parsed.version, planId: parsed.planId, offset: parsed.offset }
      const signature = createHmac('sha256', this.#cursorSecret)
        .update(JSON.stringify(payload))
        .digest('hex')
      if (
        parsed.version !== 1 ||
        parsed.planId !== plan.planId ||
        !Number.isSafeInteger(parsed.offset) ||
        typeof parsed.offset !== 'number' ||
        parsed.offset < 0 ||
        parsed.signature !== signature
      ) {
        return Number.NaN
      }
      return parsed.offset
    } catch {
      return Number.NaN
    }
  }

  #rememberReceipt(commandId: string, receipt: AppliedReceipt): void {
    this.#receipts.set(commandId, receipt)
    while (this.#receipts.size > RECEIPT_LIMIT) {
      const oldest = this.#receipts.keys().next().value
      if (oldest !== undefined) this.#receipts.delete(oldest)
    }
  }

  #invalidateSectionUndo(sectionId: string): void {
    for (const state of this.#undo.values()) {
      if (state.sectionId === sectionId && state.status === 'ready') state.status = 'stale'
    }
  }
}

function createCandidate(
  assembly: ManuscriptAssembly,
  section: Section,
  document: ManuscriptAssembly['sections'][number]['revision']['content'],
  surface: ManuscriptSearchSurface,
  target: ManuscriptSearchTargetContract,
  match: Utf16Range,
  input: ManuscriptReplacementPlanInput
): InternalCandidate {
  const sourceText = surface.text.slice(match.from, match.to)
  const classification = classifyReplacementTarget(document, target, input.replacement)
  const replacementSurface =
    classification.skipReason === null
      ? surface.text.slice(0, match.from) + input.replacement + surface.text.slice(match.to)
      : surface.text
  return {
    projection: {
      candidateId: randomUUID(),
      sectionId: section.sectionId,
      sectionTitle: section.title,
      sectionStatus: section.status,
      headingPath: headingPath(assembly, section),
      targetKind: target.kind,
      beforePreview: preview(surface.text, match.from, match.to),
      afterPreview: preview(
        replacementSurface,
        match.from,
        match.from +
          (classification.skipReason === null ? input.replacement.length : sourceText.length)
      ),
      eligible: classification.skipReason === null,
      skipReason: classification.skipReason
    },
    target,
    sourceSliceHash: sha256(sourceText)
  }
}

function preview(value: string, from: number, to: number): string {
  const before = Math.min(240, from)
  const after = Math.min(600, value.length - to)
  return value.slice(from - before, to + after)
}

function selectSections(
  assembly: ManuscriptAssembly,
  input: ManuscriptReplacementPlanInput
): SearchableSection[] {
  return assembly.sections
    .filter(({ section }) => {
      if (input.statuses.length > 0 && !input.statuses.includes(section.status)) return false
      if (input.scope.type === 'manuscript') return true
      if (input.scope.type === 'sections') return input.scope.sectionIds.includes(section.sectionId)
      let current: Section | undefined = section
      while (current !== undefined) {
        if (current.sectionId === input.scope.rootSectionId) return true
        current = assembly.sections.find(
          (entry) => entry.section.sectionId === current?.parentSectionId
        )?.section
      }
      return false
    })
    .map((entry) => ({
      sectionId: entry.section.sectionId,
      revisionId: entry.revision.sectionRevisionId,
      title: entry.section.title,
      objective: entry.section.objective,
      status: entry.section.status,
      content: entry.revision.content
    }))
}

function headingPath(assembly: ManuscriptAssembly, section: Section): string[] {
  const path: string[] = []
  let current: Section | undefined = section
  while (current !== undefined) {
    path.unshift(current.title)
    current = assembly.sections.find(
      (entry) => entry.section.sectionId === current?.parentSectionId
    )?.section
  }
  return path
}

function fingerprintSelection(candidateIds: readonly string[]): string {
  return sha256(JSON.stringify([...candidateIds].sort()))
}

function receiptProjection(
  receipt: AppliedReceipt
): Omit<AppliedReceipt, 'planId' | 'selectionFingerprint'> {
  const { planId: _planId, selectionFingerprint: _selectionFingerprint, ...projection } = receipt
  return projection
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
