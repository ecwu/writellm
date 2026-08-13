import { randomUUID } from 'node:crypto'
import { basename, extname } from 'node:path'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import {
  blockNoteDocumentSchema,
  type BlockNoteBlockValue,
  type BlockNoteDocument,
  type BlockNoteInlineContent
} from '../../shared/contracts/manuscript'
import type { ManuscriptAssetResult } from '../../shared/contracts/manuscript'

const MAX_MDAST_NODES = 50_000
const MAX_MDAST_DEPTH = 64

interface MdNode {
  type: string
  value?: string
  url?: string
  alt?: string
  title?: string
  depth?: number
  lang?: string | null
  ordered?: boolean
  start?: number | null
  checked?: boolean | null
  align?: Array<'left' | 'right' | 'center' | null>
  children?: MdNode[]
  position?: { start?: { line?: number; column?: number } }
}

export interface MarkdownImportFinding {
  code: string
  message: string
  sourceLocation: string | null
}

export interface MarkdownImportAsset {
  result: ManuscriptAssetResult
  displayName: string
  sha256: string
}

export interface MarkdownImportAdapterResult {
  proposedTitle: string | null
  sections: Array<{
    proposedSectionId: string
    title: string
    outlineLevel: 1
    document: BlockNoteDocument
  }>
  assets: MarkdownImportAsset[]
  warnings: MarkdownImportFinding[]
  unsupported: MarkdownImportFinding[]
  losses: MarkdownImportFinding[]
}

export interface MarkdownImportResource {
  result: ManuscriptAssetResult
  displayName: string
  sha256: string
}

export async function parseMarkdownImport(input: {
  bytes: Buffer
  displayName: string
  createId?: () => string
  resolveImage(reference: string): Promise<MarkdownImportResource>
  signal?: AbortSignal
}): Promise<MarkdownImportAdapterResult> {
  input.signal?.throwIfAborted()
  const source = input.bytes.toString('utf8')
  if (Buffer.byteLength(source) !== input.bytes.byteLength || source.includes('\uFFFD')) {
    throw new Error('Markdown source must be valid UTF-8')
  }
  // electron-vite externalizes these ESM-only packages into the CJS Main bundle. Unwrap the
  // namespace shape while keeping native ESM and Vitest imports unchanged.
  const root = unified()
    .use(unwrapDefault(remarkParse))
    .use(unwrapDefault(remarkGfm))
    .use(unwrapDefault(remarkMath))
    .parse(source) as MdNode
  assertBoundedTree(root)
  const createId = input.createId ?? randomUUID
  const findings = {
    warnings: [] as MarkdownImportFinding[],
    unsupported: [] as MarkdownImportFinding[],
    losses: [] as MarkdownImportFinding[]
  }
  const assetsById = new Map<string, MarkdownImportAsset>()
  const resourceFor = async (reference: string): Promise<MarkdownImportResource> => {
    input.signal?.throwIfAborted()
    const resource = await input.resolveImage(reference)
    assetsById.set(resource.result.assetId, resource)
    return resource
  }
  const rootChildren = root.children ?? []
  const groups: Array<{ title: string; nodes: MdNode[] }> = []
  let current: { title: string; nodes: MdNode[] } | undefined
  const fallbackTitle = sourceTitle(input.displayName)
  for (const node of rootChildren) {
    if (node.type === 'heading' && node.depth === 1) {
      current = { title: plainText(node).trim().slice(0, 500) || 'Untitled section', nodes: [] }
      groups.push(current)
      continue
    }
    if (current === undefined) {
      current = { title: groups.length === 0 ? 'Imported preface' : fallbackTitle, nodes: [] }
      groups.push(current)
    }
    current.nodes.push(node)
  }
  if (groups.length === 1 && groups[0]?.title === 'Imported preface')
    groups[0].title = fallbackTitle

  const sections: MarkdownImportAdapterResult['sections'] = []
  for (const group of groups) {
    input.signal?.throwIfAborted()
    const document: BlockNoteBlockValue[] = []
    for (const node of group.nodes) {
      document.push(
        ...(await mapNode(node, {
          createId,
          resourceFor,
          ...findings
        }))
      )
    }
    sections.push({
      proposedSectionId: createId(),
      title: group.title,
      outlineLevel: 1,
      document: blockNoteDocumentSchema.parse(document)
    })
  }
  const firstHeading = rootChildren.find(
    (node) => node.type === 'heading' && (node.depth === 1 || node.depth === 2)
  )
  return {
    proposedTitle: firstHeading === undefined ? null : plainText(firstHeading).trim().slice(0, 500),
    sections,
    assets: [...assetsById.values()],
    ...findings
  }
}

interface MappingContext {
  createId(): string
  resourceFor(reference: string): Promise<MarkdownImportResource>
  warnings: MarkdownImportFinding[]
  unsupported: MarkdownImportFinding[]
  losses: MarkdownImportFinding[]
}

