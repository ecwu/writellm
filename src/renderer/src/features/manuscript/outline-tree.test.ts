import { describe, expect, it } from 'vitest'
import {
  adjacentSectionAfterDelete,
  outlineMoveAvailability,
  outlineMoveTarget,
  sectionHasChildren,
  visibleOutlineSections
} from './outline-tree'

const sections = [
  { sectionId: 'root-a', parentSectionId: null, position: 0, level: 1 },
  { sectionId: 'child-a', parentSectionId: 'root-a', position: 0, level: 2 },
  { sectionId: 'grandchild-a', parentSectionId: 'child-a', position: 0, level: 3 },
  { sectionId: 'child-b', parentSectionId: 'root-a', position: 1, level: 2 },
  { sectionId: 'root-b', parentSectionId: null, position: 1, level: 1 }
] as const

describe('outline tree helpers', () => {
  it('hides every descendant of a collapsed section while retaining outline order', () => {
    expect(
      visibleOutlineSections(sections, new Set(['root-a'])).map((section) => section.sectionId)
    ).toEqual(['root-a', 'root-b'])
    expect(
      visibleOutlineSections(sections, new Set(['child-a'])).map((section) => section.sectionId)
    ).toEqual(['root-a', 'child-a', 'child-b', 'root-b'])
  })

  it('derives child and movement availability at sibling boundaries', () => {
    expect(sectionHasChildren(sections, 'root-a')).toBe(true)
    expect(sectionHasChildren(sections, 'child-b')).toBe(false)
    expect(outlineMoveAvailability(sections, 'child-a')).toEqual({
      up: false,
      down: true,
      indent: false,
      outdent: true
    })
    expect(outlineMoveAvailability(sections, 'child-b')).toEqual({
      up: true,
      down: false,
      indent: true,
      outdent: true
    })
  })

  it('calculates explicit sibling, indent, and outdent targets', () => {
    expect(outlineMoveTarget(sections, 'child-b', 'up')).toEqual({
      parentSectionId: 'root-a',
      position: 0
    })
    expect(outlineMoveTarget(sections, 'child-b', 'indent')).toEqual({
      parentSectionId: 'child-a',
      position: 1
    })
    expect(outlineMoveTarget(sections, 'grandchild-a', 'outdent')).toEqual({
      parentSectionId: 'root-a',
      position: 1
    })
    expect(outlineMoveTarget(sections, 'child-a', 'up')).toBeNull()
  })

  it('prefers the following outline item when an active leaf is deleted', () => {
    expect(adjacentSectionAfterDelete(sections, 'child-b')).toBe('root-b')
    expect(adjacentSectionAfterDelete(sections, 'root-b')).toBe('child-b')
    expect(adjacentSectionAfterDelete([sections[0]], 'root-a')).toBeNull()
  })
})
