import { posix } from 'node:path'
import { Cite } from '@citation-js/core'
import '@citation-js/plugin-bibtex'
import { parse } from '@unified-latex/unified-latex-util-parse'
import { printRaw } from '@unified-latex/unified-latex-util-print-raw'
import { z } from 'zod'
import {
  MAX_LATEX_IMPORT_NODES,
  MAX_LATEX_INCLUDE_DEPTH,
  latexImportWorkerRequestSchema,
  latexImportWorkerResultSchema,
  type LatexImportNode,
  type LatexImportWorkerRequest,
  type LatexImportWorkerResult
} from '../shared/contracts/latex-import'
import { inlineMathSourceSchema } from '../shared/contracts/manuscript'

interface LatexNode {
  type: string
  content?: string | LatexNode[]
  env?: string | LatexNode
  args?: Array<{ content?: LatexNode[] }>
  position?: { start?: { line?: number; column?: number } }
  sourcePath?: string
}

type Finding = LatexImportWorkerResult['losses'][number]
type Inline = Extract<LatexImportNode, { type: 'paragraph' }>['content'][number]
type TextInline = Extract<Inline, { type: 'text' }>
type CslItem = z.infer<typeof cslItemSchema>
interface MappingState {
  warnings: Finding[]
  unsupported: Finding[]
  losses: Finding[]
  bibliography: Map<string, CslItem | null>
  labels: Map<string, 'unique' | 'duplicate'>
  assetPaths: Set<string>
}

const cslItemSchema = z
  .object({
    id: z.string().min(1).max(500),
    'citation-key': z.string().min(1).max(500).optional(),
    title: z.string().max(2_000).optional(),
    author: z
      .array(
        z
          .object({
            family: z.string().max(500).optional(),
            literal: z.string().max(500).optional()
          })
          .passthrough()
      )
      .max(100)
      .optional(),
    issued: z
      .object({
        'date-parts': z.array(z.array(z.union([z.number(), z.string()])).max(3)).max(1)
      })
      .passthrough()
      .optional()
  })
  .passthrough()

export function parseLatexImport(rawInput: LatexImportWorkerRequest): LatexImportWorkerResult {
  const input = latexImportWorkerRequestSchema.parse(rawInput)
  const state: MappingState = {
    warnings: [] as Finding[],
    unsupported: [] as Finding[],
    losses: [] as Finding[],
    bibliography: bibliographyFor(input),
    labels: new Map(),
    assetPaths: new Set(input.project?.assetPaths ?? [])
  }
  for (const [key, value] of state.bibliography) {
    if (value === null) {
      state.warnings.push({
        code: 'bibliography_key_duplicate',
        message: `Bibliography key '${key}' is duplicated and will not be resolved`,
        sourceLocation: null
      })
    }
  }
  const root = projectRoot(input, state)
  assertBoundedAst(root)
  collectLabels(root, state)
  const top = arrayContent(root)
  const document = top.find(
    (node) => node.type === 'environment' && environmentName(node) === 'document'
  )
  const body = document === undefined ? top : arrayContent(document)
  const proposedTitle = metadataValue(top, 'title')
  const rawGroups = splitSections(body)
  const commandLevels = rawGroups.flatMap((group) =>
    group.commandLevel === null ? [] : [group.commandLevel]
  )
  const minimumLevel = commandLevels.length === 0 ? 1 : Math.min(...commandLevels)
  const sections = rawGroups.map((group) => ({
    title: group.title,
    outlineLevel:
      group.commandLevel === null ? 1 : Math.max(1, group.commandLevel - minimumLevel + 1),
    nodes: mapSequence(group.nodes, state)
  }))
  return latexImportWorkerResultSchema.parse({
    type: 'latex-import-result',
    requestId: input.requestId,
    sourceHash: input.sourceHash,
    proposedTitle,
    sections,
    warnings: state.warnings,
    unsupported: state.unsupported,
    losses: state.losses
  })
}

