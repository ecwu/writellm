import { defaultSchema } from 'rehype-sanitize'

export const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ['className', /^language-./, 'math-inline', 'math-display']
    ]
  }
}

type MarkdownHastNode = {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: MarkdownHastNode[]
}

export function rehypeRenderHtmlMath() {
  return (tree: MarkdownHastNode): void => {
    renderMathInTextNodes(tree)
  }
}

function renderMathInTextNodes(node: MarkdownHastNode): void {
  if (node.type !== 'root' && node.type !== 'element') return
  if (node.tagName !== undefined && ['code', 'pre', 'script', 'style'].includes(node.tagName)) {
    return
  }
  if (node.children === undefined) return

  const nextChildren: MarkdownHastNode[] = []
  for (const child of node.children) {
    if (child.type === 'text' && child.value !== undefined) {
      nextChildren.push(...renderMathText(child.value))
      continue
    }
    renderMathInTextNodes(child)
    nextChildren.push(child)
  }
  node.children = nextChildren
}

function renderMathText(value: string): MarkdownHastNode[] {
  const pattern = /(?<!\\)(\$\$([\s\S]+?)\$\$|\$([^\n$]+?)\$)/g
  const nodes: MarkdownHastNode[] = []
  let lastIndex = 0
  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0
    if (start > lastIndex) nodes.push({ type: 'text', value: value.slice(lastIndex, start) })
    nodes.push({
      type: 'element',
      tagName: 'code',
      properties: {
        className: [match[2] !== undefined ? 'math-display' : 'math-inline']
      },
      children: [{ type: 'text', value: (match[2] ?? match[3] ?? '').trim() }]
    })
    lastIndex = start + match[0].length
  }
  if (lastIndex === 0) return [{ type: 'text', value }]
  if (lastIndex < value.length) nodes.push({ type: 'text', value: value.slice(lastIndex) })
  return nodes
}
