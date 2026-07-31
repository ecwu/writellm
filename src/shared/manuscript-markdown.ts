import type {
  BlockNoteBlockValue,
  BlockNoteDocument,
  BlockNoteInlineContent,
  BlockNoteTableContent,
  ManuscriptAssembly
} from './contracts/manuscript'
import {
  manuscriptMarkdownLossReportSchema,
  type ManuscriptMarkdownLoss,
  type ManuscriptMarkdownLossReport
} from './contracts/manuscript-export'

type Block = BlockNoteBlockValue
type TextNode = Extract<BlockNoteInlineContent, { type: 'text' }>

export function manuscriptToMarkdown(
  manuscript: ManuscriptAssembly,
  assetPath: (logicalUrl: string) => string
): { markdown: string; lossReport: ManuscriptMarkdownLossReport } {
  const losses: ManuscriptMarkdownLoss[] = []
  const chunks: string[] = []
  for (const item of manuscript.sections) {
    chunks.push(`${'#'.repeat(item.section.level)} ${escapeHeading(item.section.title)}`)
    const body = blocksToMarkdown(
      item.revision.content,
      item.section.sectionId,
      assetPath,
      losses,
      0
    )
    if (body !== '') chunks.push(body)
  }
  return {
    markdown: `${chunks.join('\n\n').trimEnd()}\n`,
    lossReport: manuscriptMarkdownLossReportSchema.parse({ formatVersion: 1, losses })
  }
}

function blocksToMarkdown(
  blocks: BlockNoteDocument,
  sectionId: string,
  assetPath: (logicalUrl: string) => string,
  losses: ManuscriptMarkdownLoss[],
  depth: number
): string {
  return blocks
    .map((block) => blockToMarkdown(block, sectionId, assetPath, losses, depth))
    .filter((value) => value !== '')
    .join('\n\n')
}

function blockToMarkdown(
  block: Block,
  sectionId: string,
  assetPath: (logicalUrl: string) => string,
  losses: ManuscriptMarkdownLoss[],
  depth: number
): string {
  reportBlockProperties(block, sectionId, losses)
  if (
    block.children.length > 0 &&
    block.type !== 'bulletListItem' &&
    block.type !== 'numberedListItem' &&
    block.type !== 'checkListItem'
  ) {
    addLoss(
      losses,
      'nested_block_structure',
      sectionId,
      block.id,
      'Nested block structure is emitted sequentially because Markdown cannot preserve this nesting.'
    )
  }
  const children = blocksToMarkdown(block.children, sectionId, assetPath, losses, depth + 1)
  let body: string
  switch (block.type) {
    case 'paragraph':
      body = renderInline(textContent(block), block, sectionId, losses)
      break
    case 'heading': {
      const props = block.props as { level: number }
      body = `${'#'.repeat(props.level)} ${renderInline(textContent(block), block, sectionId, losses)}`
      break
    }
    case 'bulletListItem':
      body = `${'  '.repeat(depth)}- ${renderInline(textContent(block), block, sectionId, losses)}`
      break
    case 'numberedListItem': {
      const props = block.props as { start?: number }
      body = `${'  '.repeat(depth)}${props.start ?? 1}. ${renderInline(textContent(block), block, sectionId, losses)}`
      break
    }
    case 'checkListItem': {
      const props = block.props as { checked: boolean }
      body = `${'  '.repeat(depth)}- [${props.checked ? 'x' : ' '}] ${renderInline(textContent(block), block, sectionId, losses)}`
      break
    }
    case 'quote':
      body = renderInline(textContent(block), block, sectionId, losses)
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
      break
    case 'codeBlock': {
      const source = inlinePlainText(textContent(block))
      const props = block.props as { language: string }
      const fence = longestFence(source)
      body = `${fence}${props.language}\n${source}\n${fence}`
      break
    }
    case 'table':
      body = renderTable(block, block.content as BlockNoteTableContent, sectionId, losses)
      break
    case 'image': {
      const props = block.props as { name: string; caption: string; url: string }
      const alt = escapeInline(props.name || props.caption || 'Image')
      body = `![${alt}](${assetPath(props.url)})`
      if (props.caption !== '') body += `\n\n_${escapeInline(props.caption)}_`
      break
    }
    case 'mermaid': {
      const props = block.props as { source: string; caption: string }
      body = `\`\`\`mermaid\n${props.source}\n\`\`\``
      if (props.caption !== '') body += `\n\n_${escapeInline(props.caption)}_`
      break
    }
    case 'math': {
      const props = block.props as { source: string; caption: string }
      body = `$$\n${props.source}\n$$`
      if (props.caption !== '') body += `\n\n_${escapeInline(props.caption)}_`
      break
    }
  }
  if (children === '') return body
  return body === '' ? children : `${body}\n\n${children}`
}

