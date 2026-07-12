import { Buffer } from 'node:buffer';
import {
  type BlockNoteBlockSnapshot,
  CHAPTER_KIND,
  CHAPTER_MAX_BLOCKS,
  CHAPTER_MAX_BYTES,
  CHAPTER_MAX_CITATIONS,
  CHAPTER_MAX_DEPTH,
  CHAPTER_SCHEMA_VERSION,
  type ChapterDocument,
  type ChapterError,
  type CitationAnchor,
  type ExportMarkdownInput,
  type LoadChapterInput,
  type OpenChapterInput,
  type PreviewMarkdownExportInput,
  type SaveChapterInput,
} from '../../shared/chapters.js';

export class ChapterValidationError extends Error {
  constructor(readonly detail: ChapterError) {
    super(detail.message);
  }
}
const fail = (code: ChapterError['code'], message: string): never => {
  throw new ChapterValidationError({ code, message, retryable: false });
};
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value: unknown, keys: string[], label: string): Record<string, unknown> => {
  if (
    !record(value) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => !(key in value))
  )
    fail('INVALID_INPUT', `${label} is invalid.`);
  return value as Record<string, unknown>;
};
const uuid = (value: unknown, label: string): string => {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
    fail('INVALID_INPUT', `${label} must be a UUID.`);
  return value as string;
};
const uint = (value: unknown, label: string) => {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    fail('INVALID_INPUT', `${label} is invalid.`);
  return value as number;
};
const text = (value: unknown, label: string): string => {
  if (typeof value !== 'string') fail('INVALID_DOCUMENT', `${label} is invalid.`);
  return value as string;
};
const ensureBytes = (value: unknown) => {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > CHAPTER_MAX_BYTES)
    fail('PAYLOAD_TOO_LARGE', 'Chapter payload exceeds 2 MiB.');
};
const plainText = (block: BlockNoteBlockSnapshot): string =>
  Array.isArray(block.content)
    ? block.content
        .map((item) =>
          item.type === 'text'
            ? item.text
            : item.type === 'link'
              ? item.content.map((part) => part.text).join('')
              : '',
        )
        .join('')
    : '';

