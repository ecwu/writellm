import {
  AlignmentType,
  Bookmark,
  convertMillimetersToTwip,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  ImageRun,
  Math as DocxMath,
  MathFraction,
  MathRadical,
  MathRun,
  MathSubScript,
  MathSuperScript,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
  type FileChild,
  type MathComponent,
  type ParagraphChild
} from 'docx'
import { XMLParser } from 'fast-xml-parser'
import JSZip from 'jszip'
import katex from 'katex'
import type { Logger } from 'pino'
import type {
  PublicationAssembly,
  PublicationInlineNode,
  PublicationNode
} from '../../shared/contracts/publication'
import { isMathSourceStructurallySafe } from '../../shared/math-source-safety'

export interface DocxPublicationLoss {
  code: 'mermaid_source_fallback' | 'math_text_fallback' | 'webp_unsupported'
  sectionId: string
  blockId: string
  message: string
}

export async function renderDocxPublication(input: {
  assembly: PublicationAssembly
  readAsset(assetId: string): Promise<Buffer>
  log?: Pick<Logger, 'info' | 'warn' | 'error'>
}): Promise<{ bytes: Buffer; losses: DocxPublicationLoss[] }> {
  if (!input.assembly.ready) {
    const err = new Error('Publication preflight contains blocking errors')
    input.log?.error(
      {
        event: 'manuscript.publication.docx_render.failed',
        err,
        findingCount: input.assembly.findings.length
      },
      'DOCX publication preflight contains blocking errors'
    )
    throw err
  }
  const startedAt = Date.now()
  input.log?.info(
    {
      event: 'manuscript.publication.docx_render.started',
      nodeCount: input.assembly.nodes.length,
      assetCount: input.assembly.assets.length,
      pageSize: input.assembly.options.pageSize,
      template: input.assembly.options.template,
      includeTableOfContents: input.assembly.options.includeTableOfContents
    },
    'DOCX publication render started'
  )
  try {
    const losses: DocxPublicationLoss[] = []
    const children: FileChild[] = []
    children.push(
      new Paragraph({
        text: input.assembly.title,
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER
      })
    )
    if (input.assembly.options.includeTableOfContents) {
      children.push(
        new Paragraph({ text: 'Table of Contents', heading: HeadingLevel.HEADING_1 }),
        new TableOfContents('Table of Contents', {
          hyperlink: true,
          headingStyleRange: '1-6'
        })
      )
    }
    for (const node of input.assembly.nodes) {
      children.push(...(await convertNode(node, input, losses)))
    }
    const margin = input.assembly.options.marginsMm
    const pageSize =
      input.assembly.options.pageSize === 'A4'
        ? { width: 11_906, height: 16_838 }
        : { width: 12_240, height: 15_840 }
    const document = new Document({
      title: input.assembly.title,
      creator: 'WriteLLM',
      lastModifiedBy: 'WriteLLM',
      description: `WriteLLM publication ${input.assembly.sourceHash}`,
      styles: {
        default: {
          document: {
            run: { font: { ascii: 'Aptos', eastAsia: 'PingFang SC', hAnsi: 'Aptos' }, size: 22 },
            paragraph: { spacing: { after: 120, line: 276 } }
          }
        }
      },
      sections: [
        {
          properties: {
            page: {
              size: pageSize,
              margin: {
                top: convertMillimetersToTwip(margin.top),
                right: convertMillimetersToTwip(margin.right),
                bottom: convertMillimetersToTwip(margin.bottom),
                left: convertMillimetersToTwip(margin.left)
              }
            }
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun('Page '),
                    new TextRun({ children: [PageNumber.CURRENT] }),
                    new TextRun(' of '),
                    new TextRun({ children: [PageNumber.TOTAL_PAGES] })
                  ]
                })
              ]
            })
          },
          children
        }
      ]
    })
    const bytes = await canonicalizeDocx(await Packer.toBuffer(document))
    input.log?.info(
      {
        event: 'manuscript.publication.docx_render.completed',
        byteSize: bytes.byteLength,
        lossCount: losses.length,
        lossesByCode: countLossesByCode(losses),
        durationMs: Date.now() - startedAt
      },
      'DOCX publication render completed'
    )
    return { bytes, losses }
  } catch (err) {
    input.log?.error(
      {
        event: 'manuscript.publication.docx_render.failed',
        err,
        durationMs: Date.now() - startedAt
      },
      'DOCX publication render failed'
    )
    throw err
  }
}

