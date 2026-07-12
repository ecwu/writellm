import { describe, expect, test } from 'bun:test';
import { blocksToMarkdown } from '../../../src/main/project/markdown-export';
import { previewMarkdownPaste } from '../../../src/renderer/features/editor/adapter/markdown-paste';
import { paragraph } from '../../fixtures/editor/chapter-fixtures';

describe('Markdown interchange', () => {
  test('normalizes async parse and warns unsupported syntax', async () => {
    const block = paragraph('text');
    const preview = await previewMarkdownPaste('<aside>x</aside>', async () => [block]);
    expect(preview.candidateBlocks).toEqual([block]);
    expect(preview.warnings[0].code).toBe('UNSUPPORTED_MARKDOWN');
  });
  test('exports readable text and warns for citations', () => {
    const block = paragraph('evidence');
    const value = blocksToMarkdown(
      [block],
      [
        {
          citationId: crypto.randomUUID(),
          sourceId: 's',
          chunkId: 'c',
          blockId: block.id,
          start: 0,
          end: 8,
          quotedText: 'evidence',
          status: 'valid',
        },
      ],
    );
    expect(value.markdown).toContain('evidence');
    expect(value.warnings[0].code).toBe('LOSSY_CITATION');
  });
});
