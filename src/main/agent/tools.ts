import { createHash, randomUUID } from 'node:crypto'
import type { AgentApprovalMode, AgentEditorContext } from '../../shared/contracts/agent'
import {
  agentProposalToolNameSchema,
  generateImageArgsSchema,
  normalizedGenerateImageArgsSchema,
  modelSubmitBriefChangeArgsSchema,
  modelSubmitOutlineChangeArgsSchema,
  modelSubmitSectionChangeArgsSchema,
  modelSubmitWritingRulesChangeWithReviewArgsSchema,
  type MutationProposalToolResult,
  type MutationProposalOutcome,
  type MutationProposalRecord
} from '../../shared/contracts/agent-mutations'
import {
  agentReadToolNameSchema,
  checkDraftResultSchema,
  type AgentToolName,
  type CheckDraftResult,
  inspectChangeArgsSchema,
  inspectChangeResultSchema,
  type InspectChangeResult,
  type ReadCitationsResult,
  type ReadOutlineResult,
  type ReadSectionResult,
  type ReadWritingSkillResult,
  type SearchManuscriptResult,
  type SearchKnowledgeResult,
  type WritingContextResult
} from '../../shared/contracts/agent-tools'
import type {
  ListReviewIssuesResult,
  RecordReviewIssuesResult,
  UpdateReviewIssuesResult
} from '../../shared/contracts/review'
import type {
  createWritingTaskResultSchema,
  getWritingTaskResultSchema,
  updateWritingTaskResultSchema
} from '../../shared/contracts/writing-task'
import {
  applyWritingRuleOperations,
  readWritingRules,
  writeWritingRules,
  type WritingRuleOperation
} from '../../shared/contracts/writing-rules'
import type { AgentContextBuilder, WritingSnapshot } from './context'
import type { MutationProposalService } from './mutation-service'
import type { AgentReadToolExecutor } from './read-tools'
import { AgentToolDomainError } from './read-tools'
import { extractSectionAgentText } from '../manuscript/content'
import { findOpaqueCitationMarker, usesReadableSourceFallback } from './prompts/agent-policy'
import type { ReviewIssueService } from './review-issue-service'
import type { WritingTaskService } from './writing-task-service'

interface AgentToolResultMap {
  get_writing_context: WritingContextResult
  read_outline: ReadOutlineResult
  read_section: ReadSectionResult
  search_manuscript: SearchManuscriptResult
  search_knowledge: SearchKnowledgeResult
  read_citations: ReadCitationsResult
  read_writing_skill: ReadWritingSkillResult
  inspect_change: InspectChangeResult
  check_draft: CheckDraftResult
  list_review_issues: ListReviewIssuesResult
  record_review_issues: RecordReviewIssuesResult
  update_review_issues: UpdateReviewIssuesResult
  get_writing_task: ReturnType<typeof getWritingTaskResultSchema.parse>
  create_writing_task: ReturnType<typeof createWritingTaskResultSchema.parse>
  update_writing_task: ReturnType<typeof updateWritingTaskResultSchema.parse>
  submit_brief_change: MutationProposalToolResult
  submit_writing_rules_change: MutationProposalToolResult
  submit_outline_change: MutationProposalToolResult
  submit_section_change: MutationProposalToolResult
  generate_image: MutationProposalToolResult
}

export interface AgentToolExecutionInput<TName extends AgentToolName = AgentToolName> {
  toolName: TName
  args: unknown
  editorContext: AgentEditorContext
  agentSessionId: string
  agentRunId: string
  toolCallId: string
  toolCallEventId: string
  modelRequestId: string
  snapshot?: WritingSnapshot
  signal: AbortSignal
}

export interface AgentToolExecutor {
  execute<TName extends AgentToolName>(
    input: AgentToolExecutionInput<TName>
  ): Promise<AgentToolResultMap[TName]>
  approveProposalAutomatically?(
    agentSessionId: string,
    proposalId: string,
    refreshOnce: boolean
  ): Promise<MutationProposalOutcome>
  shouldAutoApprove?(agentSessionId: string, proposalId: string, mode: AgentApprovalMode): boolean
  getProposal?(agentSessionId: string, proposalId: string): MutationProposalRecord | undefined
}

