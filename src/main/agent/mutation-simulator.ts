import { blockNoteDocumentSchema, type BlockNoteDocument } from '../../shared/contracts/manuscript'
import {
  sectionPatchSchema,
  type BlockMutationOperation,
  type SectionPatch
} from '../../shared/contracts/agent-mutations'
import { extractSectionAgentText } from '../manuscript/content'

type Block = BlockNoteDocument[number]

interface BlockLocation {
  block: Block
  parent: Block[]
  index: number
  ancestors: string[]
}

export class MutationSimulationError extends Error {
  constructor(
    readonly code:
      | 'target_missing'
      | 'target_ambiguous'
      | 'target_overlap'
      | 'invalid_anchor'
      | 'id_collision'
      | 'invalid_result'
      | 'no_change',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'MutationSimulationError'
  }
}

export interface SectionPatchSimulation {
  readonly document: BlockNoteDocument
  readonly beforeText: string
  readonly afterText: string
  readonly affectedBlockIds: string[]
}

export function applyBlockMutationOperation(
  source: BlockNoteDocument,
  operation: BlockMutationOperation
): BlockNoteDocument {
  const document = cloneDocument(blockNoteDocumentSchema.parse(source))
  const affected = new Set<string>()
  try {
    applyOperation(document, operation, affected)
    return cloneDocument(blockNoteDocumentSchema.parse(document))
  } catch (err) {
    if (err instanceof MutationSimulationError) throw err
    throw new MutationSimulationError('invalid_result', 'Section patch result is invalid', {
      cause: err
    })
  }
}

export function simulateSectionPatch(
  source: BlockNoteDocument,
  rawPatch: SectionPatch
): SectionPatchSimulation {
  const patch = sectionPatchSchema.parse(rawPatch)
  const original = cloneDocument(blockNoteDocumentSchema.parse(source))
  let document = cloneDocument(original)
  const affected = new Set<string>()

  try {
    for (const operation of patch.operations) {
      applyOperation(document, operation, affected)
      document = cloneDocument(blockNoteDocumentSchema.parse(document))
    }
  } catch (err) {
    if (err instanceof MutationSimulationError) throw err
    throw new MutationSimulationError('invalid_result', 'Section patch result is invalid', {
      cause: err
    })
  }

  if (JSON.stringify(document) === JSON.stringify(original)) {
    throw new MutationSimulationError('no_change', 'Section patch does not change the document')
  }

  return {
    document,
    beforeText: extractSectionAgentText(original),
    afterText: extractSectionAgentText(document),
    affectedBlockIds: [...affected]
  }
}

function applyOperation(
  document: BlockNoteDocument,
  operation: BlockMutationOperation,
  affected: Set<string>
): void {
  switch (operation.type) {
    case 'insertBlocks':
      insertBlocks(document, operation, affected)
      return
    case 'updateBlock':
      updateBlock(document, operation, affected)
      return
    case 'removeBlocks':
      removeBlocks(document, operation.blockIds, affected)
      return
    case 'replaceBlocks':
      replaceBlocks(document, operation, affected)
      return
    case 'moveBlocks':
      moveBlocks(document, operation, affected)
  }
}

function insertBlocks(
  document: BlockNoteDocument,
  operation: Extract<BlockMutationOperation, { type: 'insertBlocks' }>,
  affected: Set<string>
): void {
  const incoming = cloneDocument(blockNoteDocumentSchema.parse(operation.blocks))
  assertIncomingIdsAvailable(document, incoming, new Set())
  if (operation.anchorBlockId === null) {
    const index = operation.placement === 'start' ? 0 : document.length
    document.splice(index, 0, ...incoming)
  } else {
    const anchor = requireLocation(indexDocument(document), operation.anchorBlockId)
    const index = anchor.index + (operation.placement === 'after' ? 1 : 0)
    anchor.parent.splice(index, 0, ...incoming)
    affected.add(operation.anchorBlockId)
  }
  for (const id of collectIds(incoming)) affected.add(id)
}

function updateBlock(
  document: BlockNoteDocument,
  operation: Extract<BlockMutationOperation, { type: 'updateBlock' }>,
  affected: Set<string>
): void {
  const location = requireLocation(indexDocument(document), operation.blockId)
  const update = operation.update
  const next = {
    ...location.block,
    ...(update.type === undefined ? {} : { type: update.type }),
    ...(update.props === undefined
      ? {}
      : { props: { ...location.block.props, ...cloneValue(update.props) } }),
    ...(update.content === undefined ? {} : { content: cloneValue(update.content) }),
    ...(update.children === undefined ? {} : { children: cloneValue(update.children) })
  } as Block
  location.parent.splice(location.index, 1, next)
  affected.add(operation.blockId)
}

function removeBlocks(
  document: BlockNoteDocument,
  blockIds: string[],
  affected: Set<string>
): void {
  const index = indexDocument(document)
  const locations = blockIds.map((id) => requireLocation(index, id))
  assertNoAncestorOverlap(locations)
  for (const [parent, entries] of groupByParent(locations)) {
    for (const location of entries.sort((left, right) => right.index - left.index)) {
      parent.splice(location.index, 1)
      affected.add(location.block.id)
    }
  }
}

