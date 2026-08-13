import type { Logger } from 'pino'
import type { AgentEditorContext } from '../../shared/contracts/agent'
import { agentQuickActionSelectedTextSchema } from '../../shared/contracts/agent-quick-actions'
import type { BlockNoteDocument } from '../../shared/contracts/manuscript'
import type { ManuscriptService } from '../manuscript/manuscript-service'
import { extractSectionText } from '../manuscript/content'

export class AgentQuickActionSelectionError extends Error {
  readonly code = 'quick_action_selection_stale'

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AgentQuickActionSelectionError'
  }
}

export function validateQuickActionSelection(
  manuscript: ManuscriptService,
  editorContext: AgentEditorContext,
  log?: Pick<Logger, 'info' | 'warn' | 'error'>
): { selectedText: string; revisionId: string } {
  try {
    return validateSelection(manuscript, editorContext)
  } catch (err) {
    const context = {
      sectionId: editorContext.activeSectionId,
      capturedRevisionId: editorContext.capturedRevisionId ?? null,
      selectedBlockCount: editorContext.selectedBlockIds.length,
      selectedTextLength:
        typeof editorContext.selectedText === 'string' ? editorContext.selectedText.length : 0
    }
    if (err instanceof AgentQuickActionSelectionError) {
      log?.warn(
        { event: 'agent.quick_action.selection_rejected', err, ...context },
        'Agent quick action selection is stale'
      )
    } else {
      log?.error(
        { event: 'agent.quick_action.validation_failed', err, ...context },
        'Agent quick action selection validation failed'
      )
    }
    throw err
  }
}

function validateSelection(
  manuscript: ManuscriptService,
  editorContext: AgentEditorContext
): { selectedText: string; revisionId: string } {
  const sectionId = editorContext.activeSectionId
  const revisionId = editorContext.capturedRevisionId
  const selectedText = agentQuickActionSelectedTextSchema.safeParse(editorContext.selectedText)
  if (
    sectionId === null ||
    revisionId === undefined ||
    revisionId === null ||
    !selectedText.success ||
    editorContext.activeBlockId === null ||
    editorContext.selectedBlockIds.length === 0
  ) {
    throw staleSelection('The exact text selection is unavailable. Select the text again.')
  }
  if (new Set(editorContext.selectedBlockIds).size !== editorContext.selectedBlockIds.length) {
    throw staleSelection('The text selection is invalid. Select the text again.')
  }
  if (!editorContext.selectedBlockIds.includes(editorContext.activeBlockId)) {
    throw staleSelection('The active selection block changed. Select the text again.')
  }

  let section: ReturnType<ManuscriptService['getSection']>
  let revision: ReturnType<ManuscriptService['getRevision']>
  try {
    section = manuscript.getSection(sectionId)
    revision = manuscript.getRevision(revisionId)
  } catch (error) {
    throw staleSelection('The selected section changed. Select the text again.', error)
  }
  if (section.currentRevisionId !== revisionId || revision.sectionId !== sectionId) {
    throw staleSelection('The selected text changed after capture. Select it again.')
  }

  const orderedBlocks = flattenBlocks(revision.content)
  const positionById = new Map(orderedBlocks.map((block, index) => [block.id, index] as const))
  const positions = editorContext.selectedBlockIds.map((blockId) => positionById.get(blockId))
  if (positions.some((position) => position === undefined)) {
    throw staleSelection('A selected block changed after capture. Select the text again.')
  }
  for (let index = 1; index < positions.length; index += 1) {
    if ((positions[index - 1] ?? -1) >= (positions[index] ?? -1)) {
      throw staleSelection('The selected block order changed. Select the text again.')
    }
  }
  const selectedIds = new Set(editorContext.selectedBlockIds)
  const visibleSurface = orderedBlocks
    .filter((block) => selectedIds.has(block.id))
    .map((block) => extractSectionText([{ ...block.value, children: [] }]))
    .join('\n')
  if (!visibleSurface.includes(selectedText.data)) {
    throw staleSelection('The selected text changed after capture. Select it again.')
  }
  return { selectedText: selectedText.data, revisionId }
}

function flattenBlocks(document: BlockNoteDocument): Array<{
  id: string
  value: Record<string, unknown>
}> {
  const blocks: Array<{ id: string; value: Record<string, unknown> }> = []
  const visit = (values: readonly unknown[]): void => {
    for (const value of values) {
      if (value === null || typeof value !== 'object') continue
      const block = value as Record<string, unknown>
      if (typeof block.id === 'string') blocks.push({ id: block.id, value: block })
      if (Array.isArray(block.children)) visit(block.children)
    }
  }
  visit(document)
  return blocks
}

function staleSelection(message: string, cause?: unknown): AgentQuickActionSelectionError {
  return cause === undefined
    ? new AgentQuickActionSelectionError(message)
    : new AgentQuickActionSelectionError(message, { cause })
}
