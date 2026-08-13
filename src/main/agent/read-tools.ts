import { createHash, randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import type { AgentEditorContext } from '../../shared/contracts/agent'
import {
  AGENT_TOOL_RESULT_BYTES,
  agentReadToolNameSchema,
  checkDraftArgsSchema,
  getWritingContextArgsSchema,
  readOutlineArgsSchema,
  readOutlineResultSchema,
  readCitationsArgsSchema,
  readCitationsResultSchema,
  readSectionArgsSchema,
  readSectionResultSchema,
  searchKnowledgeArgsSchema,
  searchKnowledgeResultSchema,
  searchManuscriptArgsSchema,
  searchManuscriptResultSchema,
  type AgentReadToolName,
  type CheckDraftResult,
  type ReadCitationsResult,
  type ReadOutlineResult,
  type ReadSectionResult,
  type SearchKnowledgeResult,
  type SearchManuscriptResult,
  type WritingContextResult
} from '../../shared/contracts/agent-tools'
import { extractSectionAgentText } from '../manuscript/content'
import type { ManuscriptService } from '../manuscript/manuscript-service'
import { findProjectionMatches } from '../../shared/manuscript-search'
import type { RetrievalService } from '../search/retrieval-service'
import type { ProjectDatabase } from '../project/project-database'
import { AgentContextBuilder } from './context'
import type { ReviewResourceSnapshot, WritingSnapshot } from './context'
import { runDraftChecks } from './draft-checker'

interface AgentReadToolResultMap {
  get_writing_context: WritingContextResult
  read_outline: ReadOutlineResult
  read_section: ReadSectionResult
  search_manuscript: SearchManuscriptResult
  search_knowledge: SearchKnowledgeResult
  read_citations: ReadCitationsResult
  check_draft: CheckDraftResult
}

export class AgentToolDomainError extends Error {
  constructor(
    readonly code:
      | 'invalid_arguments'
      | 'unauthorized'
      | 'unavailable'
      | 'not_found'
      | 'conflict'
      | 'stale_cursor'
      | 'result_too_large'
      | 'deadline_exceeded'
      | 'aborted'
      | 'internal',
    message: string,
    readonly retryable = false,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'AgentToolDomainError'
  }
}

export interface AgentReadToolExecutor {
  execute<TName extends AgentReadToolName>(input: {
    toolName: TName
    args: unknown
    editorContext: AgentEditorContext
    snapshot?: WritingSnapshot
    signal: AbortSignal
  }): Promise<AgentReadToolResultMap[TName]>
}

export class MainAgentReadTools implements AgentReadToolExecutor {
  readonly #context: AgentContextBuilder

  constructor(
    private readonly options: {
      projectSessionId: string
      manuscript: ManuscriptService
      database?: ProjectDatabase
      retrieval: RetrievalService | null
      isRetrievalAvailable?: () => boolean
      log: Pick<Logger, 'info' | 'warn' | 'error'>
    }
  ) {
    const database = options.database
    this.#context = new AgentContextBuilder(
      options.manuscript,
      database === undefined
        ? undefined
        : (revisionIds) => captureReviewResources(database, revisionIds)
    )
  }

  contextBuilder(): AgentContextBuilder {
    return this.#context
  }

  async execute<TName extends AgentReadToolName>(input: {
    toolName: TName
    args: unknown
    editorContext: AgentEditorContext
    snapshot?: WritingSnapshot
    signal: AbortSignal
  }): Promise<AgentReadToolResultMap[TName]> {
    const toolName = agentReadToolNameSchema.parse(input.toolName)
    const fallbackRevisionId =
      this.options.manuscript.getWorkspace().sections[0]?.section.currentRevisionId
    const snapshot =
      input.snapshot ??
      this.#context.capture(fallbackRevisionId ?? randomUUID(), input.editorContext)
    if (input.signal.aborted) throw abortedError()
    const startedAt = Date.now()
    try {
      const result = await this.#execute(
        toolName,
        input.args,
        input.editorContext,
        snapshot,
        input.signal
      )
      assertResultBound(result)
      this.options.log.info(
        { event: 'agent.tool.completed', toolName, durationMs: Date.now() - startedAt },
        'Agent read tool completed'
      )
      return result as AgentReadToolResultMap[TName]
    } catch (err) {
      this.options.log.error(
        { event: 'agent.tool.failed', err, toolName, durationMs: Date.now() - startedAt },
        'Agent read tool failed'
      )
      if (input.signal.aborted) throw abortedError(err)
      if (err instanceof AgentToolDomainError) throw err
      throw new AgentToolDomainError('internal', 'Agent read tool failed', false, { cause: err })
    }
  }

  async #execute(
    toolName: AgentReadToolName,
    rawArgs: unknown,
    _editorContext: AgentEditorContext,
    snapshot: WritingSnapshot,
    signal: AbortSignal
  ): Promise<AgentReadToolResultMap[AgentReadToolName]> {
    switch (toolName) {
      case 'get_writing_context':
        return this.#context.getWritingContext(getWritingContextArgsSchema.parse(rawArgs), snapshot)
      case 'read_outline':
        return this.#readOutline(readOutlineArgsSchema.parse(rawArgs), snapshot)
      case 'read_section':
        return this.#readSection(readSectionArgsSchema.parse(rawArgs), snapshot)
      case 'search_manuscript':
        return this.#searchManuscript(searchManuscriptArgsSchema.parse(rawArgs), snapshot)
      case 'search_knowledge': {
        const args = searchKnowledgeArgsSchema.parse(rawArgs)
        const retrieval = this.#requireRetrieval()
        const result = await retrieval.search(
          {
            projectSessionId: this.options.projectSessionId,
            query: args.query,
            filters: {
              knowledgeItemIds: args.knowledgeItemIds,
              fileExtensions: args.fileExtensions,
              parseRevisionIds: args.parseRevisionIds,
              ...(args.pageFrom === undefined ? {} : { pageFrom: args.pageFrom }),
              ...(args.pageTo === undefined ? {} : { pageTo: args.pageTo }),
              ...(args.heading === undefined ? {} : { heading: args.heading })
            },
            limits: { fts: 100, vector: 100, fused: 50, results: args.limit },
            rerank: args.rerank
          },
          signal
        )
        return searchKnowledgeResultSchema.parse({
          mode: result.mode,
          rerankStatus: result.rerankStatus,
          hits: result.hits.map((hit) => ({
            citationId: hit.citationId,
            knowledgeItemId: hit.knowledgeItemId,
            parseRevisionId: hit.parseRevisionId,
            chunkId: hit.chunkId,
            title: hit.title,
            snippet: hit.snippet,
            ...(hit.page === undefined ? {} : { page: hit.page }),
            headingPath: hit.headingPath,
            sourceBlockIds: hit.sourceBlockIds
          }))
        })
      }
      case 'read_citations': {
        const args = readCitationsArgsSchema.parse(rawArgs)
        const retrieval = this.#requireRetrieval()
        const requests = [
          ...args.citationIds.map((citationId) => ({ citationId, offset: 0, maxChars: 65_536 })),
          ...args.requests
        ]
        const requestedIds = [...new Set(requests.map((request) => request.citationId))]
        const expanded = await retrieval.expand(requestedIds, signal)
        const found = new Set(expanded.map((citation) => citation.citationId))
        const byId = new Map(expanded.map((citation) => [citation.citationId, citation]))
        let remainingBudget = 131_072
        let truncated = false
        return readCitationsResultSchema.parse({
          citations: requests.flatMap((request) => {
            const citation = byId.get(request.citationId)
            if (citation === undefined || remainingBudget <= 0) {
              if (citation !== undefined) truncated = true
              return []
            }
            const available = Math.min(request.maxChars, remainingBudget)
            const text = citation.text.slice(request.offset, request.offset + available)
            remainingBudget -= text.length
            const nextOffset =
              request.offset + text.length < citation.text.length
                ? request.offset + text.length
                : null
            if (nextOffset !== null) truncated = true
            return [
              {
                citationId: citation.citationId,
                knowledgeItemId: citation.knowledgeItemId,
                parseRevisionId: citation.parseRevisionId,
                chunkId: citation.chunkId,
                title: citation.title,
                text,
                contentHash: createHash('sha256').update(citation.text).digest('hex'),
                offset: request.offset,
                totalChars: citation.text.length,
                nextOffset,
                ...(citation.page === undefined ? {} : { page: citation.page }),
                headingPath: citation.headingPath,
                sourceBlockIds: citation.sourceBlockIds
              }
            ]
          }),
          missingCitationIds: requestedIds.filter((citationId) => !found.has(citationId)),
          truncated
        })
      }
      case 'check_draft':
        return this.#checkDraft(checkDraftArgsSchema.parse(rawArgs), snapshot, signal)
    }
  }

  #readOutline(
    args: ReturnType<typeof readOutlineArgsSchema.parse>,
    snapshot: WritingSnapshot
  ): ReadOutlineResult {
    const entries = snapshot.workspace.sections.filter((entry) => {
      if (args.rootSectionId === undefined) return entry.section.level <= args.maxDepth
      let current = entry.section
      for (;;) {
        if (current.sectionId === args.rootSectionId) {
          const root = snapshot.workspace.sections.find(
            (candidate) => candidate.section.sectionId === args.rootSectionId
          )
          return root !== undefined && entry.section.level - root.section.level < args.maxDepth
        }
        if (current.parentSectionId === null) return false
        const parent = snapshot.workspace.sections.find(
          (candidate) => candidate.section.sectionId === current.parentSectionId
        )
        if (parent === undefined) return false
        current = parent.section
      }
    })
    const offset = args.cursor === undefined ? 0 : decodeCursor(args.cursor, snapshot.snapshotId)
    const page = entries.slice(offset, offset + args.limit)
    return readOutlineResultSchema.parse({
      snapshotId: snapshot.snapshotId,
      outlineVersion: snapshot.workspace.outlineVersion,
      sections: page.map((entry) => ({
        sectionId: entry.section.sectionId,
        parentSectionId: entry.section.parentSectionId,
        position: entry.section.position,
        level: entry.section.level,
        title: entry.section.title,
        objective: entry.section.objective?.slice(0, 8_192) ?? null,
        status: entry.section.status,
        currentRevisionId: entry.section.currentRevisionId,
        wordCount: entry.revision.wordCount,
        characterCount: entry.revision.characterCount
      })),
      nextCursor:
        offset + page.length < entries.length
          ? encodeCursor(snapshot.snapshotId, offset + page.length)
          : null,
      totalSections: entries.length
    })
  }

  #readSection(
    args: ReturnType<typeof readSectionArgsSchema.parse>,
    snapshot: WritingSnapshot
  ): ReadSectionResult {
    const snapshotEntry = snapshot.workspace.sections.find(
      (entry) => entry.section.sectionId === args.sectionId
    )
    if (snapshotEntry === undefined) {
      throw new AgentToolDomainError('not_found', 'Section does not exist in the writing snapshot')
    }
    const section = snapshotEntry.section
    const revision = snapshotEntry.revision
    const content = snapshot.sectionContents.get(revision.sectionRevisionId)
    if (content === undefined)
      throw new AgentToolDomainError('conflict', 'Snapshot content expired')
    const flattened = flattenBlocks(content)
    let blocks = flattened.map(withoutCanonical)
    let missingBlockIds: string[] = []
    let nextCursor: string | null = null
    if (args.blockIds !== undefined) {
      const requested = new Set(args.blockIds)
      blocks = flattened.filter((block) => requested.has(block.blockId)).map(withoutCanonical)
      const found = new Set(blocks.map((block) => block.blockId))
      missingBlockIds = args.blockIds.filter((blockId) => !found.has(blockId))
    } else {
      const offset = args.cursor === undefined ? 0 : decodeCursor(args.cursor, snapshot.snapshotId)
      blocks = flattened.slice(offset, offset + args.limit).map(withoutCanonical)
      if (offset + blocks.length < flattened.length) {
        nextCursor = encodeCursor(snapshot.snapshotId, offset + blocks.length)
      }
    }
    const entry = snapshotEntry
    const selected =
      args.blockId === undefined
        ? undefined
        : flattened.find((block) => block.blockId === args.blockId)
    if (args.blockId !== undefined && selected === undefined) missingBlockIds.push(args.blockId)
    const canonicalJson = selected === undefined ? undefined : JSON.stringify(selected.canonical)
    return readSectionResultSchema.parse({
      section: {
        sectionId: section.sectionId,
        parentSectionId: section.parentSectionId,
        position: section.position,
        level: section.level,
        title: section.title,
        objective: section.objective?.slice(0, 8_192) ?? null,
        status: section.status,
        currentRevisionId: section.currentRevisionId,
        wordCount: entry.revision.wordCount,
        characterCount: entry.revision.characterCount
      },
      revisionId: revision.sectionRevisionId,
      blocks: args.view === 'summary' ? blocks : [],
      canonicalBlock: args.view === 'canonical' ? (selected?.canonical ?? null) : null,
      canonicalFragment:
        args.view === 'fragment' && canonicalJson !== undefined
          ? canonicalJson.slice(args.offset, args.offset + args.maxChars)
          : null,
      fragmentOffset: args.view === 'fragment' ? args.offset : null,
      nextFragmentOffset:
        args.view === 'fragment' &&
        canonicalJson !== undefined &&
        args.offset + args.maxChars < canonicalJson.length
          ? args.offset + args.maxChars
          : null,
      missingBlockIds,
      nextCursor,
      totalBlocks: flattened.length
    })
  }

  #searchManuscript(
    args: ReturnType<typeof searchManuscriptArgsSchema.parse>,
    snapshot: WritingSnapshot
  ): SearchManuscriptResult {
    const allowed = new Set(args.sectionIds)
    const allHits: SearchManuscriptResult['hits'] = []
    for (const entry of snapshot.workspace.sections) {
      if (allowed.size > 0 && !allowed.has(entry.section.sectionId)) continue
      const revision = entry.revision
      const content = snapshot.sectionContents.get(revision.sectionRevisionId)
      if (content === undefined) continue
      for (const block of flattenBlocks(content)) {
        const matchRanges = findProjectionMatches(block.text, args.query, false)
          .matches.slice(0, 100)
          .map(({ from, to }): [number, number] => [from, to])
        if (matchRanges.length === 0) continue
        const firstStart = matchRanges[0][0]
        allHits.push({
          sectionId: entry.section.sectionId,
          revisionId: revision.sectionRevisionId,
          blockId: block.blockId,
          excerpt: block.text.slice(Math.max(0, firstStart - 200), matchRanges[0][1] + 600),
          matchRanges,
          headingPath: headingPath(snapshot, entry.section.sectionId)
        })
      }
    }
    const offset = args.cursor === undefined ? 0 : decodeCursor(args.cursor, snapshot.snapshotId)
    const hits = allHits.slice(offset, offset + args.limit)
    return searchManuscriptResultSchema.parse({
      snapshotId: snapshot.snapshotId,
      hits,
      nextCursor:
        offset + hits.length < allHits.length
          ? encodeCursor(snapshot.snapshotId, offset + hits.length)
          : null
    })
  }

  #checkDraft(
    args: ReturnType<typeof checkDraftArgsSchema.parse>,
    snapshot: WritingSnapshot,
    signal: AbortSignal
  ): CheckDraftResult {
    return runDraftChecks(args, snapshot, signal)
  }

  #requireRetrieval(): RetrievalService {
    if (
      this.options.retrieval === null ||
      (this.options.isRetrievalAvailable !== undefined && !this.options.isRetrievalAvailable())
    ) {
      throw new AgentToolDomainError('unavailable', 'Knowledge retrieval is unavailable', true)
    }
    return this.options.retrieval
  }
}

