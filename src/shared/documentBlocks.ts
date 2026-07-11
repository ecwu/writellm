import type { DocumentBlockKind, DocumentBlockRecord } from './types.js';

export type DraftDocumentBlock = {
  kind: DocumentBlockKind;
  content: string;
  attributes: Record<string, unknown>;
};

export type BlockDocumentSnapshot = {
  version: 1;
  sections: Array<{
    id: string;
    parentId: string | null;
    title: string;
    intent: string | null;
    description: string | null;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
  }>;
  blocks: DocumentBlockRecord[];
};

/**
 * Splits Markdown into independent, ordered document blocks without rewriting
 * the text payload. Whitespace between blocks is carried by the following
 * block so serializing the result round-trips the source text exactly.
 */
export function blocksFromMarkdown(markdown: string): DraftDocumentBlock[] {
  const normalized = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized) {
    return [];
  }

  const parts = normalized.split(/(\n{2,})/);
  const blocks: DraftDocumentBlock[] = [];
  let leadingNewlines = '';

  for (const part of parts) {
    if (!part) {
      continue;
    }
    if (/^\n+$/.test(part)) {
      leadingNewlines += part;
      continue;
    }
    blocks.push({
      kind: classifyMarkdownBlock(part),
      content: part,
      attributes: leadingNewlines ? { leadingNewlines } : {}
    });
    leadingNewlines = '';
  }

  if (blocks.length === 0) {
    return [{ kind: 'paragraph', content: normalized, attributes: {} }];
  }
  if (leadingNewlines) {
    blocks[blocks.length - 1].attributes.trailingNewlines = leadingNewlines;
  }
  return blocks;
}

export function markdownFromBlocks(blocks: readonly DocumentBlockRecord[]): string {
  return [...blocks]
    .sort(compareDocumentBlockOrder)
    .map((block) => `${readSpacing(block.attributes, 'leadingNewlines')}${block.content}`)
    .join('')
    .concat(blocks.length > 0 ? readSpacing([...blocks].sort(compareDocumentBlockOrder).at(-1)?.attributes ?? {}, 'trailingNewlines') : '');
}

export function markdownFromSnapshotSection(snapshot: BlockDocumentSnapshot, sectionId: string): string {
  return markdownFromBlocks(snapshot.blocks.filter((block) => block.sectionId === sectionId));
}

export function parseBlockDocumentSnapshot(value: string): BlockDocumentSnapshot | null {
  try {
    const parsed = JSON.parse(value) as Partial<BlockDocumentSnapshot>;
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.sections) ||
      !Array.isArray(parsed.blocks)
    ) {
      return null;
    }
    return parsed as BlockDocumentSnapshot;
  } catch {
    return null;
  }
}

export function compareDocumentBlockOrder(left: DocumentBlockRecord, right: DocumentBlockRecord): number {
  return left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function classifyMarkdownBlock(content: string): DocumentBlockKind {
  if (/^ {0,3}#{1,6}(?:\s|$)/.test(content)) {
    return 'heading';
  }
  if (/^ {0,3}>/.test(content)) {
    return 'quote';
  }
  if (/^ {0,3}(`{3,}|~{3,})/.test(content)) {
    return 'code';
  }
  if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(content)) {
    return 'list_item';
  }
  if (/^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(content)) {
    return 'divider';
  }
  if (/^!\[[^\]]*\]\([^\s)]+(?:\s+['"][^'"]*['"])?\)$/.test(content.trim())) {
    return 'image';
  }
  return 'paragraph';
}

function readSpacing(attributes: Record<string, unknown>, key: 'leadingNewlines' | 'trailingNewlines'): string {
  const value = attributes[key];
  return typeof value === 'string' && /^\n*$/.test(value) ? value : '';
}