function projectRoot(input: LatexImportWorkerRequest, state: MappingState): LatexNode {
  if (input.project == null) return parseSource(input.source, 'source.tex')
  const files = new Map(
    input.project.textFiles
      .filter((file) => file.kind === 'tex')
      .map((file) => [file.relativePath, file.source] as const)
  )
  const entry = files.get(input.project.entryRelativePath)
  if (entry === undefined) throw new Error('LaTeX project entry source is missing')
  return expandIncludes(
    parseSource(entry, input.project.entryRelativePath),
    input.project.entryRelativePath,
    files,
    [input.project.entryRelativePath],
    state
  )
}

function parseSource(source: string, sourcePath: string): LatexNode {
  const root = parse(source) as unknown as LatexNode
  const mark = (node: LatexNode): void => {
    node.sourcePath = sourcePath
    for (const child of arrayContent(node)) mark(child)
    for (const argument of node.args ?? []) {
      for (const child of argument.content ?? []) mark(child)
    }
  }
  mark(root)
  return root
}

function expandIncludes(
  root: LatexNode,
  currentPath: string,
  files: ReadonlyMap<string, string>,
  stack: string[],
  state: MappingState
): LatexNode {
  const expandList = (nodes: LatexNode[]): LatexNode[] =>
    nodes.flatMap((node) => {
      if (node.type === 'macro' && ['input', 'include'].includes(macroName(node))) {
        const requested = argumentText(node).trim()
        const resolved = resolveTexReference(currentPath, requested)
        if (resolved === null || !files.has(resolved)) {
          state.unsupported.push(
            finding(
              'include_unresolved',
              `Include '${requested.slice(0, 500)}' was preserved because it is unavailable or unsafe`,
              node
            )
          )
          return [node]
        }
        if (stack.includes(resolved)) {
          state.losses.push(
            finding(
              'include_cycle',
              `Include cycle '${[...stack, resolved].join(' → ')}' was stopped`,
              node
            )
          )
          return [node]
        }
        if (stack.length >= MAX_LATEX_INCLUDE_DEPTH) {
          throw new Error(`LaTeX include depth exceeds ${MAX_LATEX_INCLUDE_DEPTH}`)
        }
        const included = parseSource(files.get(resolved) as string, resolved)
        const expanded = expandIncludes(included, resolved, files, [...stack, resolved], state)
        state.warnings.push(
          finding('include_resolved', `Included contained source '${resolved}'`, node)
        )
        return arrayContent(expanded)
      }
      if (Array.isArray(node.content)) node.content = expandList(node.content)
      for (const argument of node.args ?? []) {
        if (argument.content !== undefined) argument.content = expandList(argument.content)
      }
      return [node]
    })
  root.content = expandList(arrayContent(root))
  return root
}

function resolveTexReference(currentPath: string, requested: string): string | null {
  if (
    requested.length === 0 ||
    requested.length > 1_024 ||
    requested.includes('\\') ||
    requested.includes('\0') ||
    requested.startsWith('/')
  ) {
    return null
  }
  const withExtension = posix.extname(requested) === '' ? `${requested}.tex` : requested
  if (posix.extname(withExtension).toLowerCase() !== '.tex') return null
  const normalized = posix.normalize(posix.join(posix.dirname(currentPath), withExtension))
  if (normalized.startsWith('../') || normalized === '..' || normalized.startsWith('/')) return null
  return normalized
}

function bibliographyFor(input: LatexImportWorkerRequest): Map<string, CslItem | null> {
  const bibliography = new Map<string, CslItem | null>()
  for (const file of input.project?.textFiles ?? []) {
    if (file.kind !== 'bib') continue
    const parsed = z
      .array(cslItemSchema)
      .max(10_000)
      .parse(new Cite(file.source).format('data', { format: 'object' }))
    for (const item of parsed) {
      const key = item['citation-key'] ?? item.id
      bibliography.set(key, bibliography.has(key) ? null : item)
    }
  }
  return bibliography
}