async function mapNode(node: MdNode, context: MappingContext): Promise<BlockNoteBlockValue[]> {
  switch (node.type) {
    case 'paragraph':
      return mapParagraph(node, context)
    case 'heading':
      return [
        textBlock('heading', inline(node.children ?? [], {}, context), context, {
          level: Math.min(6, Math.max(1, node.depth ?? 2)),
          isToggleable: false
        })
      ]
    case 'blockquote': {
      const content = inlineFromDescendants(node, context)
      return [
        {
          id: context.createId(),
          type: 'quote',
          props: { backgroundColor: 'default', textColor: 'default' },
          content,
          children: []
        }
      ]
    }
    case 'list':
      return mapList(node, context)
    case 'code': {
      const language = (node.lang ?? '').toLowerCase().slice(0, 200)
      if (language === 'mermaid') return [mediaBlock('mermaid', node.value ?? '', context)]
      if (language === 'writellm-math' || language === 'math') {
        return [mediaBlock('math', node.value ?? '', context)]
      }
      return [
        {
          id: context.createId(),
          type: 'codeBlock',
          props: { language },
          content: [text(node.value ?? '', { code: true })],
          children: []
        }
      ]
    }
    case 'math':
      return [mediaBlock('math', node.value ?? '', context)]
    case 'table':
      return [tableBlock(node, context)]
    case 'thematicBreak':
      context.losses.push(finding('thematic_break_fallback', 'Thematic break became text', node))
      return [textBlock('paragraph', [text('***')], context)]
    case 'html':
      context.unsupported.push(
        finding('embedded_html_inert', 'Embedded HTML was preserved as inert source', node)
      )
      return [
        {
          id: context.createId(),
          type: 'codeBlock',
          props: { language: 'html' },
          content: [text((node.value ?? '').slice(0, 100_000), { code: true })],
          children: []
        }
      ]
    case 'definition':
    case 'footnoteDefinition':
      context.unsupported.push(
        finding('definition_not_mapped', `${node.type} was not mapped into the manuscript`, node)
      )
      return []
    default: {
      const fallback = plainText(node).trim()
      context.unsupported.push(
        finding(
          'markdown_node_not_mapped',
          `Markdown node '${node.type}' used a text fallback`,
          node
        )
      )
      return fallback === '' ? [] : [textBlock('paragraph', [text(fallback)], context)]
    }
  }
}

async function mapParagraph(node: MdNode, context: MappingContext): Promise<BlockNoteBlockValue[]> {
  const output: BlockNoteBlockValue[] = []
  let pending: MdNode[] = []
  const flush = (): void => {
    const content = inline(pending, {}, context)
    if (content.length > 0) output.push(textBlock('paragraph', content, context))
    pending = []
  }
  for (const child of node.children ?? []) {
    if (child.type !== 'image') {
      pending.push(child)
      continue
    }
    flush()
    const reference = child.url ?? ''
    try {
      const resource = await context.resourceFor(reference)
      output.push({
        id: context.createId(),
        type: 'image',
        props: {
          backgroundColor: 'default',
          textAlignment: 'center',
          name: resource.displayName.slice(0, 500),
          url: resource.result.logicalUrl,
          caption: (child.title ?? '').slice(0, 2_000),
          altText: (child.alt ?? '').slice(0, 2_000),
          showPreview: true
        },
        children: []
      })
    } catch (err) {
      context.losses.push(
        finding(
          'image_not_imported',
          `Image '${reference.slice(0, 500)}' was omitted: ${safeErrorMessage(err)}`,
          child
        )
      )
      output.push(
        textBlock('paragraph', [text(`[Image omitted: ${child.alt ?? reference}]`)], context)
      )
    }
  }
  flush()
  return output
}

async function mapList(node: MdNode, context: MappingContext): Promise<BlockNoteBlockValue[]> {
  const output: BlockNoteBlockValue[] = []
  let ordinal = node.start ?? 1
  for (const item of node.children ?? []) {
    const itemChildren = item.children ?? []
    const firstParagraph = itemChildren.find((child) => child.type === 'paragraph')
    const nested: BlockNoteBlockValue[] = []
    for (const child of itemChildren) {
      if (child === firstParagraph) continue
      nested.push(...(await mapNode(child, context)))
    }
    const type =
      typeof item.checked === 'boolean'
        ? 'checkListItem'
        : node.ordered
          ? 'numberedListItem'
          : 'bulletListItem'
    output.push({
      id: context.createId(),
      type,
      props: {
        ...textProps(),
        ...(type === 'checkListItem' ? { checked: item.checked ?? false } : {}),
        ...(type === 'numberedListItem' ? { start: ordinal++ } : {})
      },
      content: inline(firstParagraph?.children ?? [], {}, context),
      children: nested
    })
  }
  return output
}

