import { z } from 'zod'
import { isMathSourceStructurallySafe } from '../math-source-safety'
import { WRITING_RULES_NAMESPACE, writingRulesStateSchema } from './writing-rules'

export const MANUSCRIPT_BRIEF_SCHEMA_VERSION = 1
export const SECTION_CONTENT_SCHEMA_VERSION = 5
export const SECTION_COUNT_ALGORITHM_VERSION = 2
export const sectionCountAlgorithmVersionSchema = z.union([z.literal(1), z.literal(2)])
export const SECTION_MATERIALIZATION_FORMAT_VERSION = 1
export const SECTION_MATERIALIZATION_ENVELOPE_SCHEMA_VERSION = 1
export const MAX_SECTION_DOCUMENT_BYTES = 2 * 1024 * 1024
export const MAX_SECTION_BLOCKS = 10_000
export const MAX_SECTION_INLINE_NODES = 50_000
export const MAX_SECTION_NESTING_DEPTH = 16
export const MAX_INLINE_MATH_SOURCE_BYTES = 8 * 1024
export const MAX_BLOCK_MATH_SOURCE_BYTES = 32 * 1024
export const MAX_DIAGRAM_SOURCE_BYTES = 64 * 1024
export const MAX_MANUSCRIPT_SECTIONS = 1_000
export const MAX_MANUSCRIPT_OUTLINE_DEPTH = 64
export const MAX_MANUSCRIPT_WORKSPACE_BYTES = 8 * 1024 * 1024
export const MAX_BRIEF_EXTENSIBLE_BYTES = 256 * 1024
export const MAX_BRIEF_EXTENSIBLE_DEPTH = 8
export const MAX_BRIEF_EXTENSIBLE_KEYS = 2_000

export const manuscriptIdSchema = z.string().min(1).max(256)
export const manuscriptBriefIdSchema = z.string().min(1).max(256)
export const sectionIdSchema = z.string().min(1).max(256)
export const sectionRevisionIdSchema = z.string().min(1).max(512)
export const sectionStatusSchema = z.enum(['planned', 'drafting', 'completed'])
export const sectionRevisionSourceSchema = z.enum([
  'bootstrap',
  'manual',
  'import',
  'agent',
  'undo'
])
export const sectionRevisionClassSchema = z.enum([
  'manual_autosave',
  'manual_checkpoint',
  'agent_accepted',
  'import'
])

const boundedText = z.string().max(32_000)
const requiredTitle = z.string().trim().min(1).max(500)
export const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/)

const blockIdSchema = z.string().min(1).max(256)
export const manuscriptAssetIdSchema = z.uuid()
export const manuscriptAssetUrlSchema = z
  .string()
  .regex(
    /^writellm-asset:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  )
export const manuscriptAssetMimeTypeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp'])
export const figureIdSchema = z.string().min(1).max(600)
const blockColorSchema = z.string().min(1).max(100)
const textAlignmentSchema = z.enum(['left', 'center', 'right', 'justify'])
export const diagramSourceSchema = z
  .string()
  .max(64_000)
  .refine((value) => !value.includes('\0'), 'Diagram source must not contain NUL')
  .refine(
    (value) => new TextEncoder().encode(value).byteLength <= MAX_DIAGRAM_SOURCE_BYTES,
    'Diagram source exceeds 64 KiB'
  )
export const blockMathSourceSchema = z
  .string()
  .max(32_000)
  .refine((value) => !value.includes('\0'), 'Block LaTeX source must not contain NUL')
  .refine(
    isMathSourceStructurallySafe,
    'Block LaTeX source uses a blocked capability or extreme dimension'
  )
  .refine(
    (value) => new TextEncoder().encode(value).byteLength <= MAX_BLOCK_MATH_SOURCE_BYTES,
    'LaTeX source exceeds 32 KiB'
  )
export const inlineMathSourceSchema = z
  .string()
  .max(8_192)
  .refine((value) => !/[\r\n\0]/u.test(value), 'Inline LaTeX source must be a single line')
  .refine(
    isMathSourceStructurallySafe,
    'Inline LaTeX source uses a blocked capability or extreme dimension'
  )
  .refine(
    (value) => new TextEncoder().encode(value).byteLength <= MAX_INLINE_MATH_SOURCE_BYTES,
    'Inline LaTeX source exceeds 8 KiB'
  )
const textStylesSchema = z
  .object({
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    strike: z.boolean().optional(),
    code: z.boolean().optional(),
    textColor: blockColorSchema.optional(),
    backgroundColor: blockColorSchema.optional()
  })
  .strict()

const styledTextSchema = z
  .object({ type: z.literal('text'), text: z.string().max(100_000), styles: textStylesSchema })
  .strict()