function captureReviewResources(
  projectDatabase: ProjectDatabase,
  revisionIds: readonly string[]
): ReviewResourceSnapshot {
  return projectDatabase.immediate((database) => {
    const knowledgeItems = database
      .prepare(
        `SELECT knowledge_item_id AS knowledgeItemId, display_name AS displayName, state
           FROM knowledge_items ORDER BY knowledge_item_id`
      )
      .all() as ReviewResourceSnapshot['knowledgeItems']
    const assetRows = database
      .prepare(
        `SELECT asset.asset_id AS assetId,
                EXISTS (
                  SELECT 1 FROM section_revision_assets reference
                   WHERE reference.asset_id = asset.asset_id
                     AND reference.section_revision_id IN (${revisionIds.map(() => '?').join(', ') || 'NULL'})
                ) AS referencedByCurrentRevision
           FROM manuscript_assets asset ORDER BY asset.asset_id`
      )
      .all(...revisionIds) as Array<{ assetId: string; referencedByCurrentRevision: number }>
    return {
      knowledgeItems,
      manuscriptAssets: assetRows.map((row) => ({
        assetId: row.assetId,
        referencedByCurrentRevision: row.referencedByCurrentRevision === 1
      }))
    }
  })
}

type FlattenedBlock = ReadSectionResult['blocks'][number] & { canonical: unknown }