function replaceBlocks(
  document: BlockNoteDocument,
  operation: Extract<BlockMutationOperation, { type: 'replaceBlocks' }>,
  affected: Set<string>
): void {
  const index = indexDocument(document)
  const locations = operation.blockIds.map((id) => requireLocation(index, id))
  const { parent, start } = requireContiguousSiblings(locations)
  const removedIds = new Set(locations.flatMap((location) => collectIds([location.block])))
  const incoming = cloneDocument(blockNoteDocumentSchema.parse(operation.blocks))
  assertIncomingIdsAvailable(document, incoming, removedIds)
  parent.splice(start, locations.length, ...incoming)
  for (const id of operation.blockIds) affected.add(id)
  for (const id of collectIds(incoming)) affected.add(id)
}

function moveBlocks(
  document: BlockNoteDocument,
  operation: Extract<BlockMutationOperation, { type: 'moveBlocks' }>,
  affected: Set<string>
): void {
  const initialIndex = indexDocument(document)
  const locations = operation.blockIds.map((id) => requireLocation(initialIndex, id))
  const { parent, start } = requireContiguousSiblings(locations)
  const movingIds = new Set(locations.flatMap((location) => collectIds([location.block])))
  if (movingIds.has(operation.anchorBlockId)) {
    throw new MutationSimulationError(
      'invalid_anchor',
      'Move anchor cannot be inside the moved block subtree'
    )
  }
  requireLocation(initialIndex, operation.anchorBlockId)
  const moving = parent.splice(start, locations.length)
  const anchor = requireLocation(indexDocument(document), operation.anchorBlockId)
  const destination = anchor.index + (operation.placement === 'after' ? 1 : 0)
  anchor.parent.splice(destination, 0, ...moving)
  for (const id of operation.blockIds) affected.add(id)
  affected.add(operation.anchorBlockId)
}

function indexDocument(document: BlockNoteDocument): Map<string, BlockLocation> {
  const result = new Map<string, BlockLocation>()
  const visit = (blocks: Block[], ancestors: string[]): void => {
    blocks.forEach((block, index) => {
      if (result.has(block.id)) {
        throw new MutationSimulationError('target_ambiguous', `Duplicate block ID: ${block.id}`)
      }
      result.set(block.id, { block, parent: blocks, index, ancestors })
      visit(block.children, [...ancestors, block.id])
    })
  }
  visit(document, [])
  return result
}

function requireLocation(index: Map<string, BlockLocation>, blockId: string): BlockLocation {
  const location = index.get(blockId)
  if (location === undefined) {
    throw new MutationSimulationError('target_missing', `Block does not exist: ${blockId}`)
  }
  return location
}

function assertNoAncestorOverlap(locations: BlockLocation[]): void {
  const selected = new Set(locations.map((location) => location.block.id))
  if (locations.some((location) => location.ancestors.some((id) => selected.has(id)))) {
    throw new MutationSimulationError(
      'target_overlap',
      'An operation cannot target both a block and its descendant'
    )
  }
}

function requireContiguousSiblings(locations: BlockLocation[]): {
  parent: Block[]
  start: number
} {
  assertNoAncestorOverlap(locations)
  const parent = locations[0]?.parent
  if (parent === undefined || locations.some((location) => location.parent !== parent)) {
    throw new MutationSimulationError(
      'target_overlap',
      'Blocks must be contiguous siblings for this operation'
    )
  }
  const positions = locations.map((location) => location.index).sort((a, b) => a - b)
  const start = positions[0] as number
  if (positions.some((position, offset) => position !== start + offset)) {
    throw new MutationSimulationError(
      'target_overlap',
      'Blocks must be contiguous siblings for this operation'
    )
  }
  return { parent, start }
}

function groupByParent(locations: BlockLocation[]): Map<Block[], BlockLocation[]> {
  const groups = new Map<Block[], BlockLocation[]>()
  for (const location of locations) {
    const entries = groups.get(location.parent) ?? []
    entries.push(location)
    groups.set(location.parent, entries)
  }
  return groups
}

function assertIncomingIdsAvailable(
  document: BlockNoteDocument,
  incoming: BlockNoteDocument,
  ignored: Set<string>
): void {
  const existing = new Set(collectIds(document).filter((id) => !ignored.has(id)))
  const incomingIds = collectIds(incoming)
  if (incomingIds.some((id) => existing.has(id))) {
    throw new MutationSimulationError('id_collision', 'Inserted block ID already exists')
  }
}

function collectIds(blocks: readonly Block[]): string[] {
  const result: string[] = []
  const visit = (items: readonly Block[]): void => {
    for (const block of items) {
      result.push(block.id)
      visit(block.children)
    }
  }
  visit(blocks)
  return result
}

function cloneDocument(document: BlockNoteDocument): BlockNoteDocument {
  return cloneValue(document)
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