const plainTextNodeSchema = z
  .object({ type: z.literal('text'), text: z.string().max(64_000), styles: z.object({}).strict() })
  .strict()
export const plainTextContentSchema = z.array(plainTextNodeSchema).max(10_000)
export type PlainTextContent = z.infer<typeof plainTextContentSchema>

export function plainTextContentToString(content: PlainTextContent): string {
  return content.map((node) => node.text).join('')
}

export function plainTextContentFromSource(source: string): PlainTextContent {
  return source.length === 0 ? [] : [{ type: 'text', text: source, styles: {} }]
}

const safeLinkSchema = z
  .object({
    type: z.literal('link'),
    href: z
      .string()
      .max(8_192)
      .refine((href) => {
        try {
          return ['http:', 'https:', 'mailto:'].includes(new URL(href).protocol)
        } catch {
          return false
        }
      }, 'Link URL scheme is not allowed'),
    content: z.array(styledTextSchema).max(10_000)
  })
  .strict()

const inlineMathSchema = z
  .object({ type: z.literal('math'), content: inlineMathSourceSchema })
  .strict()

export const blockNoteInlineContentSchema = z.union([
  styledTextSchema,
  safeLinkSchema,
  inlineMathSchema
])
export type BlockNoteInlineContent = z.infer<typeof blockNoteInlineContentSchema>

const commonTextPropsSchema = z
  .object({
    backgroundColor: blockColorSchema,
    textColor: blockColorSchema,
    textAlignment: textAlignmentSchema
  })
  .strict()
const quotePropsSchema = z
  .object({ backgroundColor: blockColorSchema, textColor: blockColorSchema })
  .strict()
const tableCellSchema = z
  .object({
    type: z.literal('tableCell'),
    props: z
      .object({
        backgroundColor: blockColorSchema,
        textColor: blockColorSchema,
        textAlignment: textAlignmentSchema,
        colspan: z.number().int().positive().max(1_000).optional(),
        rowspan: z.number().int().positive().max(1_000).optional()
      })
      .strict(),
    content: z.array(blockNoteInlineContentSchema).max(10_000)
  })
  .strict()
const tableContentSchema = z
  .object({
    type: z.literal('tableContent'),
    columnWidths: z.array(z.number().positive().max(100_000).nullable()).max(1_000),
    headerRows: z.number().int().nonnegative().max(1_000).optional(),
    headerCols: z.number().int().nonnegative().max(1_000).optional(),
    rows: z
      .array(
        z
          .object({
            cells: z
              .array(z.union([z.array(blockNoteInlineContentSchema), tableCellSchema]))
              .max(1_000)
          })
          .strict()
      )
      .max(1_000)
  })
  .strict()
export type BlockNoteTableContent = z.infer<typeof tableContentSchema>

export type BlockNoteBlockValue = {
  id: string
  type:
    | 'paragraph'
    | 'heading'
    | 'bulletListItem'
    | 'numberedListItem'
    | 'checkListItem'
    | 'quote'
    | 'codeBlock'
    | 'table'
    | 'image'
    | 'diagram'
    | 'mathBlock'
  props: Record<string, unknown>
  content?:
    | z.infer<typeof blockNoteInlineContentSchema>[]
    | PlainTextContent
    | z.infer<typeof tableContentSchema>
  children: BlockNoteBlockValue[]
}

const legacyRichMediaPropsSchema = z
  .object({
    textAlignment: textAlignmentSchema,
    source: diagramSourceSchema,
    caption: z.string().max(2_000),
    previewWidth: z.number().int().min(64).max(8_192).optional()
  })
  .strict()
const legacyMathPropsSchema = legacyRichMediaPropsSchema
  .extend({ source: blockMathSourceSchema })
  .strict()

const diagramPropsSchema = z
  .object({
    engine: z.literal('mermaid'),
    caption: z.string().max(2_000),
    altText: z.string().max(2_000)
  })
  .strict()