export class MainAgentTools implements AgentToolExecutor {
  constructor(
    private readonly readTools: AgentReadToolExecutor & { contextBuilder(): AgentContextBuilder },
    readonly mutations: MutationProposalService,
    private readonly reviewIssues?: ReviewIssueService,
    private readonly writingTasks?: WritingTaskService
  ) {}

  contextBuilder(): AgentContextBuilder {
    return this.readTools.contextBuilder()
  }

  approveProposalAutomatically(
    agentSessionId: string,
    proposalId: string,
    refreshOnce: boolean
  ): Promise<MutationProposalOutcome> {
    return this.mutations.approveAutomatically(agentSessionId, proposalId, refreshOnce)
  }

  shouldAutoApprove(agentSessionId: string, proposalId: string, mode: AgentApprovalMode): boolean {
    const proposal = this.mutations
      .list(agentSessionId)
      .find((candidate) => candidate.proposalId === proposalId)
    if (proposal === undefined || mode === 'manual' || proposal.payload.kind === 'brief_update') {
      return false
    }
    if (proposal.payload.kind === 'outline_patch') {
      return (
        mode === 'yolo' &&
        proposal.payload.mutation.operations.length <= 10 &&
        proposal.payload.mutation.operations.every(
          (operation) => operation.type === 'createSection' || operation.type === 'updateSection'
        )
      )
    }
    if (proposal.payload.kind === 'generated_image_insert') return true
    return sectionPolicyAllows(proposal.payload.mutation.operations, proposal.payload.preview, mode)
  }

  getProposal(agentSessionId: string, proposalId: string): MutationProposalRecord | undefined {
    return this.mutations
      .list(agentSessionId)
      .find((candidate) => candidate.proposalId === proposalId)
  }

