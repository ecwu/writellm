import type { BlockNoteDocument } from '../../shared/contracts/manuscript'
import type { BlockMutationOperation, SectionPatch } from '../../shared/contracts/agent-mutations'
import {
  applyBlockMutationOperation,
  MutationSimulationError,
  simulateSectionPatch,
  type SectionPatchSimulation
} from './mutation-simulator'

type Block = BlockNoteDocument[number]

export type SectionProposalRefreshConflictCode =
  | 'target_missing'
  | 'target_changed'
  | 'structure_changed'
  | 'id_collision'
  | 'base_unavailable'
  | 'invalid_result'

export type SectionProposalRefreshAnalysis =
  | { kind: 'refreshable'; mutation: SectionPatch; simulation: SectionPatchSimulation }
  | { kind: 'satisfied' }
  | {
      kind: 'conflict'
      code: SectionProposalRefreshConflictCode
      message: string
    }

interface BlockLocation {
  block: Block
  parentId: string | null
  ancestors: string[]
  index: number
}

class RefreshConflict extends Error {
  constructor(
    readonly code: SectionProposalRefreshConflictCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'RefreshConflict'
  }
}

export function analyzeSectionProposalRefresh(
  base: BlockNoteDocument,
  current: BlockNoteDocument,
  mutation: SectionPatch,
  currentRevisionId: string
): SectionProposalRefreshAnalysis {
  let baseWorking = clone(base)
  let currentWorking = clone(current)

  try {
    indexDocument(baseWorking)
    indexDocument(currentWorking)
    for (const operation of mutation.operations) {
      assertOperationCanReplay(baseWorking, currentWorking, operation)
      baseWorking = applyBlockMutationOperation(baseWorking, operation)
      currentWorking = applyBlockMutationOperation(currentWorking, operation)
      indexDocument(baseWorking)
      indexDocument(currentWorking)
    }
    if (
      equal(currentWorking, current) &&
      mutation.operations.every((operation) => operation.type === 'updateBlock')
    ) {
      return { kind: 'satisfied' }
    }
    const refreshedMutation = { ...mutation, baseRevisionId: currentRevisionId }
    return {
      kind: 'refreshable',
      mutation: refreshedMutation,
      simulation: simulateSectionPatch(current, refreshedMutation)
    }
  } catch (err) {
    if (err instanceof RefreshConflict) {
      return { kind: 'conflict', code: err.code, message: err.message }
    }
    if (err instanceof MutationSimulationError) {
      return {
        kind: 'conflict',
        code: simulationConflictCode(err.code),
        message: safeSimulationMessage(err)
      }
    }
    return {
      kind: 'conflict',
      code: 'invalid_result',
      message: 'The refreshed section proposal would produce an invalid document'
    }
  }
}

function assertOperationCanReplay(
  base: BlockNoteDocument,
  current: BlockNoteDocument,
  operation: BlockMutationOperation
): void {
  switch (operation.type) {
    case 'updateBlock':
      assertUpdateCanReplay(base, current, operation)
      return
    case 'insertBlocks':
      if (operation.anchorBlockId !== null) {
        requireLocation(indexDocument(current), operation.anchorBlockId)
      }
      return
    case 'removeBlocks':
      assertSpanCanReplay(base, current, operation.blockIds, true)
      return
    case 'replaceBlocks':
      assertSpanCanReplay(base, current, operation.blockIds, true)
      return
    case 'moveBlocks':
      assertSpanCanReplay(base, current, operation.blockIds, true)
      assertLocationStructureUnchanged(base, current, operation.anchorBlockId)
  }
}

function assertUpdateCanReplay(
  base: BlockNoteDocument,
  current: BlockNoteDocument,
  operation: Extract<BlockMutationOperation, { type: 'updateBlock' }>
): void {
  const baseBlock = requireLocation(indexDocument(base), operation.blockId).block
  const currentBlock = requireLocation(indexDocument(current), operation.blockId).block
  const update = operation.update
  if (update.type !== undefined) {
    assertWriteCompatible(baseBlock.type, currentBlock.type, update.type, 'type')
  }
  if (update.content !== undefined) {
    assertWriteCompatible(baseBlock.content, currentBlock.content, update.content, 'content')
  }
  if (update.children !== undefined) {
    assertWriteCompatible(baseBlock.children, currentBlock.children, update.children, 'children')
  }
  if (update.props !== undefined) {
    for (const [key, desired] of Object.entries(update.props)) {
      assertWriteCompatible(baseBlock.props[key], currentBlock.props[key], desired, `props.${key}`)
    }
  }
}

function assertWriteCompatible(
  base: unknown,
  current: unknown,
  desired: unknown,
  field: string
): void {
  if (equal(current, base) || equal(current, desired)) return
  throw new RefreshConflict(
    'target_changed',
    `The target block's ${field} field changed after this proposal was created`
  )
}