export const blockNoteBlockSchema: z.ZodType<BlockNoteBlockValue> = z.lazy(() =>
  z.union([
    z
      .object({
        id: blockIdSchema,
        type: z.literal('paragraph'),
        props: commonTextPropsSchema,
        content: z.array(blockNoteInlineContentSchema),
        children: z.array(blockNoteBlockSchema)
      })
      .strict(),
    z
      .object({
        id: blockIdSchema,
        type: z.literal('bulletListItem'),
        props: commonTextPropsSchema,
        content: z.array(blockNoteInlineContentSchema),
        children: z.array(blockNoteBlockSchema)
      })
      .strict(),
    z
      .object({
        id: blockIdSchema,
        type: z.literal('numberedListItem'),
        props: commonTextPropsSchema
          .extend({ start: z.number().int().positive().optional() })
          .strict(),
        content: z.array(blockNoteInlineContentSchema),
        children: z.array(blockNoteBlockSchema)
      })
      .strict(),
    z
      .object({
        id: blockIdSchema,
        type: z.literal('checkListItem'),
        props: commonTextPropsSchema.extend({ checked: z.boolean() }).strict(),
        content: z.array(blockNoteInlineContentSchema),
        children: z.array(blockNoteBlockSchema)
      })
      .strict(),
    z
      .object({
        id: blockIdSchema,
        type: z.literal('heading'),
        props: commonTextPropsSchema
          .extend({
            level: z.number().int().min(1).max(6),
            isToggleable: z.boolean().optional()
          })
          .strict(),
        content: z.array(blockNoteInlineContentSchema),
        children: z.array(blockNoteBlockSchema)
      })
      .strict(),
    z
      .object({
        id: blockIdSchema,
        type: z.literal('quote'),
        props: quotePropsSchema,
        content: z.array(blockNoteInlineContentSchema),
        children: z.array(blockNoteBlockSchema)
      })
      .strict(),
    z
      .object({
        id: blockIdSchema,
        type: z.literal('codeBlock'),
        props: z.object({ language: z.string().max(200) }).strict(),
        content: z.array(blockNoteInlineContentSchema),
        children: z.array(blockNoteBlockSchema)
      })
      .strict(),
    z
      .object({
        id: blockIdSchema,
        type: z.literal('table'),
        props: z.object({ textColor: blockColorSchema }).strict(),
        content: tableContentSchema,
        children: z.array(blockNoteBlockSchema)
      })
      .strict(),
    z
      .object({
        id: blockIdSchema,
        type: z.literal('image'),
        props: z
          .object({
            backgroundColor: blockColorSchema,
            textAlignment: textAlignmentSchema,
            name: z.string().max(500),
            url: manuscriptAssetUrlSchema,
            caption: z.string().max(2_000),
            figureId: figureIdSchema.optional(),
            altText: z.string().max(2_000).optional(),
            showPreview: z.boolean(),
            previewWidth: z.number().int().min(64).max(8_192).optional()
          })
          .strict(),
        content: z.undefined().optional(),
        children: z.array(blockNoteBlockSchema)
      })
      .strict(),
    z
      .object({
        id: blockIdSchema,
        type: z.literal('diagram'),
        props: diagramPropsSchema,
        content: plainTextContentSchema,
        children: z.array(blockNoteBlockSchema)
      })
      .strict()
      .superRefine((block, context) => {
        const result = diagramSourceSchema.safeParse(plainTextContentToString(block.content))
        if (!result.success) {
          context.addIssue({
            code: 'custom',
            path: ['content'],
            message: result.error.issues[0]?.message ?? 'Diagram source is invalid'
          })
        }
      }),
    z
      .object({
        id: blockIdSchema,
        type: z.literal('mathBlock'),
        props: z.object({}).strict(),
        content: plainTextContentSchema,
        children: z.array(blockNoteBlockSchema)
      })
      .strict()
      .superRefine((block, context) => {
        const result = blockMathSourceSchema.safeParse(plainTextContentToString(block.content))
        if (!result.success) {
          context.addIssue({
            code: 'custom',
            path: ['content'],
            message: result.error.issues[0]?.message ?? 'Block LaTeX source is invalid'
          })
        }
      })
  ])
)

export const blockNoteDocumentSchema = z
  .array(blockNoteBlockSchema)
  .superRefine((document, context) => {
    const ids = new Set<string>()
    let blockCount = 0
    let inlineNodeCount = 0
    const visitInline = (nodes: z.infer<typeof blockNoteInlineContentSchema>[]): void => {
      for (const node of nodes) {
        inlineNodeCount += 1
        if (node.type === 'link') visitInline(node.content)
      }
    }
    const visit = (blocks: BlockNoteBlockValue[], depth: number): void => {
      if (depth > MAX_SECTION_NESTING_DEPTH) {
        context.addIssue({ code: 'custom', message: 'Section nesting is too deep' })
        return
      }
      for (const block of blocks) {
        blockCount += 1
        if (ids.has(block.id)) {
          context.addIssue({ code: 'custom', message: `Duplicate block ID: ${block.id}` })
        }
        ids.add(block.id)
        if (Array.isArray(block.content)) visitInline(block.content)
        else if (block.content !== undefined)
          for (const row of block.content.rows)
            for (const cell of row.cells) visitInline(Array.isArray(cell) ? cell : cell.content)
        visit(block.children, depth + 1)
      }
    }
    visit(document, 1)
    if (blockCount > MAX_SECTION_BLOCKS)
      context.addIssue({ code: 'custom', message: 'Section contains too many blocks' })
    if (inlineNodeCount > MAX_SECTION_INLINE_NODES)
      context.addIssue({ code: 'custom', message: 'Section contains too many inline nodes' })
    try {
      if (
        new TextEncoder().encode(JSON.stringify(document)).byteLength > MAX_SECTION_DOCUMENT_BYTES
      ) {
        context.addIssue({ code: 'custom', message: 'Section document is too large' })
      }
    } catch {
      context.addIssue({ code: 'custom', message: 'Section document is not JSON serializable' })
    }
  })

