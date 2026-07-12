import { randomUUID } from 'node:crypto';
import {
  type BlockNoteBlockSnapshot,
  CHAPTER_KIND,
  CHAPTER_SCHEMA_VERSION,
  type ChapterDocument,
  type CitationAnchor,
} from '../../../src/shared/chapters';
export const editorProjectId = randomUUID(),
  editorOutlineItemId = randomUUID(),
  editorChapterId = randomUUID();
export const paragraph = (text = 'Hello', id = randomUUID()): BlockNoteBlockSnapshot => ({
  id,
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text, styles: {} }],
  children: [],
});
export const emptyBlock = (): BlockNoteBlockSnapshot => ({
  id: randomUUID(),
  type: 'paragraph',
  props: {},
  content: [],
  children: [],
});
export const citation = (block = paragraph('evidence')): CitationAnchor => ({
  citationId: randomUUID(),
  sourceId: randomUUID(),
  chunkId: randomUUID(),
  blockId: block.id,
  start: 0,
  end: 8,
  quotedText: 'evidence',
  status: 'valid',
});
export const chapterDocument = (overrides: Partial<ChapterDocument> = {}): ChapterDocument => ({
  kind: CHAPTER_KIND,
  schemaVersion: CHAPTER_SCHEMA_VERSION,
  projectId: editorProjectId,
  chapterId: editorChapterId,
  outlineItemId: editorOutlineItemId,
  revision: 0,
  editorFormat: 'blocknote-json',
  editorSchemaVersion: 1,
  blocks: [emptyBlock()],
  citations: [],
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
  ...overrides,
});
export const twoViewInputs = () => ({
  first: {
    chapterId: editorChapterId,
    baseRevision: 0,
    mutationId: randomUUID(),
    blocks: [paragraph('first')],
    citations: [],
  },
  stale: {
    chapterId: editorChapterId,
    baseRevision: 0,
    mutationId: randomUUID(),
    blocks: [paragraph('stale')],
    citations: [],
  },
});
export const baselineMarkdown =
  '# Heading\n\n- bullet\n\n1. numbered\n\n> quote\n\n```ts\nconst x = 1\n```\n';
