import type { Logger } from 'pino'
import type { AgentEditorContext } from '../../shared/contracts/agent'
import {
  AGENT_TOOL_RESULT_BYTES,
  agentReadToolNameSchema,
  getWritingContextArgsSchema,
  readCitationsArgsSchema,
  readCitationsResultSchema,
  readSectionArgsSchema,
  readSectionResultSchema,
  searchKnowledgeArgsSchema,
  searchKnowledgeResultSchema,
  type AgentReadToolName,
  type ReadCitationsResult,
  type ReadSectionResult,
  type SearchKnowledgeResult,
  type WritingContextResult
} from '../../shared/contracts/agent-tools'
import { extractSectionText } from '../manuscript/content'
import type { ManuscriptService } from '../manuscript/manuscript-service'
import type { RetrievalService } from '../search/retrieval-service'
import { AgentContextBuilder } from './context'

interface AgentReadToolResultMap {
  get_writing_context: WritingContextResult
  read_section: ReadSectionResult
  search_knowledge: SearchKnowledgeResult
  read_citations: ReadCitationsResult
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
    signal: AbortSignal
  }): Promise<AgentReadToolResultMap[TName]>
}

export class MainAgentReadTools implements AgentReadToolExecutor {
  readonly #context: AgentContextBuilder

  constructor(
    private readonly options: {
      projectSessionId: string
      manuscript: ManuscriptService
      retrieval: RetrievalService | null
      log: Pick<Logger, 'info' | 'warn' | 'error'>
    }
  ) {
    this.#context = new AgentContextBuilder(options.manuscript)
  }

  contextBuilder(): AgentContextBuilder {
    return this.#context
  }

  async execute<TName extends AgentReadToolName>(input: {
    toolName: TName
    args: unknown
    editorContext: AgentEditorContext
    signal: AbortSignal
  }): Promise<AgentReadToolResultMap[TName]> {
    const toolName = agentReadToolNameSchema.parse(input.toolName)
    if (input.signal.aborted) throw abortedError()
    const startedAt = Date.now()
    try {
      const result = await this.#execute(toolName, input.args, input.editorContext, input.signal)
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
    editorContext: AgentEditorContext,
    signal: AbortSignal
  ): Promise<AgentReadToolResultMap[AgentReadToolName]> {
    switch (toolName) {
      case 'get_writing_context':
        return this.#context.getWritingContext(
          getWritingContextArgsSchema.parse(rawArgs),
          editorContext
        )
      case 'read_section':
        return this.#readSection(readSectionArgsSchema.parse(rawArgs))
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
        const expanded = await retrieval.expand(args.citationIds, signal)
        const found = new Set(expanded.map((citation) => citation.citationId))
        return readCitationsResultSchema.parse({
          citations: expanded.map((citation) => ({
            citationId: citation.citationId,
            knowledgeItemId: citation.knowledgeItemId,
            parseRevisionId: citation.parseRevisionId,
            chunkId: citation.chunkId,
            title: citation.title,
            text: citation.text.slice(0, 65_536),
            ...(citation.page === undefined ? {} : { page: citation.page }),
            headingPath: citation.headingPath,
            sourceBlockIds: citation.sourceBlockIds
          })),
          missingCitationIds: args.citationIds.filter((citationId) => !found.has(citationId))
        })
      }
    }
  }

  #readSection(args: ReturnType<typeof readSectionArgsSchema.parse>): ReadSectionResult {
    let section: ReturnType<ManuscriptService['getSection']>
    try {
      section = this.options.manuscript.getSection(args.sectionId)
    } catch (err) {
      throw new AgentToolDomainError('not_found', 'Section does not exist', false, { cause: err })
    }
    const revision = this.options.manuscript.getRevision(section.currentRevisionId)
    const flattened = flattenBlocks(revision.content)
    let blocks = flattened
    let missingBlockIds: string[] = []
    let nextCursor: string | null = null
    if (args.blockIds !== undefined) {
      const requested = new Set(args.blockIds)
      blocks = flattened.filter((block) => requested.has(block.blockId))
      const found = new Set(blocks.map((block) => block.blockId))
      missingBlockIds = args.blockIds.filter((blockId) => !found.has(blockId))
    } else {
      const offset =
        args.cursor === undefined ? 0 : decodeCursor(args.cursor, revision.sectionRevisionId)
      blocks = flattened.slice(offset, offset + args.limit)
      if (offset + blocks.length < flattened.length) {
        nextCursor = encodeCursor(revision.sectionRevisionId, offset + blocks.length)
      }
    }
    const entry = this.options.manuscript
      .getWorkspace()
      .sections.find((candidate) => candidate.section.sectionId === section.sectionId)
    if (entry === undefined) throw new AgentToolDomainError('not_found', 'Section does not exist')
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
      blocks,
      missingBlockIds,
      nextCursor,
      totalBlocks: flattened.length
    })
  }

  #requireRetrieval(): RetrievalService {
    if (this.options.retrieval === null) {
      throw new AgentToolDomainError('unavailable', 'Knowledge retrieval is unavailable', true)
    }
    return this.options.retrieval
  }
}

function flattenBlocks(content: readonly unknown[]): ReadSectionResult['blocks'] {
  const result: ReadSectionResult['blocks'] = []
  const visit = (blocks: readonly unknown[]): void => {
    for (const value of blocks) {
      if (value === null || typeof value !== 'object') continue
      const block = value as { id?: unknown; type?: unknown; children?: unknown }
      if (typeof block.id !== 'string' || typeof block.type !== 'string') continue
      const fullText = extractSectionText([{ ...block, children: [] }])
      result.push({
        blockId: block.id,
        blockType: block.type,
        ordinal: result.length,
        text: fullText.slice(0, 8_192),
        textTruncated: fullText.length > 8_192
      })
      if (Array.isArray(block.children)) visit(block.children)
    }
  }
  visit(content)
  return result
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