export const legacyBlockNoteDocumentSchema = z
  .array(z.record(z.string(), z.unknown()))
  .superRefine((document, context) => {
    try {
      if (
        new TextEncoder().encode(JSON.stringify(document)).byteLength > MAX_SECTION_DOCUMENT_BYTES
      ) {
        context.addIssue({ code: 'custom', message: 'Legacy section document is too large' })
      }
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Legacy section document is not JSON serializable'
      })
    }
  })

function legacyMathCaptionId(blockId: string, usedIds: Set<string>): string {
  let hash = 2_166_136_261
  for (const character of blockId) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16_777_619)
  }
  const base = `legacy-math-caption-${(hash >>> 0).toString(16).padStart(8, '0')}`
  let candidate = base
  let suffix = 2
  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  usedIds.add(candidate)
  return candidate
}

function collectLegacyBlockIds(values: readonly unknown[], ids: Set<string>): void {
  for (const value of values) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
    const record = value as Record<string, unknown>
    if (typeof record.id === 'string') ids.add(record.id)
    if (Array.isArray(record.children)) collectLegacyBlockIds(record.children, ids)
  }
}

function convertLegacyBlocks(values: readonly unknown[], usedIds: Set<string>): unknown[] {
  return values.flatMap((value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return [value]
    const block = value as Record<string, unknown>
    const children = Array.isArray(block.children)
      ? convertLegacyBlocks(block.children, usedIds)
      : block.children
    if (block.type === 'mermaid') {
      const props = legacyRichMediaPropsSchema.parse(block.props)
      return [
        {
          id: block.id,
          type: 'diagram',
          props: { engine: 'mermaid', caption: props.caption, altText: '' },
          content: plainTextContentFromSource(props.source),
          children
        }
      ]
    }
    if (block.type === 'math') {
      const props = legacyMathPropsSchema.parse(block.props)
      const converted = {
        id: block.id,
        type: 'mathBlock',
        props: {},
        content: plainTextContentFromSource(props.source),
        children
      }
      if (props.caption.length === 0) return [converted]
      return [
        converted,
        {
          id: legacyMathCaptionId(String(block.id), usedIds),
          type: 'paragraph',
          props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
          content: [{ type: 'text', text: props.caption, styles: { italic: true } }],
          children: []
        }
      ]
    }
    return [{ ...block, children }]
  })
}

export function projectLegacyBlockNoteDocument(document: unknown): BlockNoteDocument {
  const legacy = legacyBlockNoteDocumentSchema.parse(document)
  const usedIds = new Set<string>()
  collectLegacyBlockIds(legacy, usedIds)
  return blockNoteDocumentSchema.parse(convertLegacyBlocks(legacy, usedIds))
}

export function normalizePlainBlockContent(document: BlockNoteDocument): BlockNoteDocument {
  const visit = (blocks: BlockNoteDocument): BlockNoteDocument =>
    blocks.map((block) => {
      const children = visit(block.children)
      if (block.type !== 'mathBlock' && block.type !== 'diagram') return { ...block, children }
      const content = plainTextContentSchema.parse(block.content)
      return {
        ...block,
        content: plainTextContentFromSource(plainTextContentToString(content)),
        children
      }
    })
  return blockNoteDocumentSchema.parse(visit(document))
}

export const currentBlockNoteDocumentSchema = blockNoteDocumentSchema.superRefine(
  (document, context) => {
    const visit = (blocks: BlockNoteBlockValue[]): void => {
      for (const block of blocks) {
        if (block.type === 'image') {
          if (typeof block.props.figureId !== 'string' || block.props.figureId.length === 0) {
            context.addIssue({
              code: 'custom',
              path: [block.id, 'props', 'figureId'],
              message: 'Image figure ID is missing'
            })
          }
          if (typeof block.props.altText !== 'string') {
            context.addIssue({
              code: 'custom',
              path: [block.id, 'props', 'altText'],
              message: 'Image alt text metadata is missing'
            })
          }
        }
        visit(block.children)
      }
    }
    visit(document)
  }
)

export function figureIdForBlock(sectionId: string, blockId: string): string {
  return figureIdSchema.parse(`figure:${sectionId}:${blockId}`)
}

