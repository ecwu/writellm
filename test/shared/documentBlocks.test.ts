import { describe, expect, test } from 'bun:test';
import { blocksFromMarkdown, markdownFromBlocks } from '../../src/shared/documentBlocks.js';

describe('block document serialization', () => {
  test('preserves Markdown text and whitespace across typed block boundaries', () => {
    const markdown = '# Heading\n\nParagraph with [src.c1].\n\n> A quote\n\n```ts\nconst value = 1;\n```\n';
    const draftBlocks = blocksFromMarkdown(markdown);
    const blocks = draftBlocks.map((block, index) => ({
      id: `block-${index}`,
      sectionId: 'section-1',
      parentId: null,
      kind: block.kind,
      content: block.content,
      attributes: block.attributes,
      sortOrder: index,
      createdAt: `2026-07-11T00:00:0${index}.000Z`,
      updatedAt: `2026-07-11T00:00:0${index}.000Z`
    }));

    expect(draftBlocks.map((block) => block.kind)).toEqual(['heading', 'paragraph', 'quote', 'code']);
    expect(markdownFromBlocks(blocks)).toBe(markdown);
  });
});