function flattenBlocks(content: readonly unknown[]): FlattenedBlock[] {
  const result: FlattenedBlock[] = []
  const visit = (blocks: readonly unknown[], parentBlockId: string | null, depth: number): void => {
    for (const value of blocks) {
      if (value === null || typeof value !== 'object') continue
      const block = value as { id?: unknown; type?: unknown; children?: unknown }
      if (typeof block.id !== 'string' || typeof block.type !== 'string') continue
      const fullText = extractSectionAgentText([{ ...block, children: [] }])
      result.push({
        blockId: block.id,
        blockType: block.type,
        parentBlockId,
        depth,
        ordinal: result.length,
        text: fullText.slice(0, 8_192),
        textTruncated: fullText.length > 8_192,
        blockHash: createHash('sha256').update(JSON.stringify(value)).digest('hex'),
        childBlockIds: Array.isArray(block.children)
          ? block.children.flatMap((child) =>
              child !== null &&
              typeof child === 'object' &&
              'id' in child &&
              typeof child.id === 'string'
                ? [child.id]
                : []
            )
          : [],
        hasRichContent: hasRichContent(value),
        canonical: value
      })
      if (Array.isArray(block.children)) visit(block.children, block.id, depth + 1)
    }
  }
  visit(content, null, 0)
  return result
}