export function normalizeFigureMetadata(
  document: BlockNoteDocument,
  sectionId: string
): BlockNoteDocument {
  const visit = (blocks: BlockNoteDocument): BlockNoteDocument =>
    blocks.map((block) => {
      const children = visit(block.children)
      if (block.type !== 'image') return { ...block, children }
      const props = block.props as Record<string, unknown>
      return {
        ...block,
        props: {
          ...props,
          figureId:
            typeof props.figureId === 'string' && props.figureId.length > 0
              ? props.figureId
              : figureIdForBlock(sectionId, block.id),
          altText:
            typeof props.altText === 'string'
              ? props.altText
              : typeof props.name === 'string'
                ? props.name
                : ''
        },
        children
      }
    })
  return currentBlockNoteDocumentSchema.parse(normalizePlainBlockContent(visit(document)))
}

export type BlockNoteDocument = z.infer<typeof blockNoteDocumentSchema>

export const manuscriptBriefFieldsSchema = z
  .object({
    title: requiredTitle,
    description: boundedText,
    topic: boundedText,
    targetAudience: boundedText,
    language: z.string().max(200),
    styleTone: boundedText,
    scopeExclusions: boundedText,
    targetLength: z.string().max(2_000),
    citationRequirements: boundedText,
    additionalInstructions: boundedText,
    extensible: z.record(z.string().min(1).max(256), z.unknown()).superRefine((value, context) => {
      if (value[WRITING_RULES_NAMESPACE] !== undefined) {
        const parsed = writingRulesStateSchema.safeParse(value[WRITING_RULES_NAMESPACE])
        if (!parsed.success) {
          context.addIssue({
            code: 'custom',
            path: [WRITING_RULES_NAMESPACE],
            message: 'Brief writingRulesV1 data is invalid'
          })
        }
      }
      const seen = new WeakSet<object>()
      let keys = 0
      const visit = (candidate: unknown, depth: number): void => {
        if (candidate === null || typeof candidate !== 'object') return
        if (seen.has(candidate)) {
          context.addIssue({ code: 'custom', message: 'Brief extensible data must be acyclic' })
          return
        }
        if (depth > MAX_BRIEF_EXTENSIBLE_DEPTH) {
          context.addIssue({
            code: 'custom',
            message: 'Brief extensible data is too deeply nested'
          })
          return
        }
        seen.add(candidate)
        for (const [key, child] of Object.entries(candidate)) {
          keys += 1
          if (keys > MAX_BRIEF_EXTENSIBLE_KEYS) {
            context.addIssue({ code: 'custom', message: 'Brief extensible data has too many keys' })
            return
          }
          if (key.length > 256) {
            context.addIssue({ code: 'custom', message: 'Brief extensible key is too long' })
            return
          }
          visit(child, depth + 1)
        }
        seen.delete(candidate)
      }
      visit(value, 0)
      try {
        if (
          new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_BRIEF_EXTENSIBLE_BYTES
        ) {
          context.addIssue({ code: 'custom', message: 'Brief extensible data is too large' })
        }
      } catch {
        context.addIssue({
          code: 'custom',
          message: 'Brief extensible data is not JSON serializable'
        })
      }
    })
  })
  .strict()

export const manuscriptBriefSchema = manuscriptBriefFieldsSchema
  .extend({
    manuscriptBriefId: manuscriptBriefIdSchema,
    manuscriptId: manuscriptIdSchema,
    version: z.number().int().positive(),
    schemaVersion: z.literal(MANUSCRIPT_BRIEF_SCHEMA_VERSION),
    createdAt: z.iso.datetime()
  })
  .strict()

export const updateManuscriptBriefInputSchema = manuscriptBriefFieldsSchema
  .extend({ baseVersion: z.number().int().positive() })
  .strict()

export const sectionSchema = z
  .object({
    sectionId: sectionIdSchema,
    manuscriptId: manuscriptIdSchema,
    parentSectionId: sectionIdSchema.nullable(),
    position: z.number().int().nonnegative(),
    level: z.number().int().positive().max(MAX_MANUSCRIPT_OUTLINE_DEPTH),
    title: requiredTitle,
    objective: boundedText.nullable(),
    status: sectionStatusSchema,
    currentRevisionId: sectionRevisionIdSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime()
  })
  .strict()

export const createSectionInputSchema = z
  .object({
    baseOutlineVersion: z.number().int().positive(),
    parentSectionId: sectionIdSchema.nullable().default(null),
    position: z.number().int().nonnegative(),
    title: requiredTitle,
    objective: boundedText.nullable().default(null),
    status: sectionStatusSchema.default('planned')
  })
  .strict()

export const updateSectionInputSchema = z
  .object({
    baseOutlineVersion: z.number().int().positive(),
    sectionId: sectionIdSchema,
    title: requiredTitle.optional(),
    objective: boundedText.nullable().optional(),
    status: sectionStatusSchema.optional()
  })
  .strict()
  .refine(
    ({ title, objective, status }) =>
      title !== undefined || objective !== undefined || status !== undefined,
    'At least one section field must be updated'
  )