  async execute<TName extends AgentToolName>(
    input: AgentToolExecutionInput<TName>
  ): Promise<AgentToolResultMap[TName]> {
    if (input.toolName === 'list_review_issues') {
      return this.#requireReviewIssues().list(input.args) as AgentToolResultMap[TName]
    }
    if (input.toolName === 'record_review_issues') {
      if (input.snapshot === undefined) {
        throw new AgentToolDomainError('conflict', 'Review issue source snapshot expired')
      }
      return this.#requireReviewIssues().record(
        input.args,
        { agentSessionId: input.agentSessionId, agentRunId: input.agentRunId },
        input.snapshot
      ) as AgentToolResultMap[TName]
    }
    if (input.toolName === 'update_review_issues') {
      return this.#requireReviewIssues().update(input.args, {
        agentSessionId: input.agentSessionId,
        agentRunId: input.agentRunId
      }) as AgentToolResultMap[TName]
    }
    if (input.toolName === 'get_writing_task') {
      return this.#requireWritingTasks().get(input.agentSessionId) as AgentToolResultMap[TName]
    }
    if (input.toolName === 'create_writing_task') {
      return this.#requireWritingTasks().create(input.args, {
        agentSessionId: input.agentSessionId,
        agentRunId: input.agentRunId
      }) as AgentToolResultMap[TName]
    }
    if (input.toolName === 'update_writing_task') {
      return this.#requireWritingTasks().update(input.args, {
        agentSessionId: input.agentSessionId,
        agentRunId: input.agentRunId
      }) as AgentToolResultMap[TName]
    }
    if (input.toolName === 'inspect_change') {
      const args = inspectChangeArgsSchema.parse(input.args)
      const proposal = this.mutations
        .list(input.agentSessionId)
        .find((candidate) => candidate.proposalId === args.proposalId)
      if (proposal === undefined) {
        throw new AgentToolDomainError(
          'not_found',
          'Mutation proposal does not exist in this Agent session'
        )
      }
      const payload = proposal.payload
      return inspectChangeResultSchema.parse({
        proposal,
        applicationStatus:
          proposal.status === 'applied' || proposal.status === 'undone'
            ? 'applied'
            : proposal.status === 'satisfied'
              ? 'no_change'
              : proposal.status === 'conflicted' || proposal.status === 'failed'
                ? 'conflict'
                : 'not_applied',
        base: {
          briefVersion: payload.kind === 'brief_update' ? payload.mutation.baseBriefVersion : null,
          outlineVersion:
            payload.kind === 'outline_patch' ? payload.mutation.baseOutlineVersion : null,
          revisionId:
            payload.kind === 'section_patch' || payload.kind === 'generated_image_insert'
              ? payload.mutation.baseRevisionId
              : null
        },
        result: {
          briefVersion: proposal.appliedBriefVersion,
          outlineVersion: proposal.appliedOutlineVersion,
          revisionId: proposal.appliedRevisionId,
          undoRevisionId: proposal.undoRevisionId
        },
        idMapping: {
          createdSectionRefs: payload.provenance.createdSectionRefs ?? {},
          createdBlockRefs: payload.provenance.createdBlockRefs ?? {}
        },
        compactDiff: {
          summary: payload.preview.summary,
          beforeText: payload.preview.beforeText,
          afterText: payload.preview.afterText
        },
        warnings:
          payload.preview.beforeTextTruncated || payload.preview.afterTextTruncated
            ? ['The persisted preview is truncated.']
            : [],
        conflict: proposal.status === 'conflicted' ? proposal.rejectedReason : null
      }) as AgentToolResultMap[TName]
    }
    const readName = agentReadToolNameSchema.safeParse(input.toolName)
    if (readName.success) {
      const result = await this.readTools.execute({
        toolName: readName.data,
        args: input.args,
        editorContext: input.editorContext,
        snapshot: input.snapshot,
        signal: input.signal
      })
      if (readName.data === 'check_draft') {
        return this.#withCitationProvenance(
          result as CheckDraftResult,
          input.agentSessionId
        ) as AgentToolResultMap[TName]
      }
      return result as AgentToolResultMap[TName]
    }
    const proposalName = agentProposalToolNameSchema.parse(input.toolName)
    if (input.snapshot === undefined) {
      throw new AgentToolDomainError('conflict', 'Mutation source snapshot expired')
    }
    if (proposalName === 'generate_image') {
      const requested = generateImageArgsSchema.parse(input.args)
      const common = {
        sectionId: requested.sectionId,
        prompt: requested.prompt,
        altText: requested.altText,
        caption: requested.caption,
        aspectRatio: requested.aspectRatio,
        imageSize: requested.imageSize,
        resolvesReviewIssues: requested.resolvesReviewIssues
      }
      const args = normalizedGenerateImageArgsSchema.parse(
        requested.mode === 'insert'
          ? {
              ...common,
              anchor: requested.anchor,
              placement: requested.placement
            }
          : {
              ...common,
              anchor: null,
              placement: 'end',
              iteration: requested.iteration
            }
      )
      const reviewResolutions = args.resolvesReviewIssues ?? []
      this.#validateReviewResolutions(reviewResolutions, input.agentSessionId)
      const result = this.mutations.proposeGeneratedImage(args, input.snapshot, {
        agentSessionId: input.agentSessionId,
        agentRunId: input.agentRunId,
        toolCallId: input.toolCallId,
        toolCallEventId: input.toolCallEventId,
        modelRequestId: input.modelRequestId,
        resolvesReviewIssues: reviewResolutions,
        signal: input.signal
      })
      this.#linkReviewIssues(result.proposalId, reviewResolutions, input)
      return result as AgentToolResultMap[TName]
    }
    if (proposalName === 'submit_section_change') {
      const args = modelSubmitSectionChangeArgsSchema.parse(input.args)
      for (const operation of args.operations) {
        if (operation.type === 'replaceCanonicalBlock') {
          this.mutations.assertCanonicalBlockRead(
            input.agentSessionId,
            input.agentRunId,
            operation.target.blockId,
            operation.target.expectedBlockHash
          )
        }
      }
    }
    const normalized = normalizeProposalArguments(proposalName, input.args, input.snapshot)
    this.#validateReviewResolutions(normalized.resolvesReviewIssues, input.agentSessionId)
    const result = this.mutations.propose(proposalName, normalized.args, {
      agentSessionId: input.agentSessionId,
      agentRunId: input.agentRunId,
      toolCallId: input.toolCallId,
      toolCallEventId: input.toolCallEventId,
      modelRequestId: input.modelRequestId,
      resolvesReviewIssues: normalized.resolvesReviewIssues,
      ...normalized.idMapping,
      signal: input.signal
    })
    this.#linkReviewIssues(result.proposalId, normalized.resolvesReviewIssues, input)
    return result as AgentToolResultMap[TName]
  }

  #requireReviewIssues(): ReviewIssueService {
    if (this.reviewIssues === undefined) {
      throw new AgentToolDomainError('unavailable', 'Review issues are unavailable')
    }
    return this.reviewIssues
  }

  #requireWritingTasks(): WritingTaskService {
    if (this.writingTasks === undefined) {
      throw new AgentToolDomainError('unavailable', 'Writing task service is unavailable')
    }
    return this.writingTasks
  }

  #validateReviewResolutions(
    targets: readonly { issueId: string; expectedVersion: number; resolutionSummary: string }[],
    agentSessionId: string
  ): void {
    if (targets.length === 0) return
    this.#requireReviewIssues().validateResolutionTargets(targets, agentSessionId)
  }

  #linkReviewIssues(
    proposalId: string,
    targets: readonly { issueId: string; expectedVersion: number; resolutionSummary: string }[],
    input: AgentToolExecutionInput
  ): void {
    if (targets.length === 0) return
    this.#requireReviewIssues().linkProposal(proposalId, targets, {
      agentSessionId: input.agentSessionId,
      agentRunId: input.agentRunId
    })
  }

  #withCitationProvenance(result: CheckDraftResult, agentSessionId: string): CheckDraftResult {
    if (!result.summary.unavailableChecks.includes('citation_provenance')) return result
    const findings = [...result.findings]
    let citationFailed = false
    let citationFindingTruncated = false
    for (const proposal of this.mutations.list(agentSessionId)) {
      const citationIds =
        proposal.payload.kind === 'generated_image_insert'
          ? []
          : proposal.payload.mutation.citationIds
      const sources = new Map(
        proposal.payload.provenance.citedSources.map((source) => [source.citationId, source])
      )
      for (const citationId of citationIds) {
        const source = sources.get(citationId)
        const complete =
          source?.evidenceSchemaVersion === 2 &&
          typeof source.excerpt === 'string' &&
          source.excerpt.length > 0 &&
          typeof source.contentHash === 'string' &&
          typeof source.retrievedAt === 'string'
        if (complete) continue
        citationFailed = true
        if (findings.length >= 200) {
          citationFindingTruncated = true
          continue
        }
        const evidence = `${proposal.proposalId}:${citationId}`
        findings.push({
          findingId: createHash('sha256')
            .update(
              `${result.snapshotId}:citation_provenance:proposal:${proposal.proposalId}:${evidence}`
            )
            .digest('hex'),
          priority: 'P1',
          category: 'citation',
          check: 'citation_provenance',
          title: 'Proposal citation provenance is incomplete',
          description: 'A proposal citation is missing its bounded expanded-evidence snapshot.',
          evidence
        })
      }
    }
    const citationOutcome = {
      check: 'citation_provenance' as const,
      status: citationFailed ? ('failed' as const) : ('passed' as const),
      reason: null
    }
    return checkDraftResultSchema.parse({
      ...result,
      findings,
      summary: {
        priorities: {
          P0: findings.filter((finding) => finding.priority === 'P0').length,
          P1: findings.filter((finding) => finding.priority === 'P1').length,
          P2: findings.filter((finding) => finding.priority === 'P2').length,
          P3: findings.filter((finding) => finding.priority === 'P3').length
        },
        passedChecks: citationFailed
          ? result.summary.passedChecks
          : [...result.summary.passedChecks, 'citation_provenance'],
        skippedChecks: result.summary.skippedChecks,
        unavailableChecks: result.summary.unavailableChecks.filter(
          (check) => check !== 'citation_provenance'
        ),
        checkOutcomes: result.summary.checkOutcomes.map((outcome) =>
          outcome.check === 'citation_provenance' ? citationOutcome : outcome
        ),
        truncated: result.summary.truncated || citationFindingTruncated
      }
    })
  }
}

