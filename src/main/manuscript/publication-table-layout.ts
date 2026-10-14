import type { PublicationNode } from '../../shared/contracts/publication'

export function normalizedPublicationTableWidths(
  source: readonly (number | null)[],
  columns: number,
  unit: 'fraction' | 'percent'
): number[] | null {
  const values = Array.from({ length: columns }, (_, index) => {
    const value = source[index]
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
  })
  const explicit = values.filter((value): value is number => value !== null)
  if (explicit.length === 0) return null
  const explicitTotal = explicit.reduce((sum, value) => sum + value, 0)
  const missing = values.filter((value) => value === null).length
  if (missing > 0 && explicitTotal < 100) {
    // Keep each format's arithmetic order to preserve historical export bytes.
    if (unit === 'fraction') {
      const remainder = (1 - explicitTotal / 100) / missing
      return values.map((value) => (value ?? remainder * 100) / 100)
    }
    const remainder = (100 - explicitTotal) / missing
    return values.map((value) => value ?? remainder)
  }
  const fallback = explicitTotal / explicit.length
  const total = missing === 0 ? explicitTotal : explicitTotal + fallback * missing
  return values.map((value) => {
    const fraction = (value ?? (missing === 0 ? 0 : fallback)) / total
    return unit === 'fraction' ? fraction : fraction * 100
  })
}

type PublicationTableNode = Extract<PublicationNode, { type: 'table' }>

export interface PublicationTableCellPlacement {
  cell: PublicationTableNode['rows'][number][number]
  column: number
}

export function publicationTableCellPlacements(
  node: PublicationTableNode
): PublicationTableCellPlacement[][] {
  const occupied: boolean[][] = []
  const placements: PublicationTableCellPlacement[][] = []
  node.rows.forEach((row, rowIndex) => {
    const current: PublicationTableCellPlacement[] = []
    let rowOccupancy = occupied[rowIndex]
    if (rowOccupancy === undefined) {
      rowOccupancy = []
      occupied[rowIndex] = rowOccupancy
    }
    let column = 0
    for (const cell of row) {
      while (rowOccupancy[column] === true) column += 1
      current.push({ cell, column })
      const colspan = Math.max(1, cell.colspan)
      const rowspan = Math.max(1, cell.rowspan)
      for (let targetRow = rowIndex; targetRow < rowIndex + rowspan; targetRow += 1) {
        let targetOccupancy = occupied[targetRow]
        if (targetOccupancy === undefined) {
          targetOccupancy = []
          occupied[targetRow] = targetOccupancy
        }
        for (let targetColumn = column; targetColumn < column + colspan; targetColumn += 1) {
          targetOccupancy[targetColumn] = true
        }
      }
      column += colspan
    }
    placements.push(current)
  })
  return placements
}

export function publicationTableColumnCount(node: PublicationTableNode): number {
  const placements = publicationTableCellPlacements(node)
  return Math.max(
    1,
    node.columnWidths.length,
    ...placements.flatMap((row) =>
      row.map(({ cell, column }) => column + Math.max(1, cell.colspan))
    )
  )
}