function tableBlock(node: MdNode, context: MappingContext): BlockNoteBlockValue {
  const rows = (node.children ?? []).map((row) => ({
    cells: (row.children ?? []).map((cell) => inline(cell.children ?? [], {}, context))
  }))
  return {
    id: context.createId(),
    type: 'table',
    props: { textColor: 'default' },
    content: {
      type: 'tableContent',
      columnWidths: Array.from({ length: rows[0]?.cells.length ?? 0 }, () => null),
      headerRows: rows.length > 0 ? 1 : 0,
      headerCols: 0,
      rows
    },
    children: []
  }
}

function inline(
  nodes: MdNode[],
  inherited: Record<string, boolean>,
  context: MappingContext
): BlockNoteInlineContent[] {
  const output: BlockNoteInlineContent[] = []
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        output.push(text(node.value ?? '', inherited))
        break
      case 'strong':
        output.push(...inline(node.children ?? [], { ...inherited, bold: true }, context))
        break
      case 'emphasis':
        output.push(...inline(node.children ?? [], { ...inherited, italic: true }, context))
        break
      case 'delete':
        output.push(...inline(node.children ?? [], { ...inherited, strike: true }, context))
        break
      case 'inlineCode':
        output.push(text(node.value ?? '', { ...inherited, code: true }))
        break
      case 'inlineMath':
        output.push(text(`$${node.value ?? ''}$`, { ...inherited, code: true }))
        context.losses.push(
          finding('inline_math_text_fallback', 'Inline math remains editable LaTeX text', node)
        )
        break
      case 'break':
        output.push(text('\n', inherited))
        break
      case 'link': {
        const content = inline(node.children ?? [], inherited, context).flatMap((part) =>
          part.type === 'text' ? [part] : part.content
        )
        if (isSafeLink(node.url ?? '')) {
          output.push({ type: 'link', href: node.url as string, content })
        } else {
          output.push(...content)
          context.losses.push(
            finding('unsafe_link_removed', 'Unsafe link target was removed', node)
          )
        }
        break
      }
      case 'image':
        output.push(text(childImageFallback(node), inherited))
        context.losses.push(
          finding('inline_image_text_fallback', 'Nested inline image became descriptive text', node)
        )
        break
      case 'footnoteReference':
        output.push(text(`[^${plainText(node)}]`, inherited))
        context.unsupported.push(
          finding('footnote_reference_not_mapped', 'Footnote reference remains literal text', node)
        )
        break
      default:
        output.push(...inline(node.children ?? [], inherited, context))
    }
  }
  return output.filter((part) => part.type !== 'text' || part.text.length > 0)
}

function inlineFromDescendants(node: MdNode, context: MappingContext): BlockNoteInlineContent[] {
  const paragraphs = (node.children ?? []).flatMap((child) => {
    if (child.type === 'paragraph') return inline(child.children ?? [], {}, context)
    return [text(plainText(child), {})]
  })
  return paragraphs
}

function textBlock(
  type: 'paragraph' | 'heading',
  content: BlockNoteInlineContent[],
  context: MappingContext,
  extra: Record<string, unknown> = {}
): BlockNoteBlockValue {
  return {
    id: context.createId(),
    type,
    props: { ...textProps(), ...extra },
    content,
    children: []
  }
}

function mediaBlock(
  type: 'mermaid' | 'math',
  source: string,
  context: MappingContext
): BlockNoteBlockValue {
  return {
    id: context.createId(),
    type,
    props: {
      textAlignment: 'center',
      source,
      caption: '',
      previewWidth: 720
    },
    children: []
  }
}

function textProps(): Record<string, string> {
  return { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' }
}

function text(value: string, styles: Record<string, boolean> = {}): BlockNoteInlineContent {
  return { type: 'text', text: value, styles }
}

function sourceTitle(displayName: string): string {
  const extension = extname(displayName)
  return (basename(displayName, extension).trim() || 'Imported manuscript').slice(0, 500)
}

function plainText(node: MdNode): string {
  if (typeof node.value === 'string') return node.value
  return (node.children ?? []).map(plainText).join('')
}

function childImageFallback(node: MdNode): string {
  return `[Image: ${(node.alt ?? node.url ?? 'unnamed').slice(0, 500)}]`
}

function finding(code: string, message: string, node: MdNode): MarkdownImportFinding {
  const line = node.position?.start?.line
  const column = node.position?.start?.column
  return {
    code,
    message,
    sourceLocation:
      line === undefined ? null : column === undefined ? `line ${line}` : `line ${line}:${column}`
  }
}

function assertBoundedTree(root: MdNode): void {
  let count = 0
  const visit = (node: MdNode, depth: number): void => {
    count += 1
    if (count > MAX_MDAST_NODES) throw new Error('Markdown source contains too many syntax nodes')
    if (depth > MAX_MDAST_DEPTH) throw new Error('Markdown source nesting is too deep')
    for (const child of node.children ?? []) visit(child, depth + 1)
  }
  visit(root, 1)
}

function isSafeLink(value: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : 'resource could not be resolved'
}

function unwrapDefault<T>(value: T): T {
  return (value as T & { default?: T }).default ?? value
}