function withoutCanonical({ canonical: _canonical, ...block }: FlattenedBlock) {
  return block
}

function hasRichContent(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  const block = value as { type?: unknown; content?: unknown }
  if (block.type === 'table' || !Array.isArray(block.content)) return true
  return block.content.some(
    (item) =>
      item === null ||
      typeof item !== 'object' ||
      !('type' in item) ||
      item.type !== 'text' ||
      ('styles' in item &&
        item.styles !== null &&
        typeof item.styles === 'object' &&
        Object.keys(item.styles).length > 0)
  )
}

const cursorSchema = {
  parse(raw: string): { revisionId: string; offset: number } {
    try {
      const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown
      if (
        decoded === null ||
        typeof decoded !== 'object' ||
        !('revisionId' in decoded) ||
        typeof decoded.revisionId !== 'string' ||
        !('offset' in decoded) ||
        typeof decoded.offset !== 'number' ||
        !Number.isInteger(decoded.offset) ||
        decoded.offset < 0
      ) {
        throw new Error('Invalid cursor')
      }
      return { revisionId: decoded.revisionId, offset: decoded.offset }
    } catch (err) {
      throw new AgentToolDomainError('invalid_arguments', 'Section cursor is invalid', false, {
        cause: err
      })
    }
  }
}

function encodeCursor(revisionId: string, offset: number): string {
  return Buffer.from(JSON.stringify({ revisionId, offset }), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string, currentRevisionId: string): number {
  const decoded = cursorSchema.parse(cursor)
  if (decoded.revisionId !== currentRevisionId) {
    throw new AgentToolDomainError('stale_cursor', 'Section changed during pagination')
  }
  return decoded.offset
}

function assertResultBound(result: unknown): void {
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > AGENT_TOOL_RESULT_BYTES) {
    throw new AgentToolDomainError('result_too_large', 'Agent tool result exceeds its bound')
  }
}

function abortedError(cause?: unknown): AgentToolDomainError {
  return new AgentToolDomainError('aborted', 'Agent tool request was aborted', true, { cause })
}

function headingPath(snapshot: WritingSnapshot, sectionId: string): string[] {
  const path: string[] = []
  let current = snapshot.workspace.sections.find((entry) => entry.section.sectionId === sectionId)
  while (current !== undefined) {
    path.unshift(current.section.title)
    current =
      current.section.parentSectionId === null
        ? undefined
        : snapshot.workspace.sections.find(
            (entry) => entry.section.sectionId === current?.section.parentSectionId
          )
  }
  return path
}
