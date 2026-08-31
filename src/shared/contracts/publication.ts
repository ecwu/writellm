import { z } from 'zod'
import {
  figureIdSchema,
  manuscriptAssetIdSchema,
  manuscriptIdSchema,
  sectionIdSchema,
  sectionRevisionIdSchema,
  type BlockNoteDocument,
  type BlockNoteInlineContent,
  type BlockNoteTableContent,
  type ManuscriptAssembly,
  type ManuscriptReferenceIndex,
  plainTextContentSchema,
  plainTextContentToString
} from './manuscript'
import { findReadableCitations, normalizeCitationTitle } from '../readable-citation'
import { findCitationClusters } from '../citation-cluster'
import { referenceItemSchema, type formattedReferenceSnapshotSchema } from './references'
import { projectSessionIdSchema } from './projects'

const MAX_PUBLICATION_NODES = 20_000
const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()

export const publicationTargetSchema = strictObject({
  sectionId: sectionIdSchema,
  revisionId: sectionRevisionIdSchema,
  blockId: z.string().min(1).max(256).nullable()
})

const publicationTextStyleSchema = strictObject({
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
  underline: z.boolean().default(false),
  strike: z.boolean().default(false),
  code: z.boolean().default(false)
})

export const publicationInlineNodeSchema = z.discriminatedUnion('type', [
  strictObject({
    type: z.literal('text'),
    text: z.string().max(100_000),
    style: publicationTextStyleSchema
  }),
  strictObject({
    type: z.literal('link'),
    href: z.string().url().max(8_192),
    children: z.array(
      strictObject({
        type: z.literal('text'),
        text: z.string().max(100_000),
        style: publicationTextStyleSchema
      })
    )
  }),
  strictObject({
    type: z.literal('citation'),
    number: z.number().int().positive().max(50_000),
    title: z.string().min(1).max(512),
    citationKeys: z
      .array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/u))
      .max(100)
      .optional(),
    pageIndex: z.number().int().nonnegative().optional(),
    pageEndIndex: z.number().int().nonnegative().optional(),
    formatted: z.string().max(64_000).optional(),
    raw: z.string().min(1).max(1_024)
  }),
  strictObject({
    type: z.literal('math'),
    source: z.string().max(8_192)
  })
])

const inlineArraySchema = z.array(publicationInlineNodeSchema).max(10_000)
const targetShape = { target: publicationTargetSchema }

export const publicationFigureNodeSchema = strictObject({
  type: z.literal('figure'),
  figureId: figureIdSchema,
  figureNumber: z.number().int().positive(),
  label: z.string().min(1).max(100),
  ...targetShape,
  assetId: manuscriptAssetIdSchema,
  caption: z.string().max(2_000),
  altText: z.string().max(2_000),
  width: z.number().int().positive().max(8_192).nullable(),
  height: z.number().int().positive().max(8_192).nullable()
})

export const publicationTableCellSchema = strictObject({
  content: inlineArraySchema,
  textAlignment: z.enum(['left', 'center', 'right', 'justify']).default('left'),
  colspan: z.number().int().positive().max(1_000),
  rowspan: z.number().int().positive().max(1_000)
})

