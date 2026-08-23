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
import {
  buildManuscriptReferenceIndex,
  findReadableCitations,
  normalizeCitationTitle,
  referenceNumberMap,
  replaceReadableCitations
} from './readable-citation'

type Block = BlockNoteBlockValue
type TextNode = Extract<BlockNoteInlineContent, { type: 'text' }>
const CITATION_MARKER_PATTERN = /\uE000citation:(\d+)\uE001/gu

export function manuscriptToMarkdown(
  manuscript: ManuscriptAssembly,
  assetPath: (logicalUrl: string) => string
): { markdown: string; lossReport: ManuscriptMarkdownLossReport } {
  const losses: ManuscriptMarkdownLoss[] = []
  const chunks: string[] = []
  const citationNumbers = referenceNumberMap(
    buildManuscriptReferenceIndex(
      manuscript.sections.map((item) => ({
        sectionId: item.section.sectionId,
        sectionRevisionId: item.revision.sectionRevisionId,
        content: item.revision.content
      }))
    )
  )
  for (const item of manuscript.sections) {
    chunks.push(`${'#'.repeat(item.section.level)} ${escapeHeading(item.section.title)}`)
    const body = blocksToMarkdown(
      item.revision.content,
      item.section.sectionId,
      assetPath,
      losses,
      0,
      citationNumbers
    )
    if (body !== '') chunks.push(body)
  }
  return {
    markdown: `${chunks.join('\n\n').trimEnd()}\n`,
    lossReport: manuscriptMarkdownLossReportSchema.parse({ formatVersion: 1, losses })
  }
}

export function manuscriptSectionToMarkdown(
  manuscript: ManuscriptAssembly,
  sectionId: string,
  assetPath: (logicalUrl: string) => string
): { markdown: string; lossReport: ManuscriptMarkdownLossReport } {
  const item = manuscript.sections.find((candidate) => candidate.section.sectionId === sectionId)
  if (item === undefined) throw new Error('Manuscript section was not found')
  const losses: ManuscriptMarkdownLoss[] = []
  const citationNumbers = referenceNumberMap(
    buildManuscriptReferenceIndex(
      manuscript.sections.map((candidate) => ({
        sectionId: candidate.section.sectionId,
        sectionRevisionId: candidate.revision.sectionRevisionId,
        content: candidate.revision.content
      }))
    )
  )
  const body = blocksToMarkdown(
    item.revision.content,
    sectionId,
    assetPath,
    losses,
    0,
    citationNumbers
  )
  return {
    markdown: body === '' ? '' : `${body.trimEnd()}\n`,
    lossReport: manuscriptMarkdownLossReportSchema.parse({ formatVersion: 1, losses })
  }
}

function blocksToMarkdown(
  blocks: BlockNoteDocument,
  sectionId: string,
  assetPath: (logicalUrl: string) => string,
  losses: ManuscriptMarkdownLoss[],
  depth: number,
  citationNumbers: ReadonlyMap<string, number>
): string {
  return blocks
    .map((block) => blockToMarkdown(block, sectionId, assetPath, losses, depth, citationNumbers))
    .filter((value) => value !== '')
    .join('\n\n')
}