function collectLabels(root: LatexNode, state: MappingState): void {
  const visit = (node: LatexNode): void => {
    if (node.type === 'macro' && macroName(node) === 'label') {
      const label = argumentText(node).trim().slice(0, 500)
      if (label !== '') state.labels.set(label, state.labels.has(label) ? 'duplicate' : 'unique')
    }
    for (const child of arrayContent(node)) visit(child)
    for (const argument of node.args ?? []) {
      for (const child of argument.content ?? []) visit(child)
    }
  }
  visit(root)
  for (const [label, status] of state.labels) {
    if (status === 'duplicate') {
      state.warnings.push({
        code: 'label_duplicate',
        message: `Label '${label}' is duplicated and references remain unresolved`,
        sourceLocation: null
      })
    }
  }
}

function splitSections(nodes: LatexNode[]): Array<{
  title: string
  commandLevel: number | null
  nodes: LatexNode[]
}> {
  const groups: Array<{ title: string; commandLevel: number | null; nodes: LatexNode[] }> = []
  let current: (typeof groups)[number] | undefined
  for (const node of nodes) {
    const level = sectionCommandLevel(node)
    if (level !== null && level <= 3) {
      current = {
        title: argumentText(node).trim().slice(0, 500) || 'Untitled LaTeX section',
        commandLevel: level,
        nodes: []
      }
      groups.push(current)
      continue
    }
    if (current === undefined) {
      current = { title: 'Imported LaTeX preface', commandLevel: null, nodes: [] }
      groups.push(current)
    }
    current.nodes.push(node)
  }
  if (groups.length === 1 && groups[0]?.title === 'Imported LaTeX preface') {
    groups[0].title = 'Imported LaTeX manuscript'
  }
  const preface = groups[0]
  const firstSection = groups[1]
  if (
    preface?.commandLevel === null &&
    firstSection !== undefined &&
    !hasNarrativeNode(preface.nodes)
  ) {
    firstSection.nodes.unshift(...preface.nodes)
    groups.shift()
  }
  return groups.filter((group) => hasSubstantiveNode(group.nodes))
}

function mapSequence(nodes: LatexNode[], state: MappingState): LatexImportNode[] {
  const output: LatexImportNode[] = []
  let paragraph: Inline[] = []
  const flush = (): void => {
    paragraph = trimInline(paragraph)
    if (paragraph.length > 0) output.push({ type: 'paragraph', content: paragraph })
    paragraph = []
  }

  for (const node of nodes) {
    if (node.type === 'parbreak') {
      flush()
      continue
    }
    const sectionLevel = sectionCommandLevel(node)
    if (sectionLevel !== null) {
      flush()
      output.push({
        type: 'heading',
        level: Math.min(6, Math.max(1, sectionLevel - 2)),
        content: [{ type: 'text', text: argumentText(node), styles: {} }]
      })
      continue
    }
    if (node.type === 'displaymath' || node.type === 'mathenv') {
      flush()
      const source = rawContent(node)
      if (source.length > 32_000) throw new Error('Display math exceeds the 32 KiB block limit')
      output.push({ type: 'math', source })
      continue
    }
    if (node.type === 'environment') {
      flush()
      output.push(...mapEnvironment(node, state))
      continue
    }
    if (node.type === 'verb' || node.type === 'verbatim') {
      flush()
      output.push({ type: 'code', language: 'latex', source: rawContent(node) })
      continue
    }
    if (node.type === 'comment') {
      flush()
      output.push(...rawBlocks(node, 'latex-comment'))
      state.losses.push(
        finding('comment_preserved_inert', 'LaTeX comment was preserved as inert source', node)
      )
      continue
    }
    if (isPreambleOnlyMacro(node)) {
      if (macroName(node) === 'usepackage') {
        state.warnings.push(
          finding('package_not_loaded', 'Package declaration was recorded but not executed', node)
        )
      }
      continue
    }
    const mapped = mapInline(node, {}, state)
    if (mapped !== null) {
      paragraph.push(...mapped)
      continue
    }
    flush()
    output.push(...rawBlocks(node, 'latex'))
    state.unsupported.push(
      finding(
        'latex_construct_preserved_inert',
        `Unsupported ${describeNode(node)} was preserved as inert LaTeX source`,
        node
      )
    )
  }
  flush()
  return output
}