export const publicationNodeSchema = z.discriminatedUnion('type', [
  strictObject({
    type: z.literal('heading'),
    level: z.number().int().min(1).max(9),
    content: inlineArraySchema,
    ...targetShape
  }),
  strictObject({ type: z.literal('paragraph'), content: inlineArraySchema, ...targetShape }),
  strictObject({
    type: z.literal('list_item'),
    kind: z.enum(['bullet', 'numbered', 'check']),
    depth: z.number().int().nonnegative().max(16),
    checked: z.boolean().nullable(),
    ordinal: z.number().int().positive().nullable(),
    content: inlineArraySchema,
    ...targetShape
  }),
  strictObject({ type: z.literal('quote'), content: inlineArraySchema, ...targetShape }),
  strictObject({
    type: z.literal('code'),
    language: z.string().max(200),
    content: z.string().max(100_000),
    ...targetShape
  }),
  strictObject({
    type: z.literal('table'),
    headerRows: z.number().int().nonnegative().max(1_000),
    headerCols: z.number().int().nonnegative().max(1_000).default(0),
    columnWidths: z.array(z.number().positive().max(100_000).nullable()).max(1_000),
    rows: z.array(z.array(publicationTableCellSchema).max(1_000)).max(1_000),
    ...targetShape
  }),
  publicationFigureNodeSchema,
  strictObject({
    type: z.literal('math'),
    source: z.string().max(32_000),
    ...targetShape
  }),
  strictObject({
    type: z.literal('diagram'),
    engine: z.literal('mermaid'),
    source: z.string().max(64_000),
    caption: z.string().max(2_000),
    altText: z.string().max(2_000),
    ...targetShape
  }),
  strictObject({
    type: z.literal('references'),
    entries: z
      .array(
        strictObject({
          number: z.number().int().positive().max(50_000),
          title: z.string().min(1).max(512),
          citationKey: z
            .string()
            .regex(/^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/u)
            .optional(),
          formatted: z.string().max(256_000).optional(),
          count: z.number().int().positive().max(50_000)
        })
      )
      .max(50_000)
  })
])

export const publicationAssetSchema = strictObject({
  assetId: manuscriptAssetIdSchema,
  logicalUrl: z.string().startsWith('writellm-asset:'),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  byteSize: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024),
  width: z.number().int().positive().max(8_192).nullable(),
  height: z.number().int().positive().max(8_192).nullable(),
  availability: z.enum(['available', 'missing', 'changed'])
})

export const publicationOptionsSchema = strictObject({
  schemaVersion: z.literal(1).default(1),
  pageSize: z.enum(['A4', 'letter']).default('A4'),
  marginsMm: strictObject({
    top: z.number().min(10).max(50),
    right: z.number().min(10).max(50),
    bottom: z.number().min(10).max(50),
    left: z.number().min(10).max(50)
  }).default({ top: 25, right: 25, bottom: 25, left: 25 }),
  template: z.enum(['academic', 'report', 'minimal']).default('academic'),
  includeTableOfContents: z.boolean().default(true),
  includeReferences: z.boolean().default(true),
  mermaidFallback: z.enum(['source', 'rendered']).default('rendered'),
  bibliographyMode: z.enum(['legacy-numbered', 'formatted']).optional()
})

export const publicationPreflightFindingSchema = strictObject({
  findingId: z.string().regex(/^[a-f0-9]{64}$/u),
  severity: z.enum(['error', 'warning']),
  code: z.enum([
    'missing_asset',
    'changed_asset',
    'invalid_heading_hierarchy',
    'unresolved_citation',
    'missing_figure_caption',
    'missing_figure_alt_text',
    'empty_section',
    'mermaid_requires_rendering',
    'unsupported_block'
  ]),
  message: z.string().min(1).max(1_000),
  target: publicationTargetSchema.nullable()
})

export const publicationAssemblySchema = strictObject({
  schemaVersion: z.literal(2),
  manuscriptId: manuscriptIdSchema,
  outlineVersion: z.number().int().positive(),
  title: z.string().max(500),
  language: z.string().max(100),
  options: publicationOptionsSchema,
  nodes: z.array(publicationNodeSchema).max(MAX_PUBLICATION_NODES),
  assets: z.array(publicationAssetSchema).max(10_000),
  referenceMetadata: z.array(referenceItemSchema).max(10_000).optional(),
  referenceCount: z.number().int().nonnegative().max(50_000),
  figureCount: z.number().int().nonnegative().max(10_000),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
  findings: z.array(publicationPreflightFindingSchema).max(20_000),
  ready: z.boolean()
})

export const publicationPreviewSchema = strictObject({
  manuscriptId: manuscriptIdSchema,
  outlineVersion: z.number().int().positive(),
  title: z.string().max(500),
  options: publicationOptionsSchema,
  nodeCount: z.number().int().nonnegative(),
  figureCount: z.number().int().nonnegative(),
  referenceCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  ready: z.boolean(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
  findings: z.array(publicationPreflightFindingSchema).max(2_000)
})

export const publicationPreviewInputSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  options: publicationOptionsSchema.partial().optional()
})