async function convertNode(
  node: PublicationNode,
  input: { assembly: PublicationAssembly; readAsset(assetId: string): Promise<Buffer> },
  losses: DocxPublicationLoss[]
): Promise<FileChild[]> {
  switch (node.type) {
    case 'heading':
      return [
        new Paragraph({
          heading: headingLevel(node.level),
          children: [
            new Bookmark({
              id: bookmarkId(node.target),
              children: inlineChildren(node.content, node.target, losses)
            })
          ]
        })
      ]
    case 'paragraph':
      return [new Paragraph({ children: inlineChildren(node.content, node.target, losses) })]
    case 'list_item':
      return [
        new Paragraph({
          bullet: node.kind === 'bullet' ? { level: node.depth } : undefined,
          indent: { left: convertMillimetersToTwip(6 * Math.min(node.depth, 8)) },
          children: [
            ...(node.kind === 'numbered'
              ? [new TextRun(`${node.ordinal ?? 1}. `)]
              : node.kind === 'check'
                ? [new TextRun(node.checked ? '☑ ' : '☐ ')]
                : []),
            ...inlineChildren(node.content, node.target, losses)
          ]
        })
      ]
    case 'quote':
      return [
        new Paragraph({
          style: 'Intense Quote',
          indent: { left: convertMillimetersToTwip(8) },
          children: inlineChildren(node.content, node.target, losses)
        })
      ]
    case 'code':
      return [new Paragraph({ children: [new TextRun({ text: node.content, font: 'Menlo' })] })]
    case 'table':
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: node.rows.map(
            (row) =>
              new TableRow({
                children: row.map(
                  (cell) =>
                    new TableCell({
                      columnSpan: cell.colspan,
                      rowSpan: cell.rowspan,
                      children: [
                        new Paragraph({
                          children: inlineChildren(cell.content, node.target, losses)
                        })
                      ]
                    })
                )
              })
          )
        })
      ]
    case 'figure': {
      const asset = input.assembly.assets.find((candidate) => candidate.assetId === node.assetId)
      if (asset === undefined) throw new Error('DOCX figure asset is missing from the assembly')
      if (asset.mimeType === 'image/webp') {
        losses.push({
          code: 'webp_unsupported',
          sectionId: node.target.sectionId,
          blockId: node.target.blockId ?? '',
          message: 'The DOCX library cannot embed WebP; this figure was omitted.'
        })
        return [new Paragraph({ text: `[${node.label}: ${node.altText || node.caption}]` })]
      }
      const dimensions = fitImage(node.width ?? 800, node.height ?? 450)
      return [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              type: asset.mimeType === 'image/png' ? 'png' : 'jpg',
              data: await input.readAsset(node.assetId),
              transformation: dimensions,
              altText: {
                name: node.label,
                title: node.caption || node.label,
                description: node.altText || node.caption || node.label
              }
            })
          ]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: `${node.label}. ${node.caption}`, italics: true })]
        })
      ]
    }
    case 'math': {
      const components = mathComponents(node.source, true)
      if (components === null) {
        losses.push({
          code: 'math_text_fallback',
          sectionId: node.target.sectionId,
          blockId: node.target.blockId ?? '',
          message: 'Mathematics outside the bounded MathML mapper was emitted as OMML text.'
        })
      }
      return [
        new Paragraph({
          children: [new DocxMath({ children: components ?? [new MathRun(node.source)] })]
        })
      ]
    }
    case 'diagram':
      losses.push({
        code: 'mermaid_source_fallback',
        sectionId: node.target.sectionId,
        blockId: node.target.blockId ?? '',
        message: 'Mermaid was emitted as source because no rendered snapshot was captured.'
      })
      return [
        ...(node.caption ? [new Paragraph({ text: node.caption, style: 'Caption' })] : []),
        ...(node.altText
          ? [new Paragraph({ text: `Alternative text: ${node.altText}`, style: 'Caption' })]
          : []),
        new Paragraph({ children: [new TextRun({ text: node.source, font: 'Menlo' })] })
      ]
    case 'references':
      return [
        new Paragraph({ text: 'References', heading: HeadingLevel.HEADING_1 }),
        ...node.entries.map(
          (entry) => new Paragraph({ text: entry.formatted ?? `[${entry.number}] ${entry.title}` })
        )
      ]
  }
}

type OrderedXmlNode = Record<string, unknown>