function blockToMarkdown(
  block: Block,
  sectionId: string,
  assetPath: (logicalUrl: string) => string,
  losses: ManuscriptMarkdownLoss[],
  depth: number,
  citationNumbers: ReadonlyMap<string, number>
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
  const children = blocksToMarkdown(
    block.children,
    sectionId,
    assetPath,
    losses,
    depth + 1,
    citationNumbers
  )
  let body: string
  switch (block.type) {
    case 'paragraph':
      body = renderInline(textContent(block), block, sectionId, losses, citationNumbers)
      break
    case 'heading': {
      const props = block.props as { level: number }
      body = `${'#'.repeat(props.level)} ${renderInline(textContent(block), block, sectionId, losses, citationNumbers)}`
      break
    }
    case 'bulletListItem':
      body = `${'  '.repeat(depth)}- ${renderInline(textContent(block), block, sectionId, losses, citationNumbers)}`
      break
    case 'numberedListItem': {
      const props = block.props as { start?: number }
      body = `${'  '.repeat(depth)}${props.start ?? 1}. ${renderInline(textContent(block), block, sectionId, losses, citationNumbers)}`
      break
    }
    case 'checkListItem': {
      const props = block.props as { checked: boolean }
      body = `${'  '.repeat(depth)}- [${props.checked ? 'x' : ' '}] ${renderInline(textContent(block), block, sectionId, losses, citationNumbers)}`
      break
    }
    case 'quote':
      body = renderInline(textContent(block), block, sectionId, losses, citationNumbers)
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
      break
    case 'codeBlock': {
      const originalSource = inlinePlainText(textContent(block))
      const source = replaceReadableCitations(originalSource, citationNumbers)
      if (source !== originalSource) reportCitationLoss(losses, sectionId, block.id)
      const props = block.props as { language: string }
      const fence = longestFence(source)
      body = `${fence}${props.language}\n${source}\n${fence}`
      break
    }
    case 'table':
      body = renderTable(
        block,
        block.content as BlockNoteTableContent,
        sectionId,
        losses,
        citationNumbers
      )
      break
    case 'image': {
      const props = block.props as {
        name: string
        caption: string
        altText?: string
        url: string
      }
      const alt = escapeInline(props.altText || props.name || props.caption || 'Image')
      body = `![${alt}](${assetPath(props.url)})`
      if (props.caption !== '') {
        body += `\n\n_${renderCitationText(props.caption, block, sectionId, losses, citationNumbers)}_`
      }
      break
    }
    case 'mermaid': {
      const props = block.props as { source: string; caption: string }
      body = `\`\`\`mermaid\n${props.source}\n\`\`\``
      if (props.caption !== '') {
        body += `\n\n_${renderCitationText(props.caption, block, sectionId, losses, citationNumbers)}_`
      }
      break
    }
    case 'math': {
      const props = block.props as { source: string; caption: string }
      body = `$$\n${props.source}\n$$`
      if (props.caption !== '') {
        body += `\n\n_${renderCitationText(props.caption, block, sectionId, losses, citationNumbers)}_`
      }
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
  losses: ManuscriptMarkdownLoss[],
  citationNumbers: ReadonlyMap<string, number>
): string {
  const numbered = numberInlineCitations(content, citationNumbers)
  if (numbered.changed) {
    reportCitationLoss(losses, sectionId, block.id)
  }
  return numbered.content
    .map((node) => {
      if (node.type === 'link') {
        return `[${node.content.map((child) => renderStyledText(child, block, sectionId, losses)).join('')}](${node.href})`
      }
      if (node.type === 'math') {
        if (isMarkdownInlineMathSafe(node.content)) return `$${node.content}$`
        addLoss(
          losses,
          'math_text_fallback',
          sectionId,
          block.id,
          'Inline mathematics that could not round-trip through Markdown was emitted as code text.'
        )
        return renderCodeSpan(`$${node.content}$`)
      }
      return renderStyledText(node, block, sectionId, losses)
    })
    .join('')
}

function renderCitationText(
  text: string,
  block: Block,
  sectionId: string,
  losses: ManuscriptMarkdownLoss[],
  citationNumbers: ReadonlyMap<string, number>
): string {
  const citations = findReadableCitations(text)
  if (citations.length === 0) return escapeInline(text)
  let result = ''
  let cursor = 0
  for (const citation of citations) {
    result += text.slice(cursor, citation.from)
    const number = citationNumbers.get(normalizeCitationTitle(citation.title))
    result += number === undefined ? citation.raw : `\uE000citation:${number}\uE001`
    cursor = citation.to
  }
  reportCitationLoss(losses, sectionId, block.id)
  return escapeInline(result + text.slice(cursor)).replace(CITATION_MARKER_PATTERN, '[$1]')
}

function reportCitationLoss(
  losses: ManuscriptMarkdownLoss[],
  sectionId: string,
  blockId: string
): void {
  addLoss(
    losses,
    'citation_numbering',
    sectionId,
    blockId,
    'Readable citation labels are exported as manuscript-wide numeric markers.'
  )
}

function numberInlineCitations(
  content: readonly BlockNoteInlineContent[],
  citationNumbers: ReadonlyMap<string, number>
): { content: BlockNoteInlineContent[]; changed: boolean } {
  const plain = inlinePlainText(content)
  const citations = findReadableCitations(plain)
  if (citations.length === 0) return { content: [...content], changed: false }

  let offset = 0
  const transformText = (node: TextNode): TextNode | null => {
    const start = offset
    const end = start + node.text.length
    offset = end
    let cursor = 0
    let text = ''
    for (const citation of citations) {
      if (citation.to <= start || citation.from >= end) continue
      const localFrom = Math.max(0, citation.from - start)
      const localTo = Math.min(node.text.length, citation.to - start)
      text += node.text.slice(cursor, localFrom)
      if (citation.from >= start && citation.from < end) {
        const number = citationNumbers.get(normalizeCitationTitle(citation.title))
        text += number === undefined ? citation.raw : `\uE000citation:${number}\uE001`
      }
      cursor = Math.max(cursor, localTo)
    }
    text += node.text.slice(cursor)
    return text === '' ? null : { ...node, text }
  }

  const transformed: BlockNoteInlineContent[] = []
  for (const node of content) {
    if (node.type === 'text') {
      const next = transformText(node)
      if (next !== null) transformed.push(next)
      continue
    }
    if (node.type === 'math') {
      offset += 1
      transformed.push(node)
      continue
    }
    const children = node.content
      .map(transformText)
      .filter((child): child is TextNode => child !== null)
    if (children.length > 0) transformed.push({ ...node, content: children })
  }
  return { content: transformed, changed: true }
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
  let value = escapeInline(node.text).replace(CITATION_MARKER_PATTERN, '[$1]')
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
  losses: ManuscriptMarkdownLoss[],
  citationNumbers: ReadonlyMap<string, number>
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
    return renderInline(value, block, sectionId, losses, citationNumbers)
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
      node.type === 'link'
        ? node.content.map((child) => child.text).join('')
        : node.type === 'math'
          ? '\uFFFC'
          : node.text
    )
    .join('')
}

function isMarkdownInlineMathSafe(source: string): boolean {
  if (source.length === 0 || /[\r\n\0]/u.test(source)) return false
  return !/(^|[^\\])(?:\\\\)*\$/u.test(source)
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