function normalizeProposalArguments(
  toolName:
    | 'submit_brief_change'
    | 'submit_writing_rules_change'
    | 'submit_outline_change'
    | 'submit_section_change',
  rawArgs: unknown,
  snapshot: WritingSnapshot
): {
  args: unknown
  idMapping: {
    createdSectionRefs?: Record<string, string>
    createdBlockRefs?: Record<string, string>
  }
  resolvesReviewIssues: Array<{
    issueId: string
    expectedVersion: number
    resolutionSummary: string
  }>
} {
  if (toolName === 'submit_brief_change') {
    const args = modelSubmitBriefChangeArgsSchema.parse(rawArgs)
    return {
      args: {
        schemaVersion: 1,
        manuscriptId: snapshot.workspace.manuscriptId,
        baseBriefVersion: snapshot.workspace.brief.version,
        ...args
      },
      idMapping: {},
      resolvesReviewIssues: args.resolvesReviewIssues ?? []
    }
  }
  if (toolName === 'submit_writing_rules_change') {
    const args = modelSubmitWritingRulesChangeWithReviewArgsSchema.parse(rawArgs)
    const operations: WritingRuleOperation[] = args.operations.map((operation) =>
      operation.type === 'add'
        ? { type: 'add', rule: { ruleId: randomUUID(), ...operation.rule } }
        : operation
    )
    const current = readWritingRules(snapshot.workspace.brief.extensible)
    const next = applyWritingRuleOperations(current, operations)
    return {
      args: {
        schemaVersion: 1,
        manuscriptId: snapshot.workspace.manuscriptId,
        baseBriefVersion: snapshot.workspace.brief.version,
        changes: {
          extensible: writeWritingRules(snapshot.workspace.brief.extensible, next)
        },
        citationIds: args.citationIds
      },
      idMapping: {},
      resolvesReviewIssues: args.resolvesReviewIssues ?? []
    }
  }
  if (toolName === 'submit_outline_change') return normalizeOutlineArguments(rawArgs, snapshot)
  return normalizeSectionArguments(rawArgs, snapshot)
}

