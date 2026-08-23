import { z } from 'zod'
import {
  contentHashSchema,
  manuscriptAssemblySchema,
  manuscriptAssetIdSchema,
  manuscriptAssetMimeTypeSchema,
  manuscriptAssetUrlSchema,
  manuscriptIdSchema
} from './manuscript'
import { projectSessionIdSchema } from './projects'
import { publicationPresetIdSchema } from './publication-presets'

export const MANUSCRIPT_EXPORT_FORMAT = 'writellm-manuscript-export'
export const MANUSCRIPT_EXPORT_FORMAT_VERSION = 1
export const MANUSCRIPT_EXPORT_MANIFEST_FILE = 'writellm.manuscript-export.json'
export const MANUSCRIPT_NATIVE_CONTENT_FILE = 'manuscript.json'
export const MANUSCRIPT_MARKDOWN_CONTENT_FILE = 'manuscript.md'
export const MANUSCRIPT_DOCX_CONTENT_FILE = 'manuscript.docx'
export const MANUSCRIPT_LATEX_CONTENT_FILE = 'manuscript.tex'
export const MANUSCRIPT_PDF_CONTENT_FILE = 'manuscript.pdf'
export const MANUSCRIPT_LOSS_REPORT_FILE = 'writellm.loss-report.json'

export const manuscriptExportKindSchema = z.enum(['native', 'markdown', 'docx', 'latex', 'pdf'])

export const manuscriptExportInputSchema = z
  .object({
    projectSessionId: projectSessionIdSchema,
    kind: manuscriptExportKindSchema,
    presetId: publicationPresetIdSchema.optional()
  })
  .strict()

export const manuscriptExportAssetSchema = z
  .object({
    assetId: manuscriptAssetIdSchema,
    logicalUrl: manuscriptAssetUrlSchema,
    relativePath: z.string().regex(/^assets\/[a-f0-9]{64}\.(?:png|jpg|webp)$/),
    sha256: contentHashSchema,
    byteSize: z
      .number()
      .int()
      .positive()
      .max(20 * 1024 * 1024),
    mimeType: manuscriptAssetMimeTypeSchema
  })
  .strict()

export const manuscriptMarkdownLossSchema = z
  .object({
    code: z.enum([
      'text_color',
      'background_color',
      'text_alignment',
      'underline',
      'toggle_heading',
      'table_span',
      'table_header_columns',
      'table_header_inference',
      'table_multiple_header_rows',
      'nested_block_structure',
      'preview_width',
      'citation_numbering',
      'missing_figure_caption',
      'missing_figure_alt_text',
      'empty_section',
      'mermaid_requires_rendering',
      'diagram_alt_text_not_representable',
      'mermaid_source_fallback',
      'math_text_fallback',
      'webp_unsupported',
      'bibliography_metadata_unavailable',
      'latex_table_span_fallback',
      'latex_verbatim_sanitized',
      'pdf_toc_page_unavailable'
    ]),
    sectionId: z.string().min(1).max(256),
    blockId: z.string().min(1).max(256),
    message: z.string().min(1).max(500)
  })
  .strict()

export const manuscriptMarkdownLossReportSchema = z
  .object({
    formatVersion: z.literal(1),
    losses: z.array(manuscriptMarkdownLossSchema).max(10_000)
  })
  .strict()

export const manuscriptNativeExportSchema = z
  .object({
    exportFormat: z.literal(MANUSCRIPT_EXPORT_FORMAT),
    exportFormatVersion: z.literal(MANUSCRIPT_EXPORT_FORMAT_VERSION),
    manuscript: manuscriptAssemblySchema,
    assets: z.array(manuscriptExportAssetSchema).max(10_000)
  })
  .strict()

const exportedFileSchema = z
  .object({
    relativePath: z.string().min(1).max(1_024),
    sha256: contentHashSchema,
    byteSize: z.number().int().nonnegative()
  })
  .strict()

export const manuscriptExportManifestSchema = z
  .object({
    exportFormat: z.literal(MANUSCRIPT_EXPORT_FORMAT),
    exportFormatVersion: z.literal(MANUSCRIPT_EXPORT_FORMAT_VERSION),
    kind: manuscriptExportKindSchema,
    manuscriptId: manuscriptIdSchema,
    createdAt: z.iso.datetime(),
    sourceAppVersion: z.string().min(1).max(100),
    publicationSourceHash: contentHashSchema.optional(),
    content: exportedFileSchema,
    assetCount: z.number().int().nonnegative().max(10_000),
    assetInventorySha256: contentHashSchema,
    assets: z.array(manuscriptExportAssetSchema).max(10_000),
    lossReport: exportedFileSchema
      .extend({ lossCount: z.number().int().nonnegative().max(10_000) })
      .strict()
      .optional()
  })
  .strict()

export const manuscriptExportResultSchema = z.discriminatedUnion('created', [
  z
    .object({
      created: z.literal(false),
      kind: manuscriptExportKindSchema
    })
    .strict(),
  z
    .object({
      created: z.literal(true),
      kind: manuscriptExportKindSchema,
      packageName: z.string().min(1).max(255),
      contentSha256: contentHashSchema,
      assetCount: z.number().int().nonnegative().max(10_000),
      lossReport: manuscriptMarkdownLossReportSchema.optional()
    })
    .strict()
])

export const manuscriptExportCancelResultSchema = z.object({ cancelled: z.boolean() }).strict()

export type ManuscriptExportKind = z.infer<typeof manuscriptExportKindSchema>
export type ManuscriptExportAsset = z.infer<typeof manuscriptExportAssetSchema>
export type ManuscriptMarkdownLoss = z.infer<typeof manuscriptMarkdownLossSchema>
export type ManuscriptMarkdownLossReport = z.infer<typeof manuscriptMarkdownLossReportSchema>
export type ManuscriptNativeExport = z.infer<typeof manuscriptNativeExportSchema>
export type ManuscriptExportManifest = z.infer<typeof manuscriptExportManifestSchema>
export type ManuscriptExportResult = z.infer<typeof manuscriptExportResultSchema>