export type PublicationFigureNode = z.infer<typeof publicationFigureNodeSchema>
export type PublicationInlineNode = z.infer<typeof publicationInlineNodeSchema>
export type PublicationNode = z.infer<typeof publicationNodeSchema>
export type PublicationAsset = z.infer<typeof publicationAssetSchema>
export type PublicationOptions = z.infer<typeof publicationOptionsSchema>
export type PublicationAssembly = z.infer<typeof publicationAssemblySchema>
export type PublicationPreview = z.infer<typeof publicationPreviewSchema>

export function buildPublicationAssembly(input: {
  manuscript: ManuscriptAssembly
  references: ManuscriptReferenceIndex
  assets: readonly PublicationAsset[]
  availableReferenceTitles?: ReadonlySet<string>
  referenceItems?: readonly z.infer<typeof referenceItemSchema>[]
  formattedReferences?: z.infer<typeof formattedReferenceSnapshotSchema>
  options?: Partial<PublicationOptions>
  hash(value: string): string
}): PublicationAssembly {
  if (input.references.outlineVersion !== input.manuscript.outlineVersion) {
    throw new Error('Publication references do not match the captured manuscript')
  }
  const options = publicationOptionsSchema.parse(input.options ?? {})
  const assets = input.assets.map((asset) => publicationAssetSchema.parse(asset))
  const assetById = new Map(assets.map((asset) => [asset.assetId, asset]))
  const referenceNumbers = new Map(
    input.references.entries.map((entry) => [normalizeCitationTitle(entry.title), entry.number])
  )
  for (const entry of input.references.entries) {
    if (entry.citationKey !== undefined) referenceNumbers.set(entry.citationKey, entry.number)
  }
  const referenceByKey = new Map(
    (input.referenceItems ?? []).map((reference) => [reference.citationKey, reference])
  )
  const formattedByRaw = new Map(
    (input.formattedReferences?.citations ?? []).map((citation) => [
      citation.raw,
      citation.formatted
    ])
  )
  const bibliographyByKey = new Map(
    (input.formattedReferences?.bibliography ?? []).map((entry) => [
      entry.citationKey,
      entry.formatted
    ])
  )
  const findings: z.infer<typeof publicationPreflightFindingSchema>[] = []
  const nodes: PublicationNode[] = []
  let figureNumber = 0
  const recordFinding = (
    severity: 'error' | 'warning',
    code: z.infer<typeof publicationPreflightFindingSchema>['code'],
    message: string,
    target: z.infer<typeof publicationTargetSchema> | null
  ): void => {
    findings.push({
      findingId: input.hash(
        `${code}:${target?.sectionId ?? ''}:${target?.blockId ?? ''}:${message}`
      ),
      severity,
      code,
      message,
      target
    })
  }
  for (const entry of input.manuscript.sections) {
    const sectionTarget = {
      sectionId: entry.section.sectionId,
      revisionId: entry.revision.sectionRevisionId,
      blockId: null
    }
    if (entry.section.level > 9) {
      recordFinding(
        'error',
        'invalid_heading_hierarchy',
        `Section “${entry.section.title}” exceeds the supported heading depth.`,
        sectionTarget
      )
    }
    nodes.push({
      type: 'heading',
      level: Math.min(entry.section.level, 9),
      content: [plainText(entry.section.title)],
      target: sectionTarget
    })
    if (entry.revision.content.length === 0) {
      recordFinding(
        'warning',
        'empty_section',
        `Section “${entry.section.title}” is empty.`,
        sectionTarget
      )
    }
    const visit = (blocks: BlockNoteDocument, depth: number): void => {
      for (const block of blocks) {
        if (nodes.length >= MAX_PUBLICATION_NODES) throw new Error('Publication has too many nodes')
        const target = { ...sectionTarget, blockId: block.id }
        const inline = (content: BlockNoteInlineContent[]) =>
          convertInline(
            content,
            referenceNumbers,
            target,
            input.availableReferenceTitles,
            referenceByKey,
            formattedByRaw,
            options.bibliographyMode ?? 'legacy-numbered',
            recordFinding
          )
        switch (block.type) {
          case 'paragraph':
            nodes.push({ type: 'paragraph', content: inline(inlineContent(block)), target })
            break
          case 'heading': {
            const level = entry.section.level + Number(block.props.level)
            if (level > 9) {
              recordFinding(
                'error',
                'invalid_heading_hierarchy',
                'A content heading is too deeply nested.',
                target
              )
            }
            nodes.push({
              type: 'heading',
              level: Math.min(level, 9),
              content: inline(inlineContent(block)),
              target
            })
            break
          }
          case 'bulletListItem':
          case 'numberedListItem':
          case 'checkListItem':
            nodes.push({
              type: 'list_item',
              kind:
                block.type === 'bulletListItem'
                  ? 'bullet'
                  : block.type === 'numberedListItem'
                    ? 'numbered'
                    : 'check',
              depth,
              checked: block.type === 'checkListItem' ? Boolean(block.props.checked) : null,
              ordinal:
                block.type === 'numberedListItem' && typeof block.props.start === 'number'
                  ? block.props.start
                  : null,
              content: inline(inlineContent(block)),
              target
            })
            break
          case 'quote':
            nodes.push({ type: 'quote', content: inline(inlineContent(block)), target })
            break
          case 'codeBlock':
            nodes.push({
              type: 'code',
              language: String(block.props.language ?? ''),
              content: inlineContent(block).map(inlineText).join(''),
              target
            })
            break
          case 'table': {
            const table = block.content as BlockNoteTableContent
            nodes.push({
              type: 'table',
              headerRows: table.headerRows ?? 0,
              headerCols: table.headerCols ?? 0,
              columnWidths: table.columnWidths,
              rows: table.rows.map((row) =>
                row.cells.map((cell) => {
                  const value = Array.isArray(cell) ? null : cell
                  return {
                    content: inline(
                      (Array.isArray(cell) ? cell : cell.content) as BlockNoteInlineContent[]
                    ),
                    textAlignment: value?.props.textAlignment ?? 'left',
                    colspan: value?.props.colspan ?? 1,
                    rowspan: value?.props.rowspan ?? 1
                  }
                })
              ),
              target
            })
            break
          }
          case 'image': {
            figureNumber += 1
            const assetId = String(block.props.url).slice('writellm-asset:'.length)
            const asset = assetById.get(assetId)
            if (asset === undefined || asset.availability === 'missing') {
              recordFinding('error', 'missing_asset', 'A figure asset is missing.', target)
            } else if (asset.availability === 'changed') {
              recordFinding(
                'error',
                'changed_asset',
                'A figure asset failed integrity verification.',
                target
              )
            }
            const caption =
              typeof block.props.caption === 'string' ? block.props.caption.trim() : ''
            const altText =
              typeof block.props.altText === 'string' ? block.props.altText.trim() : ''
            if (caption === '')
              recordFinding('warning', 'missing_figure_caption', 'A figure has no caption.', target)
            if (altText === '')
              recordFinding(
                'warning',
                'missing_figure_alt_text',
                'A figure has no alternative text.',
                target
              )
            nodes.push(
              publicationFigureNodeSchema.parse({
                type: 'figure',
                figureId: block.props.figureId,
                figureNumber,
                label: `Figure ${figureNumber}`,
                target,
                assetId,
                caption,
                altText,
                width: asset?.width ?? null,
                height: asset?.height ?? null
              })
            )
            break
          }
          case 'mathBlock':
            nodes.push({
              type: 'math',
              source: plainTextContentToString(plainTextContentSchema.parse(block.content)),
              target
            })
            break
          case 'diagram':
            nodes.push({
              type: 'diagram',
              engine: 'mermaid',
              source: plainTextContentToString(plainTextContentSchema.parse(block.content)),
              caption: String(block.props.caption ?? ''),
              altText: String(block.props.altText ?? ''),
              target
            })
            recordFinding(
              'warning',
              'mermaid_requires_rendering',
              'Mermaid requires a format-specific rendered-image or source fallback.',
              target
            )
            break
          default:
            recordFinding('error', 'unsupported_block', 'A block cannot be published.', target)
        }
        if (block.children.length > 0) visit(block.children, depth + 1)
      }
    }
    visit(entry.revision.content, 0)
  }
  if (options.includeReferences && input.references.entries.length > 0) {
    nodes.push({
      type: 'references',
      entries: input.references.entries.map(({ number, title, citationKey, count }) => ({
        number,
        title,
        ...(citationKey === undefined ? {} : { citationKey }),
        ...(citationKey === undefined || options.bibliographyMode !== 'formatted'
          ? {}
          : { formatted: bibliographyByKey.get(citationKey) }),
        count
      }))
    })
  }
  const sourceHash = input.hash(
    canonicalJson({
      manuscriptId: input.manuscript.manuscriptId,
      outlineVersion: input.manuscript.outlineVersion,
      briefVersion: input.manuscript.brief.version,
      revisions: input.manuscript.sections.map((entry) => ({
        id: entry.revision.sectionRevisionId,
        hash: entry.revision.contentHash
      })),
      assets,
      references: input.references.entries,
      options,
      nodes
    })
  )
  return publicationAssemblySchema.parse({
    schemaVersion: 2,
    manuscriptId: input.manuscript.manuscriptId,
    outlineVersion: input.manuscript.outlineVersion,
    title: input.manuscript.brief.title,
    language: input.manuscript.brief.language,
    options,
    nodes,
    assets,
    referenceMetadata: input.referenceItems ?? [],
    referenceCount: input.references.entries.length,
    figureCount: figureNumber,
    sourceHash,
    findings,
    ready: findings.every((finding) => finding.severity !== 'error')
  })
}

