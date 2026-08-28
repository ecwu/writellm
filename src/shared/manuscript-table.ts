import type { BlockNoteInlineContent, BlockNoteTableContent } from './contracts/manuscript'

export const TABLE_MAX_ROWS = 100
export const TABLE_MAX_COLUMNS = 30
export const TABLE_MAX_PHYSICAL_CELLS = 1_000
export const TABLE_MAX_CELL_TEXT = 8_192

export type TableAlignment = 'left' | 'center' | 'right' | 'justify'
export interface NormalizedTableCell {
  type: 'tableCell'
  props: {
    backgroundColor: string
    textColor: string
    textAlignment: TableAlignment
    colspan: number
    rowspan: number
  }
  content: BlockNoteInlineContent[]
}
export interface TableAnchor {
  row: number
  column: number
  rowspan: number
  colspan: number
  cell: NormalizedTableCell
}
export interface TableGrid {
  rowCount: number
  columnCount: number
  headerRows: number
  headerCols: number
  columnWidths: (number | null)[]
  anchors: TableAnchor[]
  occupancy: (TableAnchor | null)[][]
  hasSpans: boolean
}
export type TableCellInput =
  | string
  | { content: BlockNoteInlineContent[]; textAlignment?: TableAlignment }
export type TableEditOperation =
  | { type: 'setCell'; row: number; column: number; cell: TableCellInput }
  | { type: 'insertRows'; index: number; rows: TableCellInput[][] }
  | { type: 'deleteRows'; index: number; count: number }
  | { type: 'insertColumns'; index: number; columns: TableCellInput[][] }
  | { type: 'deleteColumns'; index: number; count: number }
  | { type: 'moveRow'; from: number; to: number }
  | { type: 'moveColumn'; from: number; to: number }
  | { type: 'setHeaders'; headerRows: 0 | 1; headerCols: 0 | 1 }
  | { type: 'setColumnAlignment'; column: number; textAlignment: TableAlignment }

export class TableTransformError extends Error {
  constructor(
    readonly code:
      | 'invalid-table'
      | 'out-of-bounds'
      | 'limit-exceeded'
      | 'covered-coordinate'
      | 'unsupported-structure',
    message: string
  ) {
    super(message)
    this.name = 'TableTransformError'
  }
}

function inlineText(content: readonly BlockNoteInlineContent[]): string {
  return content
    .map((value) => {
      if (value.type === 'text') return value.text
      if (value.type === 'link') return value.content.map((item) => item.text).join('')
      return value.content
    })
    .join('')
}

function normalizeCell(
  value: BlockNoteTableContent['rows'][number]['cells'][number]
): NormalizedTableCell {
  if (Array.isArray(value)) {
    return {
      type: 'tableCell',
      props: {
        backgroundColor: 'default',
        textColor: 'default',
        textAlignment: 'left',
        colspan: 1,
        rowspan: 1
      },
      content: structuredClone(value)
    }
  }
  return {
    type: 'tableCell',
    props: {
      backgroundColor: value.props.backgroundColor,
      textColor: value.props.textColor,
      textAlignment: value.props.textAlignment,
      colspan: value.props.colspan ?? 1,
      rowspan: value.props.rowspan ?? 1
    },
    content: structuredClone(value.content)
  }
}

export function normalizeTableCell(input: TableCellInput): NormalizedTableCell {
  const content: BlockNoteInlineContent[] =
    typeof input === 'string'
      ? input.length === 0
        ? []
        : [{ type: 'text', text: input, styles: {} }]
      : structuredClone(input.content)
  if (inlineText(content).length > TABLE_MAX_CELL_TEXT) {
    throw new TableTransformError('limit-exceeded', 'Table cell text exceeds 8,192 characters')
  }
  return {
    type: 'tableCell',
    props: {
      backgroundColor: 'default',
      textColor: 'default',
      textAlignment: typeof input === 'string' ? 'left' : (input.textAlignment ?? 'left'),
      colspan: 1,
      rowspan: 1
    },
    content
  }
}

