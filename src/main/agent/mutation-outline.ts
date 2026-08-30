import type {
  OutlineMutationOperation,
  OutlinePatch,
  ProposalPresentation
} from '../../shared/contracts/agent-mutations'
import {
  MAX_MANUSCRIPT_OUTLINE_DEPTH,
  MAX_MANUSCRIPT_SECTIONS
} from '../../shared/contracts/manuscript'
import type { SectionTable } from '../project/database-types'
import { MutationSimulationError } from './mutation-simulator'
import { presentationText } from './mutation-presentation'

export interface OutlineNode {
  sectionId: string
  parentSectionId: string | null
  position: number
  level: number
  title: string
  objective: string | null
  status: 'planned' | 'drafting' | 'completed'
}

export interface OutlineSimulation {
  nodes: OutlineNode[]
  affectedSectionIds: string[]
  beforeText: string
  afterText: string
  presentation: ProposalPresentation
}

export type OutlinePresentationOperation = Extract<
  ProposalPresentation,
  { kind: 'outline_operations' }
>['operations'][number]

export function outlineLocation(node: OutlineNode, nodes: OutlineNode[]) {
  return {
    parentSectionId: node.parentSectionId,
    parentTitle:
      node.parentSectionId === null
        ? null
        : (nodes.find((candidate) => candidate.sectionId === node.parentSectionId)?.title ?? null),
    position: node.position
  }
}

export function outlinePresentationSection(node: OutlineNode, nodes: OutlineNode[]) {
  return {
    sectionId: node.sectionId,
    title: node.title,
    location: outlineLocation(node, nodes),
    objective: presentationText(node.objective),
    status: node.status
  }
}

export function createOutlineOperationPresentation(
  operation: OutlineMutationOperation,
  before: OutlineNode[],
  after: OutlineNode[]
): OutlinePresentationOperation {
  if (operation.type === 'createSection') {
    const created = requireOutlineNode(after, operation.sectionId)
    return { type: 'create', section: outlinePresentationSection(created, after) }
  }
  const previous = requireOutlineNode(before, operation.sectionId)
  if (operation.type === 'deleteSection') {
    return { type: 'delete', section: outlinePresentationSection(previous, before) }
  }
  const next = requireOutlineNode(after, operation.sectionId)
  if (operation.type === 'moveSection') {
    return {
      type: 'move',
      sectionId: next.sectionId,
      title: next.title,
      before: outlineLocation(previous, before),
      after: outlineLocation(next, after)
    }
  }
  const changes: Extract<OutlinePresentationOperation, { type: 'update' }>['changes'] = []
  if (operation.title !== undefined) {
    changes.push({
      field: 'title',
      before: presentationText(previous.title),
      after: presentationText(next.title)
    })
  }
  if (operation.objective !== undefined) {
    changes.push({
      field: 'objective',
      before: presentationText(previous.objective),
      after: presentationText(next.objective)
    })
  }
  if (operation.status !== undefined) {
    changes.push({
      field: 'status',
      before: presentationText(previous.status),
      after: presentationText(next.status)
    })
  }
  return { type: 'update', sectionId: next.sectionId, title: next.title, changes }
}

export function simulateOutline(rows: SectionTable[], patch: OutlinePatch): OutlineSimulation {
  const before = rows.map(outlineNodeFromRow)
  let nodes = before.map((node) => ({ ...node }))
  const affected = new Set<string>()
  const operations: OutlinePresentationOperation[] = []
  for (const operation of patch.operations) {
    const operationBefore = nodes.map((node) => ({ ...node }))
    nodes = applyOutlineOperation(nodes, operation, affected)
    normalizeOutline(nodes)
    operations.push(createOutlineOperationPresentation(operation, operationBefore, nodes))
  }
  if (nodes.length > MAX_MANUSCRIPT_SECTIONS) {
    throw new MutationSimulationError('invalid_result', 'Outline contains too many sections')
  }
  if (JSON.stringify(nodes) === JSON.stringify(before)) {
    throw new MutationSimulationError('no_change', 'Outline patch does not change the outline')
  }
  return {
    nodes,
    affectedSectionIds: [...affected],
    beforeText: renderOutline(before),
    afterText: renderOutline(nodes),
    presentation: { schemaVersion: 1, kind: 'outline_operations', operations }
  }
}