export function publicationPreview(assembly: PublicationAssembly): PublicationPreview {
  return publicationPreviewSchema.parse({
    manuscriptId: assembly.manuscriptId,
    outlineVersion: assembly.outlineVersion,
    title: assembly.title,
    options: assembly.options,
    nodeCount: assembly.nodes.length,
    figureCount: assembly.figureCount,
    referenceCount: assembly.referenceCount,
    errorCount: assembly.findings.filter((finding) => finding.severity === 'error').length,
    warningCount: assembly.findings.filter((finding) => finding.severity === 'warning').length,
    ready: assembly.ready,
    sourceHash: assembly.sourceHash,
    findings: assembly.findings.slice(0, 2_000)
  })
}

export function derivePublicationFigures(manuscript: ManuscriptAssembly): PublicationFigureNode[] {
  const figures: PublicationFigureNode[] = []
  const visit = (document: BlockNoteDocument, sectionId: string, revisionId: string): void => {
    for (const block of document) {
      if (block.type === 'image') {
        const number = figures.length + 1
        figures.push(
          publicationFigureNodeSchema.parse({
            type: 'figure',
            figureId: block.props.figureId,
            figureNumber: number,
            label: `Figure ${number}`,
            target: { sectionId, revisionId, blockId: block.id },
            assetId: String(block.props.url).slice('writellm-asset:'.length),
            caption: block.props.caption,
            altText: block.props.altText,
            width: null,
            height: null
          })
        )
      }
      visit(block.children, sectionId, revisionId)
    }
  }
  for (const entry of manuscript.sections) {
    visit(entry.revision.content, entry.section.sectionId, entry.revision.sectionRevisionId)
  }
  return figures
}