export function inspectTableContent(content: BlockNoteTableContent): TableGrid {
  const rowCount = content.rows.length
  if (rowCount < 1) throw new TableTransformError('invalid-table', 'Table must contain a row')
  if (rowCount > TABLE_MAX_ROWS)
    throw new TableTransformError('limit-exceeded', 'Table exceeds 100 rows')
  const columnHint = content.columnWidths.length
  const occupancy: (TableAnchor | null)[][] = Array.from({ length: rowCount }, () => [])
  const anchors: TableAnchor[] = []
  let physicalCells = 0
  let maximumColumn = 0
  for (let row = 0; row < rowCount; row += 1) {
    let column = 0
    for (const rawCell of content.rows[row].cells) {
      while (occupancy[row][column] !== undefined) column += 1
      const cell = normalizeCell(rawCell)
      const rowspan = cell.props.rowspan ?? 1
      const colspan = cell.props.colspan ?? 1
      if (row + rowspan > rowCount)
        throw new TableTransformError('invalid-table', 'Table rowspan extends beyond the final row')
      if (columnHint > 0 && column + colspan > columnHint)
        throw new TableTransformError('invalid-table', 'Table colspan extends beyond column widths')
      const anchor: TableAnchor = { row, column, rowspan, colspan, cell }
      for (let occupiedRow = row; occupiedRow < row + rowspan; occupiedRow += 1) {
        for (let occupiedColumn = column; occupiedColumn < column + colspan; occupiedColumn += 1) {
          if (occupancy[occupiedRow][occupiedColumn] !== undefined) {
            throw new TableTransformError('invalid-table', 'Table spans overlap')
          }
          occupancy[occupiedRow][occupiedColumn] = anchor
        }
      }
      anchors.push(anchor)
      physicalCells += 1
      maximumColumn = Math.max(maximumColumn, column + colspan)
      column += colspan
    }
  }
  const columnCount = columnHint || maximumColumn
  if (columnCount < 1) throw new TableTransformError('invalid-table', 'Table must contain a column')
  if (columnCount > TABLE_MAX_COLUMNS)
    throw new TableTransformError('limit-exceeded', 'Table exceeds 30 columns')
  if (physicalCells > TABLE_MAX_PHYSICAL_CELLS)
    throw new TableTransformError('limit-exceeded', 'Table exceeds 1,000 physical cells')
  for (let row = 0; row < rowCount; row += 1) {
    occupancy[row].length = columnCount
    for (let column = 0; column < columnCount; column += 1) {
      if (occupancy[row][column] === undefined) {
        throw new TableTransformError('invalid-table', 'Table occupancy is not rectangular')
      }
    }
  }
  const headerRows = content.headerRows ?? 0
  const headerCols = content.headerCols ?? 0
  return {
    rowCount,
    columnCount,
    headerRows,
    headerCols,
    columnWidths: Array.from(
      { length: columnCount },
      (_, index) => content.columnWidths[index] ?? null
    ),
    anchors,
    occupancy,
    hasSpans: anchors.some((anchor) => anchor.rowspan > 1 || anchor.colspan > 1)
  }
}

function simpleRows(content: BlockNoteTableContent): NormalizedTableCell[][] {
  const grid = inspectTableContent(content)
  if (grid.hasSpans)
    throw new TableTransformError(
      'unsupported-structure',
      'Structural table edits do not support spans'
    )
  return grid.occupancy.map((row) =>
    row.map((anchor) => {
      if (anchor === null) throw new TableTransformError('invalid-table', 'Table has an empty cell')
      return structuredClone(anchor.cell)
    })
  )
}

function assertIndex(index: number, maximum: number, allowEnd = false): void {
  const upper = allowEnd ? maximum : maximum - 1
  if (index < 0 || index > upper)
    throw new TableTransformError('out-of-bounds', `Table coordinate ${index} is out of bounds`)
}

function serializeSimple(
  rows: NormalizedTableCell[][],
  headerRows: 0 | 1,
  headerCols: 0 | 1,
  columnWidths: (number | null)[]
): BlockNoteTableContent {
  if (rows.length < 1 || rows.length > TABLE_MAX_ROWS)
    throw new TableTransformError('limit-exceeded', 'Table must contain 1–100 rows')
  const width = rows[0]?.length ?? 0
  if (width < 1 || width > TABLE_MAX_COLUMNS)
    throw new TableTransformError('limit-exceeded', 'Table must contain 1–30 columns')
  if (rows.some((row) => row.length !== width))
    throw new TableTransformError('invalid-table', 'Table rows must have equal width')
  if (rows.length * width > TABLE_MAX_PHYSICAL_CELLS)
    throw new TableTransformError('limit-exceeded', 'Table exceeds 1,000 physical cells')
  return {
    type: 'tableContent',
    columnWidths: Array.from({ length: width }, (_, index) => columnWidths[index] ?? null),
    headerRows,
    headerCols,
    rows: rows.map((cells) => ({ cells }))
  }
}