function normalizeOutlineArguments(
  rawArgs: unknown,
  snapshot: WritingSnapshot
): ReturnType<typeof normalizeProposalArguments> {
  const args = modelSubmitOutlineChangeArgsSchema.parse(rawArgs)
  const createdIds = new Map<string, string>()
  for (const operation of args.operations) {
    if (operation.type !== 'createSection') continue
    if (createdIds.has(operation.clientRef)) {
      throw new AgentToolDomainError('invalid_arguments', 'Outline clientRef values must be unique')
    }
    createdIds.set(operation.clientRef, randomUUID())
  }
  const nodes = new Map(
    snapshot.workspace.sections.map((entry) => [
      entry.section.sectionId,
      { parentId: entry.section.parentSectionId, position: entry.section.position }
    ])
  )
  type SectionRef = { kind: 'existing'; sectionId: string } | { kind: 'created'; clientRef: string }
  const resolveRef = (reference: SectionRef): string => {
    const sectionId =
      reference.kind === 'existing' ? reference.sectionId : createdIds.get(reference.clientRef)
    if (sectionId === undefined || !nodes.has(sectionId)) {
      throw new AgentToolDomainError(
        'invalid_arguments',
        'Outline operation contains an unknown SectionRef'
      )
    }
    return sectionId
  }
  const positionFor = (
    parentId: string | null,
    placement:
      | { kind: 'first' }
      | { kind: 'last' }
      | { kind: 'before' | 'after'; anchor: SectionRef }
  ): number => {
    const siblings = [...nodes.entries()]
      .filter(([, node]) => node.parentId === parentId)
      .sort((left, right) => left[1].position - right[1].position)
    if (placement.kind === 'first') return 0
    if (placement.kind === 'last') return siblings.length
    const anchorId = resolveRef(placement.anchor)
    const anchorIndex = siblings.findIndex(([sectionId]) => sectionId === anchorId)
    if (anchorIndex < 0) {
      throw new AgentToolDomainError(
        'invalid_arguments',
        'Outline placement anchor is not a sibling'
      )
    }
    return anchorIndex + (placement.kind === 'after' ? 1 : 0)
  }
  const compact = (parentId: string | null): void => {
    const siblings = [...nodes.entries()]
      .filter(([, node]) => node.parentId === parentId)
      .sort((left, right) => left[1].position - right[1].position)
    siblings.forEach(([, node], position) => {
      node.position = position
    })
  }
  const openSlot = (parentId: string | null, position: number): void => {
    for (const node of nodes.values()) {
      if (node.parentId === parentId && node.position >= position) node.position += 1
    }
  }
  const removeProvisionalNode = (sectionId: string): void => {
    const current = nodes.get(sectionId)
    if (current === undefined) {
      throw new AgentToolDomainError(
        'invalid_arguments',
        'Outline section is absent from provisional state'
      )
    }
    nodes.delete(sectionId)
    compact(current.parentId)
  }
  const operations = args.operations.map((operation) => {
    if (operation.type === 'createSection') {
      const sectionId = createdIds.get(operation.clientRef)
      if (sectionId === undefined)
        throw new AgentToolDomainError('internal', 'Created section ID is missing')
      const parentSectionId = operation.parent === null ? null : resolveRef(operation.parent)
      const position = positionFor(parentSectionId, operation.placement)
      openSlot(parentSectionId, position)
      nodes.set(sectionId, { parentId: parentSectionId, position })
      return {
        type: 'createSection',
        sectionId,
        parentSectionId,
        position,
        title: operation.title,
        objective: operation.objective,
        status: operation.status
      }
    }
    if (operation.type === 'updateSection') {
      return stripUndefined({
        type: 'updateSection',
        sectionId: resolveRef(operation.section),
        title: operation.title,
        objective: operation.objective,
        status: operation.status
      })
    }
    if (operation.type === 'deleteSection') {
      const sectionId = resolveRef(operation.section)
      removeProvisionalNode(sectionId)
      return { type: 'deleteSection', sectionId }
    }
    const sectionId = resolveRef(operation.section)
    removeProvisionalNode(sectionId)
    const parentSectionId = operation.parent === null ? null : resolveRef(operation.parent)
    const position = positionFor(parentSectionId, operation.placement)
    openSlot(parentSectionId, position)
    nodes.set(sectionId, { parentId: parentSectionId, position })
    return { type: 'moveSection', sectionId, parentSectionId, position }
  })
  return {
    args: {
      schemaVersion: 1,
      manuscriptId: snapshot.workspace.manuscriptId,
      baseOutlineVersion: snapshot.workspace.outlineVersion,
      operations,
      citationIds: args.citationIds
    },
    idMapping: { createdSectionRefs: Object.fromEntries(createdIds) },
    resolvesReviewIssues: args.resolvesReviewIssues ?? []
  }
}