function mapEnvironment(node: LatexNode, state: MappingState): LatexImportNode[] {
  const env = environmentName(node)
  if (env === 'figure' || env === 'figure*') return mapFigure(node, state)
  if (['table', 'table*', 'tabular', 'tabularx', 'longtable'].includes(env)) {
    return mapTable(node, state)
  }
  if (env === 'itemize' || env === 'enumerate') {
    const items: Inline[][] = []
    let current: LatexNode[] | null = null
    for (const child of arrayContent(node)) {
      if (child.type === 'macro' && macroName(child) === 'item') {
        if (current !== null) items.push(trimInline(mapInlineSequence(current, state)))
        current = [...argumentNodes(child)]
      } else if (current !== null) current.push(child)
    }
    if (current !== null) items.push(trimInline(mapInlineSequence(current, state)))
    return [{ type: 'list', ordered: env === 'enumerate', items }]
  }
  if (env === 'quote' || env === 'quotation') {
    return [{ type: 'quote', content: trimInline(mapInlineSequence(arrayContent(node), state)) }]
  }
  if (env === 'verbatim' || env === 'lstlisting') {
    return [
      { type: 'code', language: env === 'lstlisting' ? 'latex' : 'text', source: rawContent(node) }
    ]
  }
  const raw = rawBlocks(node, 'latex')
  state.unsupported.push(
    finding(
      'latex_environment_preserved_inert',
      `Environment '${env}' was preserved as inert source`,
      node
    )
  )
  return raw
}

function mapFigure(node: LatexNode, state: MappingState): LatexImportNode[] {
  const graphics = descendants(node).filter(
    (child) => child.type === 'macro' && macroName(child) === 'includegraphics'
  )
  const captionNode = descendants(node).find(
    (child) => child.type === 'macro' && macroName(child) === 'caption'
  )
  const labelNode = descendants(node).find(
    (child) => child.type === 'macro' && macroName(child) === 'label'
  )
  const caption = captionNode === undefined ? '' : argumentText(captionNode).trim().slice(0, 2_000)
  const label =
    labelNode === undefined ? null : argumentText(labelNode).trim().slice(0, 500) || null
  if (graphics.length === 0) {
    state.unsupported.push(
      finding(
        'figure_preserved_inert',
        'Figure without a local image was preserved as source',
        node
      )
    )
    return rawBlocks(node, 'latex')
  }
  return graphics.map((graphic): LatexImportNode => {
    const reference = argumentText(graphic).trim()
    const relativePath = resolveAssetReference(graphic.sourcePath ?? 'source.tex', reference, state)
    if (relativePath === null) {
      state.losses.push(
        finding(
          'figure_image_unresolved',
          `Figure image '${reference.slice(0, 500)}' was not captured from the project`,
          graphic
        )
      )
      return {
        type: 'paragraph',
        content: chunks(`[Image omitted: ${caption || reference}]`, { code: true })
      }
    }
    return {
      type: 'figure',
      relativePath,
      caption,
      altText: (caption || posix.basename(relativePath)).slice(0, 2_000),
      label
    }
  })
}