export const moveSectionInputSchema = z
  .object({
    baseOutlineVersion: z.number().int().positive(),
    sectionId: sectionIdSchema,
    parentSectionId: sectionIdSchema.nullable(),
    position: z.number().int().nonnegative()
  })
  .strict()

export const deleteSectionInputSchema = z
  .object({
    baseOutlineVersion: z.number().int().positive(),
    sectionId: sectionIdSchema
  })
  .strict()

export const sectionRevisionSchema = z
  .object({
    sectionRevisionId: sectionRevisionIdSchema,
    sectionId: sectionIdSchema,
    revisionNumber: z.number().int().positive(),
    source: sectionRevisionSourceSchema,
    sourceClass: sectionRevisionClassSchema.optional(),
    content: blockNoteDocumentSchema,
    contentSchemaVersion: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(SECTION_CONTENT_SCHEMA_VERSION)
    ]),
    contentHash: contentHashSchema,
    priorRevisionId: sectionRevisionIdSchema.nullable(),
    wordCount: z.number().int().nonnegative(),
    characterCount: z.number().int().nonnegative(),
    countAlgorithmVersion: sectionCountAlgorithmVersionSchema,
    agentRunId: z.string().min(1).max(256).nullable(),
    agentToolCallId: z.string().min(1).max(256).nullable(),
    agentProposalId: z.string().min(1).max(256).nullable(),
    createdAt: z.iso.datetime()
  })
  .strict()

export const sectionRevisionSummarySchema = sectionRevisionSchema.omit({ content: true }).strict()
export const currentSectionRevisionSchema = sectionRevisionSchema.refine(
  (revision) =>
    revision.countAlgorithmVersion === SECTION_COUNT_ALGORITHM_VERSION &&
    revision.contentSchemaVersion === SECTION_CONTENT_SCHEMA_VERSION,
  'Current section revision must use the active content and count schemas'
)
export const currentSectionRevisionSummarySchema = sectionRevisionSummarySchema.refine(
  (revision) =>
    revision.countAlgorithmVersion === SECTION_COUNT_ALGORITHM_VERSION &&
    revision.contentSchemaVersion === SECTION_CONTENT_SCHEMA_VERSION,
  'Current section revision must use the active content and count schemas'
)

export const appendSectionRevisionInputSchema = z
  .object({
    sectionId: sectionIdSchema,
    baseRevisionId: sectionRevisionIdSchema,
    baseContentHash: contentHashSchema,
    content: blockNoteDocumentSchema,
    source: sectionRevisionSourceSchema.default('manual'),
    sourceClass: sectionRevisionClassSchema.optional(),
    agentRunId: z.string().min(1).max(256).nullable().default(null),
    agentToolCallId: z.string().min(1).max(256).nullable().default(null),
    agentProposalId: z.string().min(1).max(256).nullable().default(null)
  })
  .strict()

const manuscriptSectionCollectionSchema = z
  .array(
    z
      .object({
        section: sectionSchema,
        revision: currentSectionRevisionSchema
      })
      .strict()
  )
  .max(MAX_MANUSCRIPT_SECTIONS)
  .superRefine((sections, context) => {
    const ids = new Set<string>()
    for (const item of sections) {
      if (ids.has(item.section.sectionId)) {
        context.addIssue({ code: 'custom', message: 'Manuscript contains duplicate section IDs' })
      }
      ids.add(item.section.sectionId)
    }
    try {
      if (
        new TextEncoder().encode(JSON.stringify(sections)).byteLength >
        MAX_MANUSCRIPT_WORKSPACE_BYTES
      ) {
        context.addIssue({ code: 'custom', message: 'Manuscript section collection is too large' })
      }
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Manuscript section collection is not serializable'
      })
    }
  })

const manuscriptSectionSummaryCollectionSchema = z
  .array(
    z.object({ section: sectionSchema, revision: currentSectionRevisionSummarySchema }).strict()
  )
  .max(MAX_MANUSCRIPT_SECTIONS)
  .superRefine((sections, context) => {
    const ids = new Set<string>()
    for (const item of sections) {
      if (ids.has(item.section.sectionId)) {
        context.addIssue({ code: 'custom', message: 'Manuscript contains duplicate section IDs' })
      }
      ids.add(item.section.sectionId)
    }
    try {
      if (
        new TextEncoder().encode(JSON.stringify(sections)).byteLength >
        MAX_MANUSCRIPT_WORKSPACE_BYTES
      ) {
        context.addIssue({ code: 'custom', message: 'Manuscript section collection is too large' })
      }
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Manuscript section collection is not serializable'
      })
    }
  })

