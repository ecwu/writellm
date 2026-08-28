import { describe, expect, it } from 'vitest'
import type { BlockNoteTableContent } from './contracts/manuscript'
import {
  createTableContent,
  editTableContent,
  inspectTableContent,
  summarizeTableChange,
  type TableTransformError,
  tableCellPlainText
} from './manuscript-table'

describe('manuscript table transformer', () => {
  it('creates normalized rectangular tables without mutating input', () => {
    const input = {
      headerRows: 1 as const,
      headerCols: 1 as const,
      rows: [
        [
          'Name',
          {
            content: [{ type: 'text' as const, text: 'Value', styles: {} }],
            textAlignment: 'right' as const
          }
        ],
        ['A', '1']
      ]
    }
    const before = structuredClone(input)
    const table = createTableContent(input)
    expect(input).toEqual(before)
    expect(inspectTableContent(table)).toMatchObject({
      rowCount: 2,
      columnCount: 2,
      headerRows: 1,
      headerCols: 1,
      hasSpans: false
    })
    expect(inspectTableContent(table).anchors[1].cell.props.textAlignment).toBe('right')
    expect(table.rows[0]?.cells[0]).toMatchObject({
      type: 'tableCell',
      props: { colspan: 1, rowspan: 1 }
    })
  })

  it('applies sequential cell, row, column, move, header and alignment edits', () => {
    const source = createTableContent({
      headerRows: 0,
      headerCols: 0,
      rows: [
        ['A', 'B'],
        ['C', 'D']
      ]
    })
    const result = editTableContent(source, [
      { type: 'setCell', row: 0, column: 1, cell: '' },
      { type: 'insertRows', index: 1, rows: [['E', 'F']] },
      { type: 'insertColumns', index: 2, columns: [['1', '2', '3']] },
      { type: 'moveRow', from: 2, to: 0 },
      { type: 'moveColumn', from: 2, to: 0 },
      { type: 'deleteRows', index: 2, count: 1 },
      { type: 'deleteColumns', index: 2, count: 1 },
      { type: 'setHeaders', headerRows: 1, headerCols: 1 },
      { type: 'setColumnAlignment', column: 1, textAlignment: 'center' }
    ])
    const grid = inspectTableContent(result)
    expect(grid).toMatchObject({ rowCount: 2, columnCount: 2, headerRows: 1, headerCols: 1 })
    expect(
      grid.occupancy.map((row) =>
        row.map((cell) => (cell === null ? '' : tableCellPlainText(cell.cell)))
      )
    ).toEqual([
      ['3', 'C'],
      ['1', 'A']
    ])
    expect(grid.occupancy.every((row) => row[1]?.cell.props.textAlignment === 'center')).toBe(true)
    expect(source).toEqual(
      createTableContent({
        headerRows: 0,
        headerCols: 0,
        rows: [
          ['A', 'B'],
          ['C', 'D']
        ]
      })
    )
  })

  it('identifies span anchors and rejects covered or structural edits', () => {
    const spanned: BlockNoteTableContent = {
      type: 'tableContent',
      columnWidths: [null, null],
      headerRows: 1,
      headerCols: 0,
      rows: [
        {
          cells: [
            {
              type: 'tableCell',
              props: {
                backgroundColor: 'default',
                textColor: 'default',
                textAlignment: 'left',
                colspan: 2
              },
              content: [{ type: 'text', text: 'Header', styles: {} }]
            }
          ]
        },
        { cells: [[], []] }
      ]
    }
    expect(inspectTableContent(spanned)).toMatchObject({ hasSpans: true, columnCount: 2 })
    expect(() =>
      editTableContent(spanned, [{ type: 'setCell', row: 0, column: 1, cell: 'x' }])
    ).toThrowError(expect.objectContaining<TableTransformError>({ code: 'covered-coordinate' }))
    expect(() =>
      editTableContent(spanned, [{ type: 'insertRows', index: 1, rows: [['x', 'y']] }])
    ).toThrowError(expect.objectContaining<TableTransformError>({ code: 'unsupported-structure' }))
    expect(
      tableCellPlainText(
        inspectTableContent(
          editTableContent(spanned, [{ type: 'setCell', row: 0, column: 0, cell: 'Updated' }])
        ).anchors[0].cell
      )
    ).toBe('Updated')
  })

  it('rejects non-rectangular and bounded-invalid input', () => {
    expect(() =>
      createTableContent({ headerRows: 0, headerCols: 0, rows: [['a'], ['b', 'c']] })
    ).toThrowError(expect.objectContaining<TableTransformError>({ code: 'invalid-table' }))
    expect(() =>
      createTableContent({ headerRows: 0, headerCols: 0, rows: [['x'.repeat(8_193)]] })
    ).toThrowError(expect.objectContaining<TableTransformError>({ code: 'limit-exceeded' }))
  })

  it('derives a bounded structural and cell summary', () => {
    const before = createTableContent({ headerRows: 0, headerCols: 0, rows: [['A']] })
    const after = editTableContent(before, [
      { type: 'insertColumns', index: 1, columns: [['B']] },
      { type: 'setHeaders', headerRows: 1, headerCols: 0 }
    ])
    expect(summarizeTableChange(before, after)).toMatchObject({
      beforeRows: 1,
      beforeColumns: 1,
      afterRows: 1,
      afterColumns: 2,
      structuralChanges: ['Columns: 1 → 2', 'Headers: 0 row/0 column → 1 row/0 column'],
      changedCells: [{ row: 0, column: 1, before: null, after: 'B' }],
      truncated: false
    })
  })
})