function mapTable(node: LatexNode, state: MappingState): LatexImportNode[] {
  const env = environmentName(node)
  const tableNode = ['tabular', 'tabularx', 'longtable'].includes(env)
    ? node
    : descendants(node).find(
        (child) =>
          child.type === 'environment' &&
          ['tabular', 'tabularx', 'longtable'].includes(environmentName(child))
      )
  if (tableNode === undefined) {
    state.unsupported.push(
      finding('table_preserved_inert', 'Table without a supported tabular body was preserved', node)
    )
    return rawBlocks(node, 'latex')
  }
  const captionNode = descendants(node).find(
    (child) => child.type === 'macro' && macroName(child) === 'caption'
  )
  const rows: Inline[][][] = []
  let row: LatexNode[][] = [[]]
  let headerRows = 0
  const flushRow = (): void => {
    const mapped = row.map((cell) => trimInline(mapInlineSequence(cell, state)))
    if (mapped.some((cell) => cell.length > 0)) rows.push(mapped)
    row = [[]]
  }
  for (const child of arrayContent(tableNode)) {
    if (child.type === 'macro' && ['\\', 'tabularnewline'].includes(macroName(child))) {
      flushRow()
      continue
    }
    if (child.type === 'macro' && ['midrule', 'endhead'].includes(macroName(child))) {
      flushRow()
      headerRows = rows.length
      continue
    }
    if (
      child.type === 'macro' &&
      ['hline', 'toprule', 'bottomrule', 'cmidrule', 'cline'].includes(macroName(child))
    ) {
      continue
    }
    if (child.type === 'string' && String(child.content ?? '').includes('&')) {
      const parts = String(child.content ?? '').split('&')
      parts.forEach((part, index) => {
        if (part !== '') row.at(-1)?.push({ ...child, content: part })
        if (index < parts.length - 1) row.push([])
      })
      continue
    }
    row.at(-1)?.push(child)
  }
  flushRow()
  if (rows.length === 0 || rows.some((candidate) => candidate.length > 1_000)) {
    state.unsupported.push(
      finding('table_preserved_inert', 'Table shape exceeded the supported mapping', node)
    )
    return rawBlocks(node, 'latex')
  }
  const width = Math.max(...rows.map((candidate) => candidate.length))
  for (const candidate of rows) {
    while (candidate.length < width) candidate.push([])
  }
  return [
    {
      type: 'table',
      caption: captionNode === undefined ? '' : argumentText(captionNode).trim().slice(0, 2_000),
      headerRows,
      rows
    }
  ]
}

function descendants(node: LatexNode): LatexNode[] {
  const output: LatexNode[] = []
  const visit = (candidate: LatexNode): void => {
    for (const child of arrayContent(candidate)) {
      output.push(child)
      visit(child)
    }
    for (const argument of candidate.args ?? []) {
      for (const child of argument.content ?? []) {
        output.push(child)
        visit(child)
      }
    }
  }
  visit(node)
  return output
}

function resolveAssetReference(
  currentPath: string,
  requested: string,
  state: MappingState
): string | null {
  if (
    requested.length === 0 ||
    requested.length > 1_024 ||
    requested.includes('\\') ||
    requested.includes('\0') ||
    requested.startsWith('/')
  ) {
    return null
  }
  const base = posix.normalize(posix.join(posix.dirname(currentPath), requested))
  if (base.startsWith('../') || base === '..' || base.startsWith('/')) return null
  const candidates =
    posix.extname(base) === ''
      ? ['.png', '.jpg', '.jpeg', '.gif', '.webp'].map((extension) => `${base}${extension}`)
      : [base]
  return candidates.find((candidate) => state.assetPaths.has(candidate)) ?? null
}

function readableCitation(item: CslItem): string {
  const authors = (item.author ?? [])
    .map((author) => author.family ?? author.literal)
    .filter((value): value is string => value !== undefined && value.trim() !== '')
  const authorText =
    authors.length === 0
      ? (item.title?.trim().slice(0, 500) ?? item.id)
      : authors.length === 1
        ? (authors[0] as string)
        : authors.length === 2
          ? `${authors[0]} & ${authors[1]}`
          : `${authors[0]} et al.`
  const year = item.issued?.['date-parts'][0]?.[0]
  return `${authorText}, ${year === undefined ? 'n.d.' : String(year).slice(0, 20)}`
}

function mapInlineSequence(nodes: LatexNode[], state: MappingState): Inline[] {
  return nodes.flatMap((node) => mapInline(node, {}, state) ?? literalInline(node))
}