export function applyOutlineOperation(
  source: OutlineNode[],
  operation: OutlineMutationOperation,
  affected: Set<string>
): OutlineNode[] {
  const nodes = source.map((node) => ({ ...node }))
  switch (operation.type) {
    case 'createSection': {
      if (nodes.some((node) => node.sectionId === operation.sectionId)) {
        throw new MutationSimulationError('id_collision', 'Section ID already exists')
      }
      requireOutlineParent(nodes, operation.parentSectionId)
      const siblings = outlineSiblings(nodes, operation.parentSectionId)
      if (operation.position > siblings.length) {
        throw new MutationSimulationError('invalid_result', 'Section position is invalid')
      }
      shiftSiblingPositions(nodes, operation.parentSectionId, operation.position, 1)
      nodes.push({
        sectionId: operation.sectionId,
        parentSectionId: operation.parentSectionId,
        position: operation.position,
        level: 1,
        title: operation.title,
        objective: operation.objective,
        status: operation.status
      })
      affected.add(operation.sectionId)
      break
    }
    case 'updateSection': {
      const target = requireOutlineNode(nodes, operation.sectionId)
      target.title = operation.title ?? target.title
      target.objective = operation.objective === undefined ? target.objective : operation.objective
      target.status = operation.status ?? target.status
      affected.add(target.sectionId)
      break
    }
    case 'moveSection': {
      const target = requireOutlineNode(nodes, operation.sectionId)
      requireOutlineParent(nodes, operation.parentSectionId)
      if (
        operation.parentSectionId === target.sectionId ||
        descendants(nodes, target.sectionId).has(operation.parentSectionId ?? '')
      ) {
        throw new MutationSimulationError('invalid_result', 'Section move creates a cycle')
      }
      const destination = outlineSiblings(nodes, operation.parentSectionId).filter(
        (node) => node.sectionId !== target.sectionId
      )
      if (operation.position > destination.length) {
        throw new MutationSimulationError('invalid_result', 'Section position is invalid')
      }
      const oldParent = target.parentSectionId
      nodes.splice(nodes.indexOf(target), 1)
      renumberSiblings(nodes, oldParent)
      target.parentSectionId = operation.parentSectionId
      target.position = operation.position
      shiftSiblingPositions(nodes, operation.parentSectionId, operation.position, 1)
      nodes.push(target)
      affected.add(target.sectionId)
      break
    }
    case 'deleteSection': {
      const target = requireOutlineNode(nodes, operation.sectionId)
      if (nodes.length === 1) {
        throw new MutationSimulationError('invalid_result', 'The last section cannot be deleted')
      }
      if (nodes.some((node) => node.parentSectionId === target.sectionId)) {
        throw new MutationSimulationError(
          'invalid_result',
          'A section with children cannot be deleted'
        )
      }
      nodes.splice(nodes.indexOf(target), 1)
      renumberSiblings(nodes, target.parentSectionId)
      affected.add(target.sectionId)
      break
    }
  }
  return nodes
}

export function normalizeOutline(nodes: OutlineNode[]): void {
  const ids = new Set(nodes.map((node) => node.sectionId))
  if (ids.size !== nodes.length) {
    throw new MutationSimulationError('id_collision', 'Outline contains duplicate section IDs')
  }
  for (const node of nodes) {
    if (node.parentSectionId !== null && !ids.has(node.parentSectionId)) {
      throw new MutationSimulationError('target_missing', 'Outline parent does not exist')
    }
  }
  const roots = outlineSiblings(nodes, null)
  const visited = new Set<string>()
  const visit = (node: OutlineNode, level: number): void => {
    if (visited.has(node.sectionId)) {
      throw new MutationSimulationError('invalid_result', 'Outline contains a cycle')
    }
    if (level > MAX_MANUSCRIPT_OUTLINE_DEPTH) {
      throw new MutationSimulationError('invalid_result', 'Outline nesting is too deep')
    }
    visited.add(node.sectionId)
    node.level = level
    outlineSiblings(nodes, node.sectionId).forEach((child, position) => {
      child.position = position
      visit(child, level + 1)
    })
  }
  roots.forEach((root, position) => {
    root.position = position
    visit(root, 1)
  })
  if (visited.size !== nodes.length) {
    throw new MutationSimulationError('invalid_result', 'Outline contains unreachable sections')
  }
  nodes.sort((left, right) =>
    left.level === right.level
      ? (left.parentSectionId ?? '').localeCompare(right.parentSectionId ?? '') ||
        left.position - right.position
      : left.level - right.level
  )
}

export function outlineNodeFromRow(row: SectionTable): OutlineNode {
  return {
    sectionId: row.section_id,
    parentSectionId: row.parent_section_id,
    position: row.position,
    level: row.level,
    title: row.title,
    objective: row.objective,
    status: row.status
  }
}

export function outlineSiblings(
  nodes: OutlineNode[],
  parentSectionId: string | null
): OutlineNode[] {
  return nodes
    .filter((node) => node.parentSectionId === parentSectionId)
    .sort((left, right) => left.position - right.position)
}

export function requireOutlineNode(nodes: OutlineNode[], sectionId: string): OutlineNode {
  const node = nodes.find((candidate) => candidate.sectionId === sectionId)
  if (node === undefined) {
    throw new MutationSimulationError('target_missing', 'Outline section does not exist')
  }
  return node
}

export function requireOutlineParent(nodes: OutlineNode[], parentSectionId: string | null): void {
  if (parentSectionId !== null) requireOutlineNode(nodes, parentSectionId)
}

export function descendants(nodes: OutlineNode[], sectionId: string): Set<string> {
  const result = new Set<string>()
  const visit = (parentId: string): void => {
    for (const child of nodes.filter((node) => node.parentSectionId === parentId)) {
      result.add(child.sectionId)
      visit(child.sectionId)
    }
  }
  visit(sectionId)
  return result
}

export function shiftSiblingPositions(
  nodes: OutlineNode[],
  parentSectionId: string | null,
  from: number,
  delta: number
): void {
  for (const node of nodes) {
    if (node.parentSectionId === parentSectionId && node.position >= from) node.position += delta
  }
}

export function renumberSiblings(nodes: OutlineNode[], parentSectionId: string | null): void {
  outlineSiblings(nodes, parentSectionId).forEach((node, position) => {
    node.position = position
  })
}

export function renderOutline(nodes: OutlineNode[]): string {
  const lines: string[] = []
  const visit = (parentSectionId: string | null, depth: number): void => {
    for (const node of outlineSiblings(nodes, parentSectionId)) {
      lines.push(`${'  '.repeat(depth)}- ${node.title} [${node.status}] (${node.sectionId})`)
      visit(node.sectionId, depth + 1)
    }
  }
  visit(null, 0)
  return lines.join('\n')
}