function mathComponents(source: string, displayMode: boolean): MathComponent[] | null {
  if (!isMathSourceStructurallySafe(source)) return null
  const markup = katex.renderToString(source, {
    displayMode,
    output: 'mathml',
    throwOnError: false,
    strict: 'ignore',
    trust: false,
    maxExpand: 1_000,
    maxSize: 50
  })
  if (markup.includes('katex-error')) return null
  const parsed = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    trimValues: false
  }).parse(markup) as OrderedXmlNode[]
  const math = findOrderedElement(parsed, 'math')
  const semantics = math === null ? null : orderedChild(math, 'semantics')
  const content = semantics === null ? math : semantics
  if (content === null) return null
  return convertMathChildren(content)
}

function convertMathChildren(nodes: OrderedXmlNode[]): MathComponent[] | null {
  const result: MathComponent[] = []
  for (const node of nodes) {
    const element = Object.entries(node).find(([name]) => name !== ':@' && name !== '#text')
    if (element === undefined || element[0] === 'annotation') continue
    if (!Array.isArray(element[1])) return null
    const converted = convertMathElement(element[0], element[1] as OrderedXmlNode[])
    if (converted === null) return null
    result.push(...converted)
  }
  return result.length === 0 ? null : result
}

function convertMathElement(name: string, children: OrderedXmlNode[]): MathComponent[] | null {
  if (name === 'mi' || name === 'mn' || name === 'mo' || name === 'mtext') {
    const text = orderedText(children)
    return text === '' ? [] : [new MathRun(text)]
  }
  if (name === 'mrow' || name === 'mstyle' || name === 'mpadded' || name === 'mphantom') {
    return convertMathChildren(children)
  }
  const operands = orderedElements(children)
  if (name === 'mfrac' && operands.length === 2) {
    const [first, second] = operands
    if (first === undefined || second === undefined) return null
    const numerator = convertMathElement(first[0], first[1])
    const denominator = convertMathElement(second[0], second[1])
    return numerator === null || denominator === null
      ? null
      : [new MathFraction({ numerator, denominator })]
  }
  if ((name === 'msup' || name === 'msub') && operands.length === 2) {
    const [first, second] = operands
    if (first === undefined || second === undefined) return null
    const base = convertMathElement(first[0], first[1])
    const script = convertMathElement(second[0], second[1])
    if (base === null || script === null) return null
    return name === 'msup'
      ? [new MathSuperScript({ children: base, superScript: script })]
      : [new MathSubScript({ children: base, subScript: script })]
  }
  if (name === 'msqrt') {
    const radicand = convertMathChildren(children)
    return radicand === null ? null : [new MathRadical({ children: radicand })]
  }
  return null
}

function orderedElements(nodes: OrderedXmlNode[]): Array<[string, OrderedXmlNode[]]> {
  return nodes.flatMap((node) =>
    Object.entries(node)
      .filter(([name, value]) => name !== ':@' && name !== '#text' && Array.isArray(value))
      .map(([name, value]): [string, OrderedXmlNode[]] => [name, value as OrderedXmlNode[]])
  )
}

function orderedText(nodes: OrderedXmlNode[]): string {
  return nodes
    .map((node) => node['#text'])
    .filter((value) => typeof value === 'string' || typeof value === 'number')
    .join('')
}

function orderedChild(nodes: OrderedXmlNode[], name: string): OrderedXmlNode[] | null {
  for (const node of nodes) {
    const value = node[name]
    if (Array.isArray(value)) return value as OrderedXmlNode[]
  }
  return null
}

function findOrderedElement(nodes: OrderedXmlNode[], name: string): OrderedXmlNode[] | null {
  const direct = orderedChild(nodes, name)
  if (direct !== null) return direct
  for (const node of nodes) {
    for (const value of Object.values(node)) {
      if (!Array.isArray(value)) continue
      const nested = findOrderedElement(value as OrderedXmlNode[], name)
      if (nested !== null) return nested
    }
  }
  return null
}