function renderInline(
  content: readonly BlockNoteInlineContent[],
  block: Block,
  sectionId: string,
  losses: ManuscriptMarkdownLoss[]
): string {
  return content
    .map((node) => {
      if (node.type === 'link') {
        return `[${node.content.map((child) => renderStyledText(child, block, sectionId, losses)).join('')}](${node.href})`
      }
      return renderStyledText(node, block, sectionId, losses)
    })
    .join('')
}

function renderStyledText(
  node: TextNode,
  block: Block,
  sectionId: string,
  losses: ManuscriptMarkdownLoss[]
): string {
  const styles = node.styles
  if (styles.underline === true) {
    addLoss(
      losses,
      'underline',
      sectionId,
      block.id,
      'Underlined text is exported without underline.'
    )
  }
  if (styles.textColor !== undefined && styles.textColor !== 'default') {
    addLoss(
      losses,
      'text_color',
      sectionId,
      block.id,
      'Inline text color is not represented in Markdown.'
    )
  }
  if (styles.backgroundColor !== undefined && styles.backgroundColor !== 'default') {
    addLoss(
      losses,
      'background_color',
      sectionId,
      block.id,
      'Inline highlight color is not represented in Markdown.'
    )
  }
  let value = escapeInline(node.text)
  if (styles.code === true) value = renderCodeSpan(node.text)
  if (styles.bold === true) value = `**${value}**`
  if (styles.italic === true) value = `*${value}*`
  if (styles.strike === true) value = `~~${value}~~`
  return value
}

function renderTable(
  block: Block,
  content: BlockNoteTableContent,
  sectionId: string,
  losses: ManuscriptMarkdownLoss[]
): string {
  const rows = content.rows
  if (rows.length === 0) return ''
  const width = Math.max(...rows.map((row) => row.cells.length))
  const renderCell = (cell: (typeof rows)[number]['cells'][number]): string => {
    const value = Array.isArray(cell) ? cell : cell.content
    if (!Array.isArray(cell)) {
      if (cell.props.textColor !== 'default') {
        addLoss(
          losses,
          'text_color',
          sectionId,
          block.id,
          'Table cell text color is not represented in Markdown.'
        )
      }
      if (cell.props.backgroundColor !== 'default') {
        addLoss(
          losses,
          'background_color',
          sectionId,
          block.id,
          'Table cell background color is not represented in Markdown.'
        )
      }
      if (cell.props.textAlignment !== 'left') {
        addLoss(
          losses,
          'text_alignment',
          sectionId,
          block.id,
          'Table cell alignment is not represented in Markdown.'
        )
      }
    }
    if (
      !Array.isArray(cell) &&
      ((cell.props.colspan ?? 1) !== 1 || (cell.props.rowspan ?? 1) !== 1)
    ) {
      addLoss(
        losses,
        'table_span',
        sectionId,
        block.id,
        'Table row or column spans are flattened in Markdown.'
      )
    }
    return renderInline(value, block, sectionId, losses)
      .replace(/\|/g, '\\|')
      .replace(/\n/g, '<br>')
  }
  const matrix = rows.map((row) =>
    Array.from({ length: width }, (_, index) => renderCell(row.cells[index] ?? []))
  )
  if ((content.headerCols ?? 0) > 0) {
    addLoss(
      losses,
      'table_header_columns',
      sectionId,
      block.id,
      'Table header columns are exported as ordinary cells.'
    )
  }
  if ((content.headerRows ?? 0) === 0) {
    addLoss(
      losses,
      'table_header_inference',
      sectionId,
      block.id,
      'The first table row is emitted as the required GFM header row.'
    )
  }
  if ((content.headerRows ?? 0) > 1) {
    addLoss(
      losses,
      'table_multiple_header_rows',
      sectionId,
      block.id,
      'Only the first table row can be represented as a GFM header.'
    )
  }
  const lines = matrix.map((row) => `| ${row.join(' | ')} |`)
  lines.splice(1, 0, `| ${Array.from({ length: width }, () => '---').join(' | ')} |`)
  return lines.join('\n')
}

