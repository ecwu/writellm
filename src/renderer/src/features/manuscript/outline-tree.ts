import type { Section } from '../../../../shared/contracts/manuscript'

export type OutlineMove = 'up' | 'down' | 'indent' | 'outdent'

type OutlineSection = Pick<Section, 'sectionId' | 'parentSectionId' | 'position' | 'level'>

export interface OutlineMoveTarget {
  parentSectionId: string | null
  position: number
}

export interface OutlineMoveAvailability {
  up: boolean
  down: boolean
  indent: boolean
  outdent: boolean
}

export function outlineSelectionTarget(
  sections: readonly Pick<Section, 'sectionId'>[],
  selectedSectionId: string | null,
  activeSectionId: string | null,
  focusSectionId?: string
): string | null {
  const has = (sectionId: string | null | undefined): sectionId is string =>
    sectionId !== null &&
    sectionId !== undefined &&
    sections.some((section) => section.sectionId === sectionId)
  if (has(focusSectionId)) return focusSectionId
  if (has(selectedSectionId)) return selectedSectionId
  if (has(activeSectionId)) return activeSectionId
  return sections[0]?.sectionId ?? null
}

export function visibleOutlineSections<T extends OutlineSection>(
  sections: readonly T[],
  collapsedSectionIds: ReadonlySet<string>
): T[] {
  const byId = new Map(sections.map((section) => [section.sectionId, section]))
  return sections.filter((section) => {
    const visited = new Set<string>()
    let parentId = section.parentSectionId
    while (parentId !== null) {
      if (collapsedSectionIds.has(parentId)) return false
      if (visited.has(parentId)) return false
      visited.add(parentId)
      parentId = byId.get(parentId)?.parentSectionId ?? null
    }
    return true
  })
}

export function sectionHasChildren(
  sections: readonly OutlineSection[],
  sectionId: string
): boolean {
  return sections.some((section) => section.parentSectionId === sectionId)
}

export function outlineMoveAvailability(
  sections: readonly OutlineSection[],
  sectionId: string
): OutlineMoveAvailability {
  const section = sections.find((candidate) => candidate.sectionId === sectionId)
  if (section === undefined) {
    return { up: false, down: false, indent: false, outdent: false }
  }
  const siblings = sections.filter(
    (candidate) => candidate.parentSectionId === section.parentSectionId
  )
  return {
    up: section.position > 0,
    down: section.position < siblings.length - 1,
    indent: section.position > 0,
    outdent: section.parentSectionId !== null
  }
}

export function outlineMoveTarget(
  sections: readonly OutlineSection[],
  sectionId: string,
  move: OutlineMove
): OutlineMoveTarget | null {
  const section = sections.find((candidate) => candidate.sectionId === sectionId)
  if (section === undefined) return null
  const availability = outlineMoveAvailability(sections, sectionId)
  if (!availability[move]) return null
  const siblings = sections.filter(
    (candidate) => candidate.parentSectionId === section.parentSectionId
  )
  if (move === 'up') {
    return { parentSectionId: section.parentSectionId, position: section.position - 1 }
  }
  if (move === 'down') {
    return { parentSectionId: section.parentSectionId, position: section.position + 1 }
  }
  if (move === 'indent') {
    const previousSibling = siblings[section.position - 1]
    if (previousSibling === undefined) return null
    const childCount = sections.filter(
      (candidate) => candidate.parentSectionId === previousSibling.sectionId
    ).length
    return { parentSectionId: previousSibling.sectionId, position: childCount }
  }
  const parent = sections.find((candidate) => candidate.sectionId === section.parentSectionId)
  if (parent === undefined) return null
  return { parentSectionId: parent.parentSectionId, position: parent.position + 1 }
}

export function adjacentSectionAfterDelete(
  sections: readonly OutlineSection[],
  sectionId: string
): string | null {
  const index = sections.findIndex((section) => section.sectionId === sectionId)
  if (index < 0) return sections[0]?.sectionId ?? null
  return sections[index + 1]?.sectionId ?? sections[index - 1]?.sectionId ?? null
}