function inlineChildren(
  nodes: PublicationInlineNode[],
  target: { sectionId: string; blockId: string | null },
  losses: DocxPublicationLoss[]
): ParagraphChild[] {
  const result: ParagraphChild[] = []
  for (const node of nodes) {
    if (node.type === 'citation') {
      result.push(new TextRun(node.formatted ?? `[${node.number}]`))
      continue
    }
    if (node.type === 'link') {
      result.push(
        new ExternalHyperlink({
          link: node.href,
          children: node.children.map((child) => textRun(child.text, child.style, true))
        })
      )
      continue
    }
    if (node.type === 'math') {
      const components = mathComponents(node.source, false)
      if (components === null) {
        losses.push({
          code: 'math_text_fallback',
          sectionId: target.sectionId,
          blockId: target.blockId ?? '',
          message: 'Inline mathematics outside the bounded MathML mapper was emitted as OMML text.'
        })
      }
      result.push(new DocxMath({ children: components ?? [new MathRun(node.source)] }))
      continue
    }
    result.push(textRun(node.text, node.style, false))
  }
  return result
}

function textRun(text: string, style: Record<string, boolean>, hyperlink: boolean): TextRun {
  return new TextRun({
    text,
    bold: style['bold'],
    italics: style['italic'],
    underline: style['underline'] ? {} : undefined,
    strike: style['strike'],
    font: style['code'] ? 'Menlo' : undefined,
    style: hyperlink ? 'Hyperlink' : undefined
  })
}

function headingLevel(level: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  return [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6
  ][Math.min(level, 6) - 1] as (typeof HeadingLevel)[keyof typeof HeadingLevel]
}

function bookmarkId(target: { sectionId: string; blockId: string | null }): string {
  return `wllm_${target.sectionId.replace(/[^A-Za-z0-9]/gu, '').slice(-16)}_${(
    target.blockId ?? 'section'
  )
    .replace(/[^A-Za-z0-9]/gu, '')
    .slice(-16)}`
}

function fitImage(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, 600 / width, 420 / height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
}

function countLossesByCode(losses: readonly DocxPublicationLoss[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const loss of losses) counts[loss.code] = (counts[loss.code] ?? 0) + 1
  return counts
}

async function canonicalizeDocx(bytes: Buffer): Promise<Buffer> {
  const source = await JSZip.loadAsync(bytes)
  const canonical = new JSZip()
  const entries = new Map<string, Buffer>()
  for (const name of Object.keys(source.files).sort()) {
    const entry = source.files[name]
    if (entry !== undefined && !entry.dir) entries.set(name, await entry.async('nodebuffer'))
  }
  const relationshipIds = canonicalRelationshipIds(
    entries.get('word/_rels/document.xml.rels')?.toString('utf8') ?? ''
  )
  for (const [name, original] of entries) {
    let data = original
    if (name.endsWith('.xml') || name.endsWith('.rels')) {
      let xml = data.toString('utf8')
      for (const [generated, stable] of relationshipIds) {
        xml = xml.replaceAll(`"${generated}"`, `"${stable}"`)
      }
      if (name === 'word/document.xml') xml = canonicalDrawingIds(xml)
      data = Buffer.from(xml)
    }
    if (name === 'docProps/core.xml') {
      data = Buffer.from(
        data
          .toString('utf8')
          .replace(/<dcterms:(?:created|modified)[^>]*>[^<]*<\/dcterms:(?:created|modified)>/gu, '')
      )
    }
    canonical.file(name, data, { date: new Date('1980-01-01T00:00:00.000Z'), createFolders: false })
  }
  return canonical.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'UNIX'
  })
}

function canonicalRelationshipIds(xml: string): Map<string, string> {
  const relationships = [...xml.matchAll(/<Relationship\b[^>]*\/>/gu)]
    .map((match) => ({
      id: attribute(match[0], 'Id'),
      key: `${attribute(match[0], 'Type')}\u0000${attribute(match[0], 'Target')}\u0000${attribute(
        match[0],
        'TargetMode'
      )}`
    }))
    .filter((entry): entry is { id: string; key: string } => entry.id !== null)
    .sort((left, right) => left.key.localeCompare(right.key, 'en'))
  return new Map(relationships.map((entry, index) => [entry.id, `rIdCanonical${index + 1}`]))
}

function attribute(xml: string, name: string): string | null {
  return new RegExp(`\\b${name}="([^"]*)"`, 'u').exec(xml)?.[1] ?? null
}

function canonicalDrawingIds(xml: string): string {
  let drawing = 0
  return xml.replace(/<wp:docPr\b[^>]*>/gu, (element) => {
    drawing += 1
    return element
      .replace(/\bid="\d+"/u, `id="${drawing}"`)
      .replace(/\bname="[^"]*"/u, `name="WriteLLM Figure ${drawing}"`)
  })
}