export const manuscriptAssemblySchema = z
  .object({
    manuscriptId: manuscriptIdSchema,
    outlineVersion: z.number().int().positive(),
    brief: manuscriptBriefSchema,
    sections: manuscriptSectionCollectionSchema,
    wordCount: z.number().int().nonnegative(),
    characterCount: z.number().int().nonnegative()
  })
  .strict()

export const manuscriptWorkspaceSchema = z
  .object({
    manuscriptId: manuscriptIdSchema,
    outlineVersion: z.number().int().positive(),
    brief: manuscriptBriefSchema,
    sections: manuscriptSectionSummaryCollectionSchema,
    wordCount: z.number().int().nonnegative(),
    characterCount: z.number().int().nonnegative()
  })
  .strict()

export const manuscriptReferenceOccurrenceSchema = z
  .object({
    sectionId: sectionIdSchema,
    sectionRevisionId: sectionRevisionIdSchema,
    blockId: blockIdSchema,
    ordinal: z.number().int().nonnegative().max(100_000),
    raw: z.string().min(1).max(1_024),
    syntax: z.enum(['english', 'chinese']),
    title: z.string().min(1).max(512),
    pageIndex: z.number().int().nonnegative().optional()
  })
  .strict()

export const manuscriptReferenceEntrySchema = z
  .object({
    number: z.number().int().positive().max(50_000),
    title: z.string().min(1).max(512),
    count: z.number().int().positive().max(50_000),
    occurrences: z.array(manuscriptReferenceOccurrenceSchema).min(1).max(50_000)
  })
  .strict()
  .refine((entry) => entry.count === entry.occurrences.length, 'Reference count is inconsistent')

export const manuscriptReferenceIndexSchema = z
  .object({
    outlineVersion: z.number().int().positive(),
    entries: z.array(manuscriptReferenceEntrySchema).max(50_000)
  })
  .strict()

export const editorSessionInputSchema = z
  .object({ projectSessionId: z.string().min(1).max(256) })
  .strict()
export const editorFlushSubscriptionInputSchema = editorSessionInputSchema
  .extend({ subscriptionId: z.string().uuid() })
  .strict()
export const loadSectionInputSchema = editorSessionInputSchema
  .extend({ sectionId: sectionIdSchema })
  .strict()
export const saveSectionDocumentInputSchema = loadSectionInputSchema
  .extend({
    baseRevisionId: sectionRevisionIdSchema,
    baseContentHash: contentHashSchema,
    document: blockNoteDocumentSchema,
    revisionSource: sectionRevisionClassSchema.optional()
  })
  .strict()
export const editorSectionSchema = z
  .object({ section: sectionSchema, revision: currentSectionRevisionSchema })
  .strict()
export const openEditorResultSchema = z
  .object({ activeSection: editorSectionSchema.nullable() })
  .strict()
export const saveSectionDocumentResultSchema = z
  .object({
    revision: sectionRevisionSchema,
    disposition: z.enum(['saved', 'unchanged', 'saved_materialization_pending'])
  })
  .strict()
export const saveSectionDocumentResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), result: saveSectionDocumentResultSchema }).strict(),
  z
    .object({
      ok: z.literal(false),
      error: z
        .object({
          code: z.literal('section_revision_conflict'),
          message: z.literal('The section body has changed')
        })
        .strict()
    })
    .strict()
])
export const finalFlushSaveInputSchema = saveSectionDocumentInputSchema
  .extend({
    closingToken: z.string().uuid(),
    purpose: z.enum(['close', 'snapshot', 'export', 'mutation']).optional()
  })
  .strict()
export const editorFlushRequestSchema = z
  .object({
    projectSessionId: z.string().min(1).max(256),
    closingToken: z.string().uuid(),
    purpose: z.enum(['close', 'snapshot', 'export', 'mutation']).optional(),
    bodyRequired: z.boolean().default(true),
    sectionId: sectionIdSchema.optional(),
    sectionRevisionId: sectionRevisionIdSchema.optional()
  })
  .strict()
export const editorFlushAckInputSchema = editorFlushRequestSchema
  .extend({ sectionId: sectionIdSchema, sectionRevisionId: sectionRevisionIdSchema })
  .strict()
export const exportNativeJsonInputSchema = loadSectionInputSchema
export const exportMarkdownInputSchema = loadSectionInputSchema
  .extend({
    sectionRevisionId: sectionRevisionIdSchema,
    contentHash: contentHashSchema
  })
  .strict()
export const exportResultSchema = z.object({ relativePath: z.string().min(1).max(1_024) }).strict()

export const uploadManuscriptAssetInputSchema = editorSessionInputSchema
  .extend({
    originalName: z.string().trim().min(1).max(500),
    mimeType: manuscriptAssetMimeTypeSchema,
    dataBase64: z.string().min(1).max(28_000_000)
  })
  .strict()