function mapInline(
  node: LatexNode,
  inherited: TextInline['styles'],
  state: MappingState
): Inline[] | null {
  if (node.type === 'string') return chunks(String(node.content ?? ''), inherited)
  if (node.type === 'whitespace') return [{ type: 'text', text: ' ', styles: inherited }]
  if (node.type === 'inlinemath') {
    const source = rawContent(node)
    if (inlineMathSourceSchema.safeParse(source).success) {
      return [{ type: 'math', source }]
    }
    state.losses.push(
      finding(
        'inline_math_size_fallback',
        'Inline math exceeded the bounded single-line formula contract and became literal text',
        node
      )
    )
    return chunks(`$${source.slice(0, 99_998)}$`, { ...inherited, code: true })
  }
  if (node.type === 'verb') return chunks(rawContent(node), { ...inherited, code: true })
  if (node.type !== 'macro') return null
  const name = macroName(node)
  const style =
    name === 'textbf' || name === 'bfseries'
      ? { ...inherited, bold: true }
      : name === 'emph' || name === 'textit' || name === 'itshape'
        ? { ...inherited, italic: true }
        : name === 'underline'
          ? { ...inherited, underline: true }
          : name === 'texttt'
            ? { ...inherited, code: true }
            : null
  if (style !== null) {
    return argumentNodes(node).flatMap(
      (child) => mapInline(child, style, state) ?? literalInline(child)
    )
  }
  if (['cite', 'citep', 'citet', 'autocite', 'parencite', 'textcite'].includes(name)) {
    const literal = safePrint(node)
    const keys = argumentText(node)
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean)
    const entries = keys.map((key) => state.bibliography.get(key))
    if (keys.length > 0 && entries.every((entry) => entry !== undefined && entry !== null)) {
      const citation = `(${entries.map((entry) => readableCitation(entry as CslItem)).join('; ')})`
      state.warnings.push(
        finding(
          'citation_style_normalized',
          `Citation '${literal.slice(0, 500)}' was normalized from captured bibliography data`,
          node
        )
      )
      return chunks(citation, inherited)
    }
    state.unsupported.push(
      finding('citation_unresolved', `Citation '${literal.slice(0, 500)}' is unresolved`, node)
    )
    return chunks(literal, { ...inherited, code: true })
  }
  if (name === 'footnote') {
    state.losses.push(
      finding('footnote_text_fallback', 'Footnote remains visible inline text', node)
    )
    return chunks(`[Footnote: ${argumentText(node)}]`, inherited)
  }
  if (['ref', 'eqref', 'autoref', 'pageref'].includes(name)) {
    const label = argumentText(node).trim()
    if (state.labels.get(label) === 'unique') {
      state.warnings.push(
        finding(
          'cross_reference_normalized',
          `Cross-reference '${safePrint(node).slice(0, 500)}' was normalized to its stable label`,
          node
        )
      )
      return chunks(`[${label}]`, inherited)
    }
    state.unsupported.push(
      finding(
        'cross_reference_unresolved',
        `Cross-reference '${safePrint(node).slice(0, 500)}' is unresolved or ambiguous`,
        node
      )
    )
    return chunks(safePrint(node), { ...inherited, code: true })
  }
  if (name === 'label') return []
  if (name === '\\' || name === 'newline' || name === 'linebreak')
    return [{ type: 'text', text: '\n', styles: inherited }]
  if (name === '%' || name === '#' || name === '&' || name === '_' || name === '$') {
    return [{ type: 'text', text: name, styles: inherited }]
  }
  return null
}

function rawBlocks(node: LatexNode, language: string): LatexImportNode[] {
  const source = safePrint(node)
  const output: LatexImportNode[] = []
  for (let offset = 0; offset < source.length; offset += 100_000) {
    output.push({ type: 'code', language, source: source.slice(offset, offset + 100_000) })
  }
  return output
}

function literalInline(node: LatexNode): Inline[] {
  return chunks(safePrint(node), { code: true })
}

function chunks(value: string, styles: TextInline['styles']): Inline[] {
  const output: Inline[] = []
  for (let offset = 0; offset < value.length; offset += 100_000) {
    output.push({ type: 'text', text: value.slice(offset, offset + 100_000), styles })
  }
  return output
}

function trimInline(content: Inline[]): Inline[] {
  const merged: Inline[] = []
  for (const part of content) {
    const previous = merged.at(-1)
    if (
      part.type === 'text' &&
      previous?.type === 'text' &&
      JSON.stringify(previous.styles) === JSON.stringify(part.styles)
    ) {
      previous.text += part.text
    } else merged.push(structuredClone(part))
  }
  const first = merged[0]
  if (first?.type === 'text') first.text = first.text.trimStart()
  const last = merged.at(-1)
  if (last?.type === 'text') last.text = last.text.trimEnd()
  return merged.flatMap((part) => {
    if (part.type === 'math') return [part]
    return part.text.length === 0 ? [] : chunks(part.text, part.styles)
  })
}