function normalizeSectionArguments(
  rawArgs: unknown,
  snapshot: WritingSnapshot
): ReturnType<typeof normalizeProposalArguments> {
  const args = modelSubmitSectionChangeArgsSchema.parse(rawArgs)
  const entry = snapshot.workspace.sections.find(
    (candidate) => candidate.section.sectionId === args.sectionId
  )
  if (entry === undefined)
    throw new AgentToolDomainError('not_found', 'Section is absent from snapshot')
  const content = snapshot.sectionContents.get(entry.section.currentRevisionId)
  if (content === undefined) throw new AgentToolDomainError('conflict', 'Section snapshot expired')
  const blocks = indexCanonicalBlocks(content)
  const createdBlockRefs = new Map<string, string>()
  const assertCitationText = (text: string): void => {
    const opaqueMarker = findOpaqueCitationMarker(text)
    if (opaqueMarker !== null) {
      throw new AgentToolDomainError(
        'invalid_arguments',
        `Section change contains an opaque citation marker (${opaqueMarker}); use a verified bibliography mapping or a readable source label`
      )
    }
    if (usesReadableSourceFallback(text) && args.citationIds.length === 0) {
      throw new AgentToolDomainError(
        'invalid_arguments',
        'Readable source labels require corresponding expanded citationIds'
      )
    }
  }
  const verify = (target: { blockId: string; expectedBlockHash: string }): unknown => {
    const block = blocks.get(target.blockId)
    if (block === undefined)
      throw new AgentToolDomainError('conflict', 'Target block no longer exists')
    const actual = createHash('sha256').update(JSON.stringify(block)).digest('hex')
    if (actual !== target.expectedBlockHash) {
      throw new AgentToolDomainError(
        'conflict',
        'Target block hash does not match the source snapshot'
      )
    }
    return block
  }
  const operations = args.operations.map((operation) => {
    if (operation.type === 'replaceBlockText') {
      assertCitationText(operation.text)
      const block = verify(operation.target) as { type?: unknown; content?: unknown }
      if (block.type === 'table' || !isPlainInlineContent(block.content)) {
        throw new AgentToolDomainError(
          'invalid_arguments',
          'replaceBlockText requires a plain-text inline block; use canonical replacement instead'
        )
      }
      return {
        type: 'updateBlock',
        blockId: operation.target.blockId,
        update: { content: [{ type: 'text', text: operation.text, styles: {} }] }
      }
    }
    if (operation.type === 'insertTextBlocks') {
      if (operation.anchor !== null) verify(operation.anchor)
      return {
        type: 'insertBlocks',
        anchorBlockId: operation.anchor?.blockId ?? null,
        placement: operation.placement,
        blocks: operation.blocks.map((block) => {
          assertCitationText(block.text)
          const created = createTextBlock(block.blockType, block.text)
          if (block.clientRef !== undefined) {
            if (createdBlockRefs.has(block.clientRef)) {
              throw new AgentToolDomainError(
                'invalid_arguments',
                'Section block clientRef values must be unique'
              )
            }
            createdBlockRefs.set(block.clientRef, created.id)
          }
          return created
        })
      }
    }
    if (operation.type === 'insertRichBlock') {
      if (operation.anchor !== null) verify(operation.anchor)
      const created = createRichBlock(operation.block)
      if (operation.block.clientRef !== undefined) {
        if (createdBlockRefs.has(operation.block.clientRef)) {
          throw new AgentToolDomainError(
            'invalid_arguments',
            'Section block clientRef values must be unique'
          )
        }
        createdBlockRefs.set(operation.block.clientRef, created.id)
      }
      return {
        type: 'insertBlocks',
        anchorBlockId: operation.anchor?.blockId ?? null,
        placement: operation.placement,
        blocks: [created]
      }
    }
    if (operation.type === 'removeBlocks') {
      for (const target of operation.targets) verify(target)
      return {
        type: 'removeBlocks',
        blockIds: operation.targets.map((target) => target.blockId)
      }
    }
    if (operation.type === 'moveBlocks') {
      for (const target of operation.targets) verify(target)
      verify(operation.anchor)
      return {
        type: 'moveBlocks',
        blockIds: operation.targets.map((target) => target.blockId),
        anchorBlockId: operation.anchor.blockId,
        placement: operation.placement
      }
    }
    verify(operation.target)
    assertCitationText(extractSectionAgentText([operation.block]))
    if (operation.block.id !== operation.target.blockId) {
      throw new AgentToolDomainError(
        'invalid_arguments',
        'Canonical replacement must preserve block ID'
      )
    }
    return {
      type: 'replaceBlocks',
      blockIds: [operation.target.blockId],
      blocks: [operation.block]
    }
  })
  return {
    args: {
      schemaVersion: 1,
      sectionId: args.sectionId,
      baseRevisionId: entry.section.currentRevisionId,
      operations,
      citationIds: args.citationIds
    },
    idMapping: { createdBlockRefs: Object.fromEntries(createdBlockRefs) },
    resolvesReviewIssues: args.resolvesReviewIssues ?? []
  }
}