export function parseBlocks(value: unknown): BlockNoteBlockSnapshot[] {
  if (!Array.isArray(value) || value.length === 0)
    fail('INVALID_DOCUMENT', 'A chapter needs an editable block.');
  const ids = new Set<string>();
  let count = 0;
  const visit = (raw: unknown, depth: number): BlockNoteBlockSnapshot => {
    if (depth > CHAPTER_MAX_DEPTH) fail('INVALID_DOCUMENT', 'Block nesting exceeds 32 levels.');
    const b = exact(raw, ['id', 'type', 'props', 'content', 'children'], 'Block');
    count += 1;
    if (count > CHAPTER_MAX_BLOCKS) fail('PAYLOAD_TOO_LARGE', 'Chapter exceeds 10,000 blocks.');
    const id = text(b.id, 'Block ID');
    if (!id || ids.has(id)) fail('INVALID_DOCUMENT', 'Block IDs must be non-empty and unique.');
    ids.add(id);
    const allowed = [
      'paragraph',
      'heading',
      'bulletListItem',
      'numberedListItem',
      'checkListItem',
      'table',
      'codeBlock',
      'quote',
      'image',
      'writellmCitation',
    ];
    if (typeof b.type !== 'string' || !allowed.includes(b.type))
      fail('UNSUPPORTED_SCHEMA', 'The chapter contains an unsupported block type.');
    if (!record(b.props)) fail('INVALID_DOCUMENT', 'Block properties are invalid.');
    const props = b.props as Record<string, unknown>;
    const common = ['backgroundColor', 'textColor', 'textAlignment'];
    const propertySchema: Record<string, string[]> = {
      paragraph: common,
      heading: [...common, 'level', 'isToggleable'],
      bulletListItem: common,
      numberedListItem: [...common, 'start'],
      checkListItem: [...common, 'checked'],
      table: ['textColor'],
      codeBlock: ['language'],
      quote: common,
      image: [...common, 'name', 'url', 'caption', 'showPreview', 'previewWidth'],
      writellmCitation: ['citationId'],
    };
    if (Object.keys(props).some((key) => !propertySchema[b.type as string]?.includes(key)))
      fail('UNSUPPORTED_SCHEMA', 'The chapter contains unsupported block properties.');
    for (const value of Object.values(props))
      if (!['string', 'number', 'boolean'].includes(typeof value))
        fail('INVALID_DOCUMENT', 'Block property values are invalid.');
    if (
      b.content !== undefined &&
      !Array.isArray(b.content) &&
      !(record(b.content) && b.content.type === 'tableContent')
    )
      fail('INVALID_DOCUMENT', 'Block content is invalid.');
    if (Array.isArray(b.content))
      for (const item of b.content) {
        if (!record(item) || (item.type !== 'text' && item.type !== 'link'))
          fail('INVALID_DOCUMENT', 'Inline content is invalid.');
        if (item.type === 'text' && (typeof item.text !== 'string' || !record(item.styles)))
          fail('INVALID_DOCUMENT', 'Text content is invalid.');
        if (item.type === 'link' && (typeof item.href !== 'string' || !Array.isArray(item.content)))
          fail('INVALID_DOCUMENT', 'Link content is invalid.');
      }
    if (!Array.isArray(b.children)) fail('INVALID_DOCUMENT', 'Block children are invalid.');
    const children = b.children as unknown[];
    return {
      id,
      type: b.type as BlockNoteBlockSnapshot['type'],
      props: { ...props } as BlockNoteBlockSnapshot['props'],
      content: b.content as BlockNoteBlockSnapshot['content'],
      children: children.map((child) => visit(child, depth + 1)),
    };
  };
  return (value as unknown[]).map((item) => visit(item, 1));
}
export function parseCitations(value: unknown, blocks: BlockNoteBlockSnapshot[]): CitationAnchor[] {
  if (!Array.isArray(value)) fail('INVALID_DOCUMENT', 'Citations are invalid.');
  const citationValues = value as unknown[];
  if (citationValues.length > CHAPTER_MAX_CITATIONS)
    fail('PAYLOAD_TOO_LARGE', 'Chapter exceeds 10,000 citations.');
  const byId = new Map<string, BlockNoteBlockSnapshot>();
  const walk = (items: BlockNoteBlockSnapshot[]) =>
    items.forEach((block) => {
      byId.set(block.id, block);
      walk(block.children);
    });
  walk(blocks);
  const citationIds = new Set<string>();
  return citationValues.map((raw) => {
    const c = exact(
      raw,
      [
        'citationId',
        'sourceId',
        'chunkId',
        'blockId',
        'start',
        'end',
        'quotedText',
        'status',
        ...(record(raw) && 'reviewReason' in raw ? ['reviewReason'] : []),
      ],
      'Citation',
    );
    const citationId = uuid(c.citationId, 'Citation ID');
    if (citationIds.has(citationId)) fail('INVALID_DOCUMENT', 'Citation IDs must be unique.');
    citationIds.add(citationId);
    const blockId = text(c.blockId, 'Citation block ID');
    const start = uint(c.start, 'Citation start'),
      end = uint(c.end, 'Citation end');
    if (c.status !== 'valid' && c.status !== 'needs-review')
      fail('INVALID_DOCUMENT', 'Citation status is invalid.');
    const status = c.status as CitationAnchor['status'];
    const reasons = [
      'range-split',
      'text-deleted',
      'block-missing',
      'text-mismatch',
      'ambiguous-transform',
    ];
    if (status === 'valid' && c.reviewReason !== undefined)
      fail('INVALID_DOCUMENT', 'A valid citation cannot have a review reason.');
    if (
      status === 'needs-review' &&
      (typeof c.reviewReason !== 'string' || !reasons.includes(c.reviewReason))
    )
      fail('INVALID_DOCUMENT', 'A citation needing review requires a stable reason.');
    const quotedText = text(c.quotedText, 'Quoted text');
    const block = byId.get(blockId);
    if (
      status === 'valid' &&
      (!block ||
        start >= end ||
        end > plainText(block).length ||
        plainText(block).slice(start, end) !== quotedText)
    )
      fail('INVALID_DOCUMENT', 'Citation text does not match its block range.');
    return {
      citationId,
      sourceId: text(c.sourceId, 'Source ID'),
      chunkId: text(c.chunkId, 'Chunk ID'),
      blockId,
      start,
      end,
      quotedText,
      status,
      ...(c.reviewReason ? { reviewReason: c.reviewReason as CitationAnchor['reviewReason'] } : {}),
    };
  });
}
export function parseChapterDocument(
  value: unknown,
  projectId: string,
  chapterId?: string,
): ChapterDocument {
  ensureBytes(value);
  const d = exact(
    value,
    [
      'kind',
      'schemaVersion',
      'projectId',
      'chapterId',
      'outlineItemId',
      'revision',
      'editorFormat',
      'editorSchemaVersion',
      'blocks',
      'citations',
      'createdAt',
      'updatedAt',
    ],
    'Chapter',
  );
  if (
    d.kind !== CHAPTER_KIND ||
    d.schemaVersion !== CHAPTER_SCHEMA_VERSION ||
    d.editorFormat !== 'blocknote-json' ||
    d.editorSchemaVersion !== 1
  )
    fail('UNSUPPORTED_SCHEMA', 'This chapter schema is not supported.');
  if (d.projectId !== projectId || (chapterId && d.chapterId !== chapterId))
    fail('INVALID_DOCUMENT', 'Chapter identity does not match the active project.');
  const blocks = parseBlocks(d.blocks);
  return {
    ...d,
    projectId,
    chapterId: uuid(d.chapterId, 'Chapter ID'),
    outlineItemId: uuid(d.outlineItemId, 'Outline item ID'),
    revision: uint(d.revision, 'Revision'),
    blocks,
    citations: parseCitations(d.citations, blocks),
    createdAt: text(d.createdAt, 'Created time'),
    updatedAt: text(d.updatedAt, 'Updated time'),
  } as ChapterDocument;
}
export const parseOpenInput = (value: unknown): OpenChapterInput => {
  ensureBytes(value);
  const o = exact(
    value,
    ['outlineItemId', 'baseOrientationRevision', 'mutationId'],
    'Open request',
  );
  return {
    outlineItemId: uuid(o.outlineItemId, 'Outline item ID'),
    baseOrientationRevision: uint(o.baseOrientationRevision, 'Orientation revision'),
    mutationId: uuid(o.mutationId, 'Mutation ID'),
  };
};
export const parseLoadInput = (value: unknown): LoadChapterInput => {
  const o = exact(value, ['chapterId'], 'Load request');
  return { chapterId: uuid(o.chapterId, 'Chapter ID') };
};
export const parseSaveInput = (value: unknown): SaveChapterInput => {
  ensureBytes(value);
  const o = exact(
    value,
    ['chapterId', 'baseRevision', 'mutationId', 'blocks', 'citations'],
    'Save request',
  );
  const blocks = parseBlocks(o.blocks);
  return {
    chapterId: uuid(o.chapterId, 'Chapter ID'),
    baseRevision: uint(o.baseRevision, 'Base revision'),
    mutationId: uuid(o.mutationId, 'Mutation ID'),
    blocks,
    citations: parseCitations(o.citations, blocks),
  };
};
export const parsePreviewInput = (value: unknown): PreviewMarkdownExportInput => {
  ensureBytes(value);
  const o = exact(value, ['chapterId', 'blocks', 'citations'], 'Preview request');
  const blocks = parseBlocks(o.blocks);
  return {
    chapterId: uuid(o.chapterId, 'Chapter ID'),
    blocks,
    citations: parseCitations(o.citations, blocks),
  };
};
export const parseExportInput = (value: unknown): ExportMarkdownInput => {
  const o = exact(value, ['chapterId', 'previewId'], 'Export request');
  return { chapterId: uuid(o.chapterId, 'Chapter ID'), previewId: uuid(o.previewId, 'Preview ID') };
};