function metadataValue(nodes: LatexNode[], name: string): string | null {
  const macro = nodes.find((node) => node.type === 'macro' && macroName(node) === name)
  if (macro === undefined) return null
  const value = argumentText(macro).trim().slice(0, 500)
  return value === '' ? null : value
}

function sectionCommandLevel(node: LatexNode): number | null {
  if (node.type !== 'macro') return null
  return (
    (
      {
        part: 1,
        chapter: 2,
        section: 3,
        subsection: 4,
        subsubsection: 5,
        paragraph: 6,
        subparagraph: 7
      } as Record<string, number>
    )[macroName(node)] ?? null
  )
}

function argumentNodes(node: LatexNode): LatexNode[] {
  const args = node.args ?? []
  return [...args].reverse().find((argument) => (argument.content?.length ?? 0) > 0)?.content ?? []
}

function argumentText(node: LatexNode): string {
  return argumentNodes(node)
    .map((child) => plainText(child))
    .join('')
}

function plainText(node: LatexNode): string {
  if (node.type === 'string') return String(node.content ?? '')
  if (node.type === 'whitespace') return ' '
  if (node.type === 'macro') {
    const name = macroName(node)
    if (['textbf', 'textit', 'emph', 'underline', 'texttt'].includes(name))
      return argumentText(node)
  }
  return Array.isArray(node.content) ? node.content.map(plainText).join('') : safePrint(node)
}

function rawContent(node: LatexNode): string {
  return Array.isArray(node.content)
    ? node.content.map((child) => safePrint(child)).join('')
    : String(node.content ?? '')
}

function arrayContent(node: LatexNode): LatexNode[] {
  return Array.isArray(node.content) ? node.content : []
}

function macroName(node: LatexNode): string {
  return typeof node.content === 'string' ? node.content : ''
}

function environmentName(node: LatexNode): string {
  if (typeof node.env === 'string') return node.env
  if (node.env !== undefined) return plainText(node.env)
  return ''
}

function safePrint(node: LatexNode): string {
  return printRaw(node as never)
}

function isPreambleOnlyMacro(node: LatexNode): boolean {
  return (
    node.type === 'macro' &&
    ['documentclass', 'usepackage', 'title', 'author', 'date', 'maketitle'].includes(
      macroName(node)
    )
  )
}

function hasSubstantiveNode(nodes: LatexNode[]): boolean {
  return nodes.some(
    (node) =>
      node.type !== 'whitespace' &&
      node.type !== 'parbreak' &&
      !(node.type === 'macro' && macroName(node) === 'maketitle')
  )
}

function hasNarrativeNode(nodes: LatexNode[]): boolean {
  return nodes.some(
    (node) =>
      node.type !== 'whitespace' &&
      node.type !== 'parbreak' &&
      node.type !== 'comment' &&
      !(node.type === 'macro' && macroName(node) === 'maketitle')
  )
}

function finding(code: string, message: string, node: LatexNode): Finding {
  const line = node.position?.start?.line
  const column = node.position?.start?.column
  const location =
    line === undefined ? null : column === undefined ? `line ${line}` : `line ${line}:${column}`
  return {
    code,
    message,
    sourceLocation:
      location === null
        ? (node.sourcePath ?? null)
        : node.sourcePath === undefined
          ? location
          : `${node.sourcePath}:${location}`
  }
}

function describeNode(node: LatexNode): string {
  if (node.type === 'macro') return `macro '\\${macroName(node)}'`
  return `node '${node.type}'`
}

function assertBoundedAst(root: LatexNode): void {
  let count = 0
  const visit = (node: LatexNode, depth: number): void => {
    count += 1
    if (count > MAX_LATEX_IMPORT_NODES)
      throw new Error('LaTeX source contains too many syntax nodes')
    if (depth > 64) throw new Error('LaTeX source nesting is too deep')
    for (const child of arrayContent(node)) visit(child, depth + 1)
    for (const argument of node.args ?? []) {
      for (const child of argument.content ?? []) visit(child, depth + 1)
    }
  }
  visit(root, 1)
}