export function createTableContent(input: {
  headerRows: 0 | 1
  headerCols: 0 | 1
  rows: TableCellInput[][]
}): BlockNoteTableContent {
  if (input.rows.length === 0 || input.rows[0]?.length === 0)
    throw new TableTransformError('invalid-table', 'Table rows cannot be empty')
  return serializeSimple(
    input.rows.map((row) => row.map(normalizeTableCell)),
    input.headerRows,
    input.headerCols,
    []
  )
}

export function editTableContent(
  source: BlockNoteTableContent,
  operations: readonly TableEditOperation[]
): BlockNoteTableContent {
  let content = structuredClone(source)
  for (const operation of operations) {
    const grid = inspectTableContent(content)
    if (operation.type === 'setCell') {
      assertIndex(operation.row, grid.rowCount)
      assertIndex(operation.column, grid.columnCount)
      const anchor = grid.occupancy[operation.row][operation.column]
      if (anchor === null || anchor === undefined)
        throw new TableTransformError('out-of-bounds', 'Table coordinate is empty')
      if (anchor.row !== operation.row || anchor.column !== operation.column)
        throw new TableTransformError('covered-coordinate', 'Table coordinate is covered by a span')
      const replacement = normalizeTableCell(operation.cell)
      replacement.props = {
        ...anchor.cell.props,
        textAlignment:
          typeof operation.cell === 'string' || operation.cell.textAlignment === undefined
            ? anchor.cell.props.textAlignment
            : operation.cell.textAlignment
      }
      content.rows[anchor.row].cells[
        grid.anchors.filter((candidate) => candidate.row === anchor.row).indexOf(anchor)
      ] = replacement
      continue
    }
    if (grid.hasSpans || grid.headerRows > 1 || grid.headerCols > 1)
      throw new TableTransformError(
        'unsupported-structure',
        'Structural table edits do not support spans or multiple headers'
      )
    const rows = simpleRows(content)
    let headerRows = grid.headerRows as 0 | 1
    let headerCols = grid.headerCols as 0 | 1
    const widths = [...grid.columnWidths]
    if (operation.type === 'insertRows') {
      assertIndex(operation.index, rows.length, true)
      if (operation.rows.some((row) => row.length !== grid.columnCount))
        throw new TableTransformError('invalid-table', 'Inserted rows must match table width')
      rows.splice(operation.index, 0, ...operation.rows.map((row) => row.map(normalizeTableCell)))
    } else if (operation.type === 'deleteRows') {
      assertIndex(operation.index, rows.length)
      if (operation.count < 1 || operation.index + operation.count > rows.length)
        throw new TableTransformError('out-of-bounds', 'Deleted row range is out of bounds')
      rows.splice(operation.index, operation.count)
    } else if (operation.type === 'insertColumns') {
      assertIndex(operation.index, grid.columnCount, true)
      if (
        operation.columns.length < 1 ||
        operation.columns.some((column) => column.length !== rows.length)
      )
        throw new TableTransformError('invalid-table', 'Each inserted column must cover every row')
      operation.columns.forEach((column, offset) => {
        rows.forEach((row, rowIndex) => {
          row.splice(operation.index + offset, 0, normalizeTableCell(column[rowIndex]))
        })
        widths.splice(operation.index + offset, 0, null)
      })
    } else if (operation.type === 'deleteColumns') {
      assertIndex(operation.index, grid.columnCount)
      if (operation.count < 1 || operation.index + operation.count > grid.columnCount)
        throw new TableTransformError('out-of-bounds', 'Deleted column range is out of bounds')
      rows.forEach((row) => {
        row.splice(operation.index, operation.count)
      })
      widths.splice(operation.index, operation.count)
    } else if (operation.type === 'moveRow') {
      assertIndex(operation.from, rows.length)
      assertIndex(operation.to, rows.length)
      const [moved] = rows.splice(operation.from, 1)
      rows.splice(operation.to, 0, moved)
    } else if (operation.type === 'moveColumn') {
      assertIndex(operation.from, grid.columnCount)
      assertIndex(operation.to, grid.columnCount)
      rows.forEach((row) => {
        const [moved] = row.splice(operation.from, 1)
        row.splice(operation.to, 0, moved)
      })
      const [movedWidth] = widths.splice(operation.from, 1)
      widths.splice(operation.to, 0, movedWidth)
    } else if (operation.type === 'setHeaders') {
      headerRows = operation.headerRows
      headerCols = operation.headerCols
    } else {
      assertIndex(operation.column, grid.columnCount)
      rows.forEach((row) => {
        row[operation.column].props.textAlignment = operation.textAlignment
      })
    }
    content = serializeSimple(rows, headerRows, headerCols, widths)
  }
  inspectTableContent(content)
  return content
}