export const manuscriptAssetResultSchema = z
  .object({
    assetId: manuscriptAssetIdSchema,
    logicalUrl: manuscriptAssetUrlSchema,
    mimeType: manuscriptAssetMimeTypeSchema,
    byteSize: z
      .number()
      .int()
      .positive()
      .max(20 * 1024 * 1024)
  })
  .strict()
export const manuscriptAssetPreviewInputSchema = editorSessionInputSchema
  .extend({ assetId: manuscriptAssetIdSchema })
  .strict()
export const manuscriptAssetPreviewResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('resolved'), url: z.string().url().max(2_048) }).strict(),
  z.object({ status: z.literal('session-revoked') }).strict()
])

export const manuscriptWorkspaceInputSchema = editorSessionInputSchema
export const manuscriptReferenceIndexInputSchema = editorSessionInputSchema
export const updateManuscriptBriefRequestSchema = editorSessionInputSchema
  .extend({ update: updateManuscriptBriefInputSchema })
  .strict()
export const createSectionRequestSchema = editorSessionInputSchema
  .extend({ create: createSectionInputSchema })
  .strict()
export const updateSectionRequestSchema = editorSessionInputSchema
  .extend({ update: updateSectionInputSchema })
  .strict()
export const moveSectionRequestSchema = editorSessionInputSchema
  .extend({ move: moveSectionInputSchema })
  .strict()
export const deleteSectionRequestSchema = editorSessionInputSchema
  .extend({ delete: deleteSectionInputSchema })
  .strict()

export const MANUSCRIPT_ERROR_CODES = [
  'primary_manuscript_missing',
  'primary_manuscript_ambiguous',
  'brief_version_conflict',
  'outline_version_conflict',
  'section_not_found',
  'section_revision_not_found',
  'section_revision_conflict',
  'section_parent_invalid',
  'section_cycle',
  'section_position_invalid',
  'outline_depth_exceeded',
  'section_has_children',
  'section_is_last',
  'section_deletion_blocked'
] as const

export type ManuscriptErrorCode = (typeof MANUSCRIPT_ERROR_CODES)[number]
export type ManuscriptBrief = z.infer<typeof manuscriptBriefSchema>
export type UpdateManuscriptBriefInput = z.infer<typeof updateManuscriptBriefInputSchema>
export type Section = z.infer<typeof sectionSchema>
export type SectionStatus = z.infer<typeof sectionStatusSchema>
export type CreateSectionInput = z.input<typeof createSectionInputSchema>
export type UpdateSectionInput = z.infer<typeof updateSectionInputSchema>
export type MoveSectionInput = z.infer<typeof moveSectionInputSchema>
export type DeleteSectionInput = z.infer<typeof deleteSectionInputSchema>
export type ManuscriptAssetResult = z.infer<typeof manuscriptAssetResultSchema>
export type SectionRevision = z.infer<typeof sectionRevisionSchema>
export type SectionRevisionSource = z.infer<typeof sectionRevisionSourceSchema>
export type AppendSectionRevisionInput = z.input<typeof appendSectionRevisionInputSchema>
export type ManuscriptAssembly = z.infer<typeof manuscriptAssemblySchema>
export type SectionRevisionSummary = z.infer<typeof sectionRevisionSummarySchema>
export type ManuscriptWorkspace = z.infer<typeof manuscriptWorkspaceSchema>
export type ManuscriptReferenceOccurrence = z.infer<typeof manuscriptReferenceOccurrenceSchema>
export type ManuscriptReferenceEntry = z.infer<typeof manuscriptReferenceEntrySchema>
export type ManuscriptReferenceIndex = z.infer<typeof manuscriptReferenceIndexSchema>
export type SaveSectionDocumentInput = z.infer<typeof saveSectionDocumentInputSchema>
export type SaveSectionDocumentResult = z.infer<typeof saveSectionDocumentResultSchema>
export type SaveSectionDocumentResponse = z.infer<typeof saveSectionDocumentResponseSchema>
export type EditorFlushRequest = z.infer<typeof editorFlushRequestSchema>
export type ManuscriptWorkspaceInput = z.infer<typeof manuscriptWorkspaceInputSchema>
export type UpdateManuscriptBriefRequest = z.infer<typeof updateManuscriptBriefRequestSchema>
export type CreateSectionRequest = z.infer<typeof createSectionRequestSchema>
export type UpdateSectionRequest = z.infer<typeof updateSectionRequestSchema>
export type MoveSectionRequest = z.infer<typeof moveSectionRequestSchema>
export type DeleteSectionRequest = z.infer<typeof deleteSectionRequestSchema>

export class ManuscriptDomainError extends Error {
  readonly code: ManuscriptErrorCode

  constructor(code: ManuscriptErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ManuscriptDomainError'
    this.code = code
  }
}