function indexCanonicalBlocks(content: readonly unknown[]): Map<string, unknown> {
  const result = new Map<string, unknown>()
  const visit = (values: readonly unknown[]): void => {
    for (const value of values) {
      if (value === null || typeof value !== 'object' || !('id' in value)) continue
      if (typeof value.id === 'string') result.set(value.id, value)
      if ('children' in value && Array.isArray(value.children)) visit(value.children)
    }
  }
  visit(content)
  return result
}

function createTextBlock(type: string, text: string) {
  const common = { backgroundColor: 'default', textColor: 'default' }
  const props =
    type === 'heading'
      ? { ...common, textAlignment: 'left', level: 2 }
      : type === 'checkListItem'
        ? { ...common, textAlignment: 'left', checked: false }
        : type === 'quote'
          ? common
          : type === 'codeBlock'
            ? { language: '' }
            : { ...common, textAlignment: 'left' }
  return {
    id: randomUUID(),
    type,
    props,
    content: [{ type: 'text', text, styles: {} }],
    children: []
  }
}

function createRichBlock(input: {
  blockType: 'mermaid' | 'math'
  source: string
  caption: string
  textAlignment: 'left' | 'center' | 'right' | 'justify'
  previewWidth: number
}) {
  return {
    id: randomUUID(),
    type: input.blockType,
    props: {
      source: input.source,
      caption: input.caption,
      textAlignment: input.textAlignment,
      previewWidth: input.previewWidth
    },
    children: []
  }
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
}