function reportBlockProperties(
  block: Block,
  sectionId: string,
  losses: ManuscriptMarkdownLoss[]
): void {
  const props = block.props as Record<string, unknown>
  if (props.textColor !== undefined && props.textColor !== 'default') {
    addLoss(
      losses,
      'text_color',
      sectionId,
      block.id,
      'Block text color is not represented in Markdown.'
    )
  }
  if (props.backgroundColor !== undefined && props.backgroundColor !== 'default') {
    addLoss(
      losses,
      'background_color',
      sectionId,
      block.id,
      'Block background color is not represented in Markdown.'
    )
  }
  if (props.textAlignment !== undefined && props.textAlignment !== 'left') {
    addLoss(
      losses,
      'text_alignment',
      sectionId,
      block.id,
      'Block alignment is not represented in Markdown.'
    )
  }
  if (block.type === 'heading' && props.isToggleable === true) {
    addLoss(
      losses,
      'toggle_heading',
      sectionId,
      block.id,
      'Toggle behavior is not represented in Markdown.'
    )
  }
  if ('previewWidth' in props && props.previewWidth !== undefined) {
    addLoss(
      losses,
      'preview_width',
      sectionId,
      block.id,
      'Preview width is not represented in Markdown.'
    )
  }
}

function addLoss(
  losses: ManuscriptMarkdownLoss[],
  code: ManuscriptMarkdownLoss['code'],
  sectionId: string,
  blockId: string,
  message: string
): void {
  if (
    losses.some(
      (loss) => loss.code === code && loss.sectionId === sectionId && loss.blockId === blockId
    )
  ) {
    return
  }
  losses.push({ code, sectionId, blockId, message })
}

function escapeHeading(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/#/g, '\\#').trim()
}

function escapeInline(value: string): string {
  return value.replace(/([\\`*_[\]<>#+\-.!|{}()])/g, '\\$1').replace(/\r?\n/g, '  \n')
}

function inlinePlainText(content: readonly BlockNoteInlineContent[]): string {
  return content
    .map((node) =>
      node.type === 'link' ? node.content.map((child) => child.text).join('') : node.text
    )
    .join('')
}

function textContent(block: Block): readonly BlockNoteInlineContent[] {
  return Array.isArray(block.content) ? block.content : []
}

function renderCodeSpan(value: string): string {
  const fence = '`'.repeat(Math.max(1, longestRun(value, '`') + 1))
  const padding = value.startsWith('`') || value.endsWith('`') ? ' ' : ''
  return `${fence}${padding}${value}${padding}${fence}`
}

function longestFence(value: string): string {
  return '`'.repeat(Math.max(3, longestRun(value, '`') + 1))
}

function longestRun(value: string, character: string): number {
  let current = 0
  let longest = 0
  for (const item of value) {
    current = item === character ? current + 1 : 0
    longest = Math.max(longest, current)
  }
  return longest
}