export function tableCellPlainText(cell: NormalizedTableCell): string {
  return inlineText(cell.content)
}

export interface TableChangeSummary {
  beforeRows: number
  beforeColumns: number
  afterRows: number
  afterColumns: number
  structuralChanges: string[]
  changedCells: Array<{ row: number; column: number; before: string | null; after: string | null }>
  truncated: boolean
}

export function summarizeTableChange(
  before: BlockNoteTableContent | null,
  after: BlockNoteTableContent | null,
  cellLimit = 100
): TableChangeSummary {
  const beforeGrid = before === null ? null : inspectTableContent(before)
  const afterGrid = after === null ? null : inspectTableContent(after)
  const structuralChanges: string[] = []
  if (beforeGrid === null) structuralChanges.push('Table inserted')
  if (afterGrid === null) structuralChanges.push('Table deleted')
  if (beforeGrid !== null && afterGrid !== null) {
    if (beforeGrid.rowCount !== afterGrid.rowCount)
      structuralChanges.push(`Rows: ${beforeGrid.rowCount} → ${afterGrid.rowCount}`)
    if (beforeGrid.columnCount !== afterGrid.columnCount)
      structuralChanges.push(`Columns: ${beforeGrid.columnCount} → ${afterGrid.columnCount}`)
    if (
      beforeGrid.headerRows !== afterGrid.headerRows ||
      beforeGrid.headerCols !== afterGrid.headerCols
    )
      structuralChanges.push(
        `Headers: ${beforeGrid.headerRows} row/${beforeGrid.headerCols} column → ${afterGrid.headerRows} row/${afterGrid.headerCols} column`
      )
  }
  const values = (grid: TableGrid | null): Map<string, string> =>
    new Map(
      (grid?.anchors ?? []).map((anchor) => [
        `${anchor.row}:${anchor.column}`,
        tableCellPlainText(anchor.cell)
      ])
    )
  const beforeCells = values(beforeGrid)
  const afterCells = values(afterGrid)
  const coordinates = [...new Set([...beforeCells.keys(), ...afterCells.keys()])].sort(
    (left, right) => {
      const [leftRow, leftColumn] = left.split(':').map(Number)
      const [rightRow, rightColumn] = right.split(':').map(Number)
      return leftRow - rightRow || leftColumn - rightColumn
    }
  )
  const changedCells = coordinates.flatMap((coordinate) => {
    const beforeValue = beforeCells.get(coordinate) ?? null
    const afterValue = afterCells.get(coordinate) ?? null
    if (beforeValue === afterValue) return []
    const [row, column] = coordinate.split(':').map(Number)
    return [{ row, column, before: beforeValue, after: afterValue }]
  })
  if (structuralChanges.length === 0 && changedCells.length > 1)
    structuralChanges.push('Cell order or content changed')
  return {
    beforeRows: beforeGrid?.rowCount ?? 0,
    beforeColumns: beforeGrid?.columnCount ?? 0,
    afterRows: afterGrid?.rowCount ?? 0,
    afterColumns: afterGrid?.columnCount ?? 0,
    structuralChanges,
    changedCells: changedCells.slice(0, cellLimit),
    truncated: changedCells.length > cellLimit
  }
}