function sectionPolicyAllows(
  operations: Extract<
    ReturnType<MutationProposalService['list']>[number]['payload'],
    { kind: 'section_patch' }
  >['mutation']['operations'],
  preview: ReturnType<MutationProposalService['list']>[number]['payload']['preview'],
  mode: AgentApprovalMode
): boolean {
  const touched = new Set<string>()
  let insertedCharacters = 0
  let deletedCharacters = Math.max(0, preview.beforeText.length - preview.afterText.length)
  let requiresYolo = false
  for (const operation of operations) {
    if (operation.type === 'updateBlock') {
      touched.add(operation.blockId)
      if (
        operation.update.type !== undefined ||
        operation.update.props !== undefined ||
        operation.update.children !== undefined ||
        !isPlainInlineContent(operation.update.content)
      ) {
        return false
      }
      insertedCharacters += inlineTextLength(operation.update.content)
    } else if (operation.type === 'insertBlocks') {
      if (!operation.blocks.every(isPlainTextBlock)) return false
      insertedCharacters += operation.blocks.reduce(
        (total, block) => total + inlineTextLength(block.content),
        0
      )
    } else if (operation.type === 'removeBlocks') {
      requiresYolo = true
      for (const blockId of operation.blockIds) touched.add(blockId)
    } else if (operation.type === 'moveBlocks') {
      requiresYolo = true
      touched.add(operation.anchorBlockId)
      for (const blockId of operation.blockIds) touched.add(blockId)
    } else {
      return false
    }
  }
  deletedCharacters = Math.max(deletedCharacters, 0)
  if (mode === 'section_auto') {
    return (
      !requiresYolo &&
      touched.size <= 5 &&
      insertedCharacters <= 4_000 &&
      deletedCharacters <= 1_000
    )
  }
  return touched.size <= 20 && insertedCharacters <= 16_000 && deletedCharacters <= 8_000
}

function isPlainTextBlock(block: {
  type: string
  props?: unknown
  content?: unknown
  children?: unknown[]
}): boolean {
  return (
    block.type !== 'table' &&
    (block.children?.length ?? 0) === 0 &&
    isPlainInlineContent(block.content)
  )
}

function isPlainInlineContent(content: unknown): boolean {
  return (
    typeof content === 'string' ||
    (Array.isArray(content) &&
      content.every(
        (item) =>
          item !== null &&
          typeof item === 'object' &&
          'type' in item &&
          item.type === 'text' &&
          'text' in item &&
          typeof item.text === 'string' &&
          (!('styles' in item) ||
            (typeof item.styles === 'object' &&
              item.styles !== null &&
              Object.keys(item.styles).length === 0))
      ))
  )
}

function inlineTextLength(content: unknown): number {
  if (typeof content === 'string') return content.length
  if (!Array.isArray(content)) return 0
  return content.reduce(
    (total, item) =>
      total +
      (item !== null && typeof item === 'object' && 'text' in item && typeof item.text === 'string'
        ? item.text.length
        : 0),
    0
  )
}
