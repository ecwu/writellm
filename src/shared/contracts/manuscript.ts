import { z } from 'zod'

export const MANUSCRIPT_BRIEF_SCHEMA_VERSION = 1
export const SECTION_CONTENT_SCHEMA_VERSION = 2
export const SECTION_COUNT_ALGORITHM_VERSION = 1
export const SECTION_MATERIALIZATION_FORMAT_VERSION = 1
export const SECTION_MATERIALIZATION_ENVELOPE_SCHEMA_VERSION = 1
export const MAX_SECTION_DOCUMENT_BYTES = 2 * 1024 * 1024
export const MAX_SECTION_BLOCKS = 10_000
export const MAX_SECTION_INLINE_NODES = 50_000
export const MAX_SECTION_NESTING_DEPTH = 16
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
const blockColorSchema = z.string().min(1).max(100)
const textAlignmentSchema = z.enum(['left', 'center', 'right', 'justify'])
const mermaidSourceSchema = z
  .string()
  .max(64_000)
  .refine(
    (value) => new TextEncoder().encode(value).byteLength <= 64 * 1024,
    'Mermaid source exceeds 64 KiB'
  )
const mathSourceSchema = z
  .string()
  .max(32_000)
  .refine(
    (value) => new TextEncoder().encode(value).byteLength <= 32 * 1024,
    'LaTeX source exceeds 32 KiB'
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

export const blockNoteInlineContentSchema = z.union([styledTextSchema, safeLinkSchema])

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

type BlockNoteBlockValue = {
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
    | 'mermaid'
    | 'math'
  props: Record<string, unknown>
  content?: z.infer<typeof blockNoteInlineContentSchema>[] | z.infer<typeof tableContentSchema>
  children: BlockNoteBlockValue[]
}

const richMediaPropsSchema = z
  .object({
    textAlignment: textAlignmentSchema,
    source: mermaidSourceSchema,
    caption: z.string().max(2_000),
    previewWidth: z.number().int().min(64).max(8_192).optional()
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
        type: z.literal('mermaid'),
        props: richMediaPropsSchema,
        content: z.undefined().optional(),
        children: z.array(blockNoteBlockSchema)
      })
      .strict(),
    z
      .object({
        id: blockIdSchema,
        type: z.literal('math'),
        props: richMediaPropsSchema.extend({ source: mathSourceSchema }).strict(),
        content: z.undefined().optional(),
        children: z.array(blockNoteBlockSchema)
      })
      .strict()
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
    contentSchemaVersion: z.union([z.literal(1), z.literal(SECTION_CONTENT_SCHEMA_VERSION)]),
    contentHash: contentHashSchema,
    priorRevisionId: sectionRevisionIdSchema.nullable(),
    wordCount: z.number().int().nonnegative(),
    characterCount: z.number().int().nonnegative(),
    countAlgorithmVersion: z.literal(SECTION_COUNT_ALGORITHM_VERSION),
    agentRunId: z.string().min(1).max(256).nullable(),
    agentToolCallId: z.string().min(1).max(256).nullable(),
    agentProposalId: z.string().min(1).max(256).nullable(),
    createdAt: z.iso.datetime()
  })
  .strict()

export const sectionRevisionSummarySchema = sectionRevisionSchema.omit({ content: true }).strict()

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
        revision: sectionRevisionSchema
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
  .array(z.object({ section: sectionSchema, revision: sectionRevisionSummarySchema }).strict())
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
  .object({ section: sectionSchema, revision: sectionRevisionSchema })
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
    purpose: z.enum(['close', 'snapshot', 'mutation']).optional()
  })
  .strict()
export const editorFlushRequestSchema = z
  .object({
    projectSessionId: z.string().min(1).max(256),
    closingToken: z.string().uuid(),
    purpose: z.enum(['close', 'snapshot', 'mutation']).optional(),
    sectionId: sectionIdSchema.optional(),
    sectionRevisionId: sectionRevisionIdSchema.optional()
  })
  .strict()
export const editorFlushAckInputSchema = editorFlushRequestSchema
  .extend({ sectionId: sectionIdSchema, sectionRevisionId: sectionRevisionIdSchema })
  .strict()
export const importMarkdownInputSchema = saveSectionDocumentInputSchema
export const exportNativeJsonInputSchema = loadSectionInputSchema
export const exportMarkdownInputSchema = loadSectionInputSchema
  .extend({
    sectionRevisionId: sectionRevisionIdSchema,
    contentHash: contentHashSchema,
    markdown: z.string().max(MAX_SECTION_DOCUMENT_BYTES)
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
export const manuscriptAssetPreviewResultSchema = z
  .object({ url: z.string().url().max(2_048) })
  .strict()
export const manuscriptAssetImportReferenceInputSchema = editorSessionInputSchema
  .extend({ reference: z.string().min(1).max(1_024) })
  .strict()
export const manuscriptAssetImportReferenceResultSchema = z
  .object({ logicalUrl: manuscriptAssetUrlSchema })
  .strict()

export const manuscriptWorkspaceInputSchema = editorSessionInputSchema
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
