import { z } from 'zod'
import { contentHashSchema, inlineMathSourceSchema } from './manuscript'
import {
  MAX_MANUSCRIPT_IMPORT_SECTIONS,
  MAX_MANUSCRIPT_IMPORT_SOURCE_BYTES
} from './manuscript-import'

export const LATEX_IMPORT_TIMEOUT_MS = 5_000
export const MAX_LATEX_IMPORT_NODES = 50_000
export const MAX_LATEX_PROJECT_FILES = 500
export const MAX_LATEX_PROJECT_TEXT_BYTES = 16 * 1024 * 1024
export const MAX_LATEX_INCLUDE_DEPTH = 16

const requestIdSchema = z.uuid()
const findingSchema = z
  .object({
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(2_000),
    sourceLocation: z.string().min(1).max(500).nullable()
  })
  .strict()

const inlineSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('text'),
      text: z.string().max(100_000),
      styles: z
        .object({
          bold: z.boolean().optional(),
          italic: z.boolean().optional(),
          underline: z.boolean().optional(),
          code: z.boolean().optional()
        })
        .strict()
    })
    .strict(),
  z.object({ type: z.literal('math'), source: inlineMathSourceSchema }).strict()
])

const latexImportNodeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('paragraph'), content: z.array(inlineSchema).max(10_000) }).strict(),
  z
    .object({
      type: z.literal('heading'),
      level: z.number().int().min(1).max(6),
      content: z.array(inlineSchema).max(10_000)
    })
    .strict(),
  z
    .object({
      type: z.literal('list'),
      ordered: z.boolean(),
      items: z.array(z.array(inlineSchema).max(10_000)).max(10_000)
    })
    .strict(),
  z.object({ type: z.literal('quote'), content: z.array(inlineSchema).max(10_000) }).strict(),
  z
    .object({
      type: z.literal('table'),
      headerRows: z.number().int().min(0).max(1_000),
      caption: z.string().max(2_000),
      rows: z.array(z.array(z.array(inlineSchema).max(10_000)).max(1_000)).max(1_000)
    })
    .strict(),
  z
    .object({
      type: z.literal('figure'),
      relativePath: z.string().min(1).max(1_024),
      caption: z.string().max(2_000),
      altText: z.string().max(2_000),
      label: z.string().max(500).nullable()
    })
    .strict(),
  z
    .object({
      type: z.literal('code'),
      language: z.string().max(200),
      source: z.string().max(100_000)
    })
    .strict(),
  z.object({ type: z.literal('math'), source: z.string().max(32_000) }).strict()
])

const relativeProjectPathSchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.split('/').some((part) => part === '' || part === '.' || part === '..'),
    'Project path must be a normalized contained relative path'
  )

export const latexImportWorkerRequestSchema = z
  .object({
    type: z.literal('latex-import-parse'),
    requestId: requestIdSchema,
    sourceHash: contentHashSchema,
    source: z.string().max(MAX_MANUSCRIPT_IMPORT_SOURCE_BYTES),
    project: z
      .object({
        entryRelativePath: relativeProjectPathSchema,
        textFiles: z
          .array(
            z
              .object({
                relativePath: relativeProjectPathSchema,
                kind: z.enum(['tex', 'bib']),
                source: z.string().max(MAX_MANUSCRIPT_IMPORT_SOURCE_BYTES)
              })
              .strict()
          )
          .max(MAX_LATEX_PROJECT_FILES),
        assetPaths: z.array(relativeProjectPathSchema).max(MAX_LATEX_PROJECT_FILES)
      })
      .strict()
      .nullable()
      .optional()
  })
  .strict()
  .superRefine((value, context) => {
    const textBytes = value.project?.textFiles.reduce(
      (total, file) => total + utf8ByteLength(file.source),
      0
    )
    if ((textBytes ?? utf8ByteLength(value.source)) > MAX_LATEX_PROJECT_TEXT_BYTES) {
      context.addIssue({ code: 'custom', message: 'LaTeX project text exceeds the 16 MiB limit' })
    }
    if (
      value.project != null &&
      !value.project.textFiles.some(
        (file) => file.kind === 'tex' && file.relativePath === value.project?.entryRelativePath
      )
    ) {
      context.addIssue({ code: 'custom', message: 'LaTeX project entry source is missing' })
    }
  })

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export const latexImportWorkerResultSchema = z
  .object({
    type: z.literal('latex-import-result'),
    requestId: requestIdSchema,
    sourceHash: contentHashSchema,
    proposedTitle: z.string().trim().min(1).max(500).nullable(),
    sections: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(500),
            outlineLevel: z.number().int().min(1).max(64),
            nodes: z.array(latexImportNodeSchema).max(MAX_LATEX_IMPORT_NODES)
          })
          .strict()
      )
      .max(MAX_MANUSCRIPT_IMPORT_SECTIONS),
    warnings: z.array(findingSchema).max(1_000),
    unsupported: z.array(findingSchema).max(1_000),
    losses: z.array(findingSchema).max(1_000)
  })
  .strict()

export const latexImportWorkerErrorSchema = z
  .object({
    type: z.literal('latex-import-error'),
    requestId: requestIdSchema,
    error: z
      .object({ name: z.string().min(1).max(100), message: z.string().min(1).max(1_000) })
      .strict()
  })
  .strict()

export type LatexImportWorkerRequest = z.infer<typeof latexImportWorkerRequestSchema>
export type LatexImportWorkerResult = z.infer<typeof latexImportWorkerResultSchema>
export type LatexImportWorkerResponse =
  | LatexImportWorkerResult
  | z.infer<typeof latexImportWorkerErrorSchema>
export type LatexImportNode = z.infer<typeof latexImportNodeSchema>
