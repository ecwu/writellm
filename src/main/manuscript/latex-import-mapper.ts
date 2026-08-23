import { randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import type { LatexImportNode, LatexImportWorkerResult } from '../../shared/contracts/latex-import'
import {
  blockNoteDocumentSchema,
  type BlockNoteBlockValue,
  type BlockNoteDocument,
  type BlockNoteInlineContent
} from '../../shared/contracts/manuscript'

export function mapLatexImportResult(
  parsed: LatexImportWorkerResult,
  createId: () => string = randomUUID,
  resources: ReadonlyMap<string, { logicalUrl: string; displayName: string }> = new Map(),
  log?: Pick<Logger, 'info' | 'warn' | 'error'>
): Array<{
  proposedSectionId: string
  title: string
  outlineLevel: number
  document: BlockNoteDocument
}> {
  const startedAt = Date.now()
  try {
    const sections = parsed.sections.map((section) => ({
      proposedSectionId: createId(),
      title: section.title,
      outlineLevel: section.outlineLevel,
      document: blockNoteDocumentSchema.parse(
        section.nodes.flatMap((node) => mapNode(node, createId, resources))
      )
    }))
    log?.info(
      {
        event: 'manuscript.import.latex.mapped',
        sourceHash: parsed.sourceHash,
        sectionCount: sections.length,
        blockCount: sections.reduce((total, section) => total + section.document.length, 0),
        durationMs: Date.now() - startedAt
      },
      'LaTeX import result mapped to manuscript blocks'
    )
    return sections
  } catch (err) {
    log?.error(
      {
        event: 'manuscript.import.latex.map_failed',
        err,
        sourceHash: parsed.sourceHash,
        durationMs: Date.now() - startedAt
      },
      'LaTeX import result mapping failed'
    )
    throw err
  }
}

function mapNode(
  node: LatexImportNode,
  createId: () => string,
  resources: ReadonlyMap<string, { logicalUrl: string; displayName: string }>
): BlockNoteBlockValue[] {
  switch (node.type) {
    case 'paragraph':
      return [textBlock('paragraph', node.content, createId)]
    case 'heading':
      return [
        textBlock('heading', node.content, createId, { level: node.level, isToggleable: false })
      ]
    case 'quote':
      return [
        {
          id: createId(),
          type: 'quote',
          props: { backgroundColor: 'default', textColor: 'default' },
          content: inline(node.content),
          children: []
        }
      ]
    case 'table': {
      const table: BlockNoteBlockValue = {
        id: createId(),
        type: 'table',
        props: { textColor: 'default' },
        content: {
          type: 'tableContent',
          columnWidths: Array.from({ length: node.rows[0]?.length ?? 0 }, () => null),
          headerRows: node.headerRows,
          headerCols: 0,
          rows: node.rows.map((row) => ({ cells: row.map(inline) }))
        },
        children: []
      }
      return node.caption === ''
        ? [table]
        : [
            textBlock(
              'paragraph',
              [{ type: 'text', text: `Table: ${node.caption}`, styles: { italic: true } }],
              createId
            ),
            table
          ]
    }
    case 'figure': {
      const resource = resources.get(node.relativePath)
      if (resource === undefined) {
        throw new Error(`Captured LaTeX figure is unavailable: ${node.relativePath}`)
      }
      return [
        {
          id: createId(),
          type: 'image',
          props: {
            backgroundColor: 'default',
            textAlignment: 'center',
            name: resource.displayName.slice(0, 500),
            url: resource.logicalUrl,
            caption: node.caption,
            altText: node.altText,
            showPreview: true
          },
          children: []
        }
      ]
    }
    case 'list':
      return node.items.map((item, index) => ({
        id: createId(),
        type: node.ordered ? 'numberedListItem' : 'bulletListItem',
        props: { ...textProps(), ...(node.ordered ? { start: index + 1 } : {}) },
        content: inline(item),
        children: []
      }))
    case 'code':
      return [
        {
          id: createId(),
          type: 'codeBlock',
          props: { language: node.language },
          content: [{ type: 'text', text: node.source, styles: { code: true } }],
          children: []
        }
      ]
    case 'math':
      return [
        {
          id: createId(),
          type: 'math',
          props: {
            textAlignment: 'center',
            source: node.source,
            caption: '',
            previewWidth: 720
          },
          children: []
        }
      ]
  }
}

function textBlock(
  type: 'paragraph' | 'heading',
  content: Extract<LatexImportNode, { type: 'paragraph' }>['content'],
  createId: () => string,
  extra: Record<string, unknown> = {}
): BlockNoteBlockValue {
  return {
    id: createId(),
    type,
    props: { ...textProps(), ...extra },
    content: inline(content),
    children: []
  }
}

function inline(
  content: Extract<LatexImportNode, { type: 'paragraph' }>['content']
): BlockNoteInlineContent[] {
  return content.map((part) =>
    part.type === 'math'
      ? { type: 'math', content: part.source }
      : { type: 'text', text: part.text, styles: part.styles }
  )
}

function textProps(): Record<string, string> {
  return { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' }
}