function convertInline(
  content: BlockNoteInlineContent[],
  referenceNumbers: ReadonlyMap<string, number>,
  target: z.infer<typeof publicationTargetSchema>,
  availableReferenceTitles: ReadonlySet<string> | undefined,
  referenceByKey: ReadonlyMap<string, z.infer<typeof referenceItemSchema>>,
  formattedByRaw: ReadonlyMap<string, string>,
  bibliographyMode: 'legacy-numbered' | 'formatted',
  finding: (
    severity: 'error' | 'warning',
    code: z.infer<typeof publicationPreflightFindingSchema>['code'],
    message: string,
    target: z.infer<typeof publicationTargetSchema> | null
  ) => void
): z.infer<typeof publicationInlineNodeSchema>[] {
  const result: z.infer<typeof publicationInlineNodeSchema>[] = []
  for (const node of content) {
    if (node.type === 'math') {
      result.push({ type: 'math', source: node.content })
      continue
    }
    if (node.type === 'link') {
      result.push({
        type: 'link',
        href: node.href,
        children: node.content.map((child) => ({
          type: 'text',
          text: child.text,
          style: style(child.styles)
        }))
      })
      continue
    }
    const citations = [
      ...findReadableCitations(node.text).map((citation) => ({
        ...citation,
        citationKeys: [] as string[],
        pageEndIndex: citation.pageIndex
      })),
      ...findCitationClusters(node.text).map((cluster) => ({
        from: cluster.from,
        to: cluster.to,
        raw: cluster.raw,
        syntax: cluster.syntax,
        title:
          referenceByKey.get(cluster.items[0]?.citationKey ?? '')?.title ??
          cluster.items[0]?.citationKey ??
          '',
        citationKeys: cluster.items.map((item) => item.citationKey),
        pageIndex: cluster.items[0]?.locator?.startPageIndex,
        pageEndIndex: cluster.items[0]?.locator?.endPageIndex
      }))
    ].sort((left, right) => left.from - right.from)
    let cursor = 0
    for (const citation of citations) {
      if (citation.from > cursor) {
        result.push({
          type: 'text',
          text: node.text.slice(cursor, citation.from),
          style: style(node.styles)
        })
      }
      const normalized = normalizeCitationTitle(citation.title)
      const number = referenceNumbers.get(citation.citationKeys[0] ?? normalized)
      const missingKey = citation.citationKeys.find((key) => !referenceByKey.has(key))
      if (number === undefined || missingKey !== undefined) {
        finding(
          'error',
          'unresolved_citation',
          `Citation “${missingKey ?? citation.title}” is unresolved.`,
          target
        )
        result.push({ type: 'text', text: citation.raw, style: style(node.styles) })
      } else {
        if (
          citation.citationKeys.length === 0 &&
          availableReferenceTitles !== undefined &&
          !availableReferenceTitles.has(normalized)
        ) {
          finding(
            'error',
            'unresolved_citation',
            `Citation “${citation.title}” has no available reference source.`,
            target
          )
        }
        result.push({
          type: 'citation',
          number,
          title: citation.title,
          citationKeys: citation.citationKeys,
          ...(citation.pageIndex === undefined ? {} : { pageIndex: citation.pageIndex }),
          ...(citation.pageEndIndex === undefined ? {} : { pageEndIndex: citation.pageEndIndex }),
          ...(bibliographyMode !== 'formatted' || formattedByRaw.get(citation.raw) === undefined
            ? {}
            : { formatted: formattedByRaw.get(citation.raw) }),
          raw: citation.raw
        })
      }
      cursor = citation.to
    }
    if (cursor < node.text.length || citations.length === 0) {
      result.push({ type: 'text', text: node.text.slice(cursor), style: style(node.styles) })
    }
  }
  return result
}

function inlineText(node: BlockNoteInlineContent): string {
  return node.type === 'link'
    ? node.content.map((child) => child.text).join('')
    : node.type === 'math'
      ? `$${node.content}$`
      : node.text
}

function inlineContent(block: BlockNoteDocument[number]): BlockNoteInlineContent[] {
  return Array.isArray(block.content) ? (block.content as BlockNoteInlineContent[]) : []
}

function style(styles: Record<string, unknown>): z.infer<typeof publicationTextStyleSchema> {
  return {
    bold: styles['bold'] === true,
    italic: styles['italic'] === true,
    underline: styles['underline'] === true,
    strike: styles['strike'] === true,
    code: styles['code'] === true
  }
}

function plainText(text: string): z.infer<typeof publicationInlineNodeSchema> {
  return { type: 'text', text, style: style({}) }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`
    )
    .join(',')}}`
}