function assertRemoveCanReplay(
  base: BlockNoteDocument,
  current: BlockNoteDocument,
  blockIds: string[]
): void {
  const baseIndex = indexDocument(base)
  const currentIndex = indexDocument(current)
  for (const blockId of blockIds) {
    const baseLocation = requireLocation(baseIndex, blockId)
    const currentLocation = requireLocation(currentIndex, blockId)
    assertTargetUnchanged(baseLocation, currentLocation)
  }
  assertRelativeOrderUnchanged(baseIndex, currentIndex, blockIds)
}

function assertSpanCanReplay(
  base: BlockNoteDocument,
  current: BlockNoteDocument,
  blockIds: string[],
  requireContiguous: boolean
): void {
  assertRemoveCanReplay(base, current, blockIds)
  if (!requireContiguous) return
  assertContiguous(indexDocument(base), blockIds)
  assertContiguous(indexDocument(current), blockIds)
}

function assertTargetUnchanged(base: BlockLocation, current: BlockLocation): void {
  if (!equal(base.block, current.block)) {
    throw new RefreshConflict(
      'target_changed',
      `The target block changed after this proposal was created`
    )
  }
  if (base.parentId !== current.parentId || !equal(base.ancestors, current.ancestors)) {
    throw new RefreshConflict(
      'structure_changed',
      'The target block moved after this proposal was created'
    )
  }
}

function assertLocationStructureUnchanged(
  base: BlockNoteDocument,
  current: BlockNoteDocument,
  blockId: string
): void {
  const baseLocation = requireLocation(indexDocument(base), blockId)
  const currentLocation = requireLocation(indexDocument(current), blockId)
  if (
    baseLocation.parentId !== currentLocation.parentId ||
    !equal(baseLocation.ancestors, currentLocation.ancestors)
  ) {
    throw new RefreshConflict(
      'structure_changed',
      'The move anchor changed location after this proposal was created'
    )
  }
}

function assertRelativeOrderUnchanged(
  baseIndex: Map<string, BlockLocation>,
  currentIndex: Map<string, BlockLocation>,
  blockIds: string[]
): void {
  const groups = new Map<string | null, string[]>()
  for (const blockId of blockIds) {
    const location = requireLocation(baseIndex, blockId)
    const values = groups.get(location.parentId) ?? []
    values.push(blockId)
    groups.set(location.parentId, values)
  }
  for (const values of groups.values()) {
    const baseOrder = [...values].sort(
      (left, right) =>
        requireLocation(baseIndex, left).index - requireLocation(baseIndex, right).index
    )
    const currentOrder = [...values].sort(
      (left, right) =>
        requireLocation(currentIndex, left).index - requireLocation(currentIndex, right).index
    )
    if (!equal(baseOrder, currentOrder)) {
      throw new RefreshConflict(
        'structure_changed',
        'The target blocks changed relative order after this proposal was created'
      )
    }
  }
}

function assertContiguous(index: Map<string, BlockLocation>, blockIds: string[]): void {
  const locations = blockIds.map((blockId) => requireLocation(index, blockId))
  const parentId = locations[0]?.parentId
  if (
    parentId === undefined ||
    locations.some(
      (location) =>
        location.parentId !== parentId || !equal(location.ancestors, locations[0]?.ancestors)
    )
  ) {
    throw new RefreshConflict(
      'structure_changed',
      'The target blocks are no longer contiguous siblings'
    )
  }
  const positions = locations.map((location) => location.index).sort((left, right) => left - right)
  const start = positions[0] as number
  if (positions.some((position, offset) => position !== start + offset)) {
    throw new RefreshConflict(
      'structure_changed',
      'The target blocks are no longer contiguous siblings'
    )
  }
}

function indexDocument(document: BlockNoteDocument): Map<string, BlockLocation> {
  const result = new Map<string, BlockLocation>()
  const visit = (blocks: BlockNoteDocument, ancestors: string[], parentId: string | null): void => {
    blocks.forEach((block, index) => {
      if (result.has(block.id)) {
        throw new RefreshConflict('invalid_result', 'The section contains duplicate block IDs')
      }
      result.set(block.id, { block, parentId, ancestors, index })
      visit(block.children, [...ancestors, block.id], block.id)
    })
  }
  visit(document, [], null)
  return result
}

function requireLocation(index: Map<string, BlockLocation>, blockId: string): BlockLocation {
  const location = index.get(blockId)
  if (location !== undefined) return location
  throw new RefreshConflict('target_missing', `The target block no longer exists: ${blockId}`)
}

function simulationConflictCode(
  code: MutationSimulationError['code']
): SectionProposalRefreshConflictCode {
  if (code === 'target_missing') return 'target_missing'
  if (code === 'id_collision') return 'id_collision'
  if (code === 'invalid_result') return 'invalid_result'
  return 'structure_changed'
}

function safeSimulationMessage(error: MutationSimulationError): string {
  switch (error.code) {
    case 'target_missing':
      return 'A target block no longer exists'
    case 'id_collision':
      return 'A block ID introduced by this proposal is already in use'
    case 'invalid_result':
      return 'The refreshed section proposal would produce an invalid document'
    default:
      return 'The section structure changed after this proposal was created'
  }
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
