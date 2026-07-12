export const CHAPTER_KIND = 'writellm.chapter.blocknote' as const;
export const CHAPTER_SCHEMA_VERSION = 1 as const;
export const CHAPTER_MAX_BYTES = 2 * 1024 * 1024;
export const CHAPTER_MAX_BLOCKS = 10_000;
export const CHAPTER_MAX_DEPTH = 32;
export const CHAPTER_MAX_CITATIONS = 10_000;

export type InlineStyle = 'bold' | 'italic' | 'underline' | 'strike' | 'code';
export type StyledText = {
  type: 'text';
  text: string;
  styles: Partial<Record<InlineStyle, boolean | string>>;
};
export type LinkContent = { type: 'link'; href: string; content: StyledText[] };
export type InlineContent = StyledText | LinkContent;
export type TableContent = { type: 'tableContent'; rows: Array<{ cells: InlineContent[][] }> };
export type BlockNoteBlockType =
  | 'paragraph'
  | 'heading'
  | 'bulletListItem'
  | 'numberedListItem'
  | 'checkListItem'
  | 'table'
  | 'codeBlock'
  | 'quote'
  | 'image'
  | 'writellmCitation';
export type BlockNoteBlockSnapshot = {
  id: string;
  type: BlockNoteBlockType;
  props: Record<string, string | number | boolean>;
  content: InlineContent[] | TableContent | undefined;
  children: BlockNoteBlockSnapshot[];
};
export type CitationReviewReason =
  | 'range-split'
  | 'text-deleted'
  | 'block-missing'
  | 'text-mismatch'
  | 'ambiguous-transform';
export type CitationAnchor = {
  citationId: string;
  sourceId: string;
  chunkId: string;
  blockId: string;
  start: number;
  end: number;
  quotedText: string;
  status: 'valid' | 'needs-review';
  reviewReason?: CitationReviewReason;
};
export type ChapterDocument = {
  kind: typeof CHAPTER_KIND;
  schemaVersion: typeof CHAPTER_SCHEMA_VERSION;
  projectId: string;
  chapterId: string;
  outlineItemId: string;
  revision: number;
  editorFormat: 'blocknote-json';
  editorSchemaVersion: 1;
  blocks: BlockNoteBlockSnapshot[];
  citations: CitationAnchor[];
  createdAt: string;
  updatedAt: string;
};
export type ConversionWarning = {
  code: 'UNSUPPORTED_MARKDOWN' | 'LOSSY_BLOCK' | 'LOSSY_CITATION';
  message: string;
  location?: { blockId?: string; line?: number };
};
export type MarkdownPreview = {
  previewId: string;
  markdown: string;
  warnings: ConversionWarning[];
  expiresAt: string;
};
export type MarkdownPastePreview = {
  previewId: string;
  candidateBlocks: BlockNoteBlockSnapshot[];
  warnings: ConversionWarning[];
  expiresAt: string;
};
export type ChapterErrorCode =
  | 'NO_ACTIVE_PROJECT'
  | 'OUTLINE_ITEM_NOT_FOUND'
  | 'CHAPTER_NOT_FOUND'
  | 'INVALID_INPUT'
  | 'INVALID_DOCUMENT'
  | 'PAYLOAD_TOO_LARGE'
  | 'REVISION_CONFLICT'
  | 'STORAGE_READ_FAILED'
  | 'STORAGE_WRITE_FAILED'
  | 'STORAGE_RECOVERY_REQUIRED'
  | 'UNSUPPORTED_SCHEMA'
  | 'CONVERSION_FAILED'
  | 'EXPORT_FAILED';
export type ChapterError = { code: ChapterErrorCode; message: string; retryable: boolean };
export type ChapterResult<T> = { ok: true; value: T } | { ok: false; error: ChapterError };
export type OpenChapterInput = {
  outlineItemId: string;
  baseOrientationRevision: number;
  mutationId: string;
};
export type LoadChapterInput = { chapterId: string };
export type SaveChapterInput = {
  chapterId: string;
  baseRevision: number;
  mutationId: string;
  blocks: BlockNoteBlockSnapshot[];
  citations: CitationAnchor[];
};
export type PreviewMarkdownExportInput = {
  chapterId: string;
  blocks: BlockNoteBlockSnapshot[];
  citations: CitationAnchor[];
};
export type ExportMarkdownInput = { chapterId: string; previewId: string };
export interface ChapterApi {
  openForOutlineItem(
    input: OpenChapterInput,
  ): Promise<ChapterResult<{ document: ChapterDocument; created: boolean }>>;
  load(input: LoadChapterInput): Promise<ChapterResult<ChapterDocument>>;
  save(input: SaveChapterInput): Promise<ChapterResult<{ document: ChapterDocument }>>;
  previewMarkdownExport(input: PreviewMarkdownExportInput): Promise<ChapterResult<MarkdownPreview>>;
  exportMarkdown(
    input: ExportMarkdownInput,
  ): Promise<ChapterResult<{ status: 'exported' | 'canceled' }>>;
}
export const chapterChannels = {
  openForOutlineItem: 'writellm:chapters:open-for-outline-item',
  load: 'writellm:chapters:load',
  save: 'writellm:chapters:save',
  previewMarkdownExport: 'writellm:chapters:preview-markdown-export',
  exportMarkdown: 'writellm:chapters:export-markdown',
} as const;
export const emptyChapterBlocks = (): BlockNoteBlockSnapshot[] => [
  { id: crypto.randomUUID(), type: 'paragraph', props: {}, content: [], children: [] },
];
