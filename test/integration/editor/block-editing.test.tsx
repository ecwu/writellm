import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('editor composition', () => {
  test('uses the frozen BlockNote schema, accessible status and citation feedback', async () => {
    const source = await readFile(
      path.resolve('src/renderer/features/editor/components/ChapterEditor.tsx'),
      'utf8',
    );
    const compact = source.replace(/\s/g, '');
    for (const type of [
      'paragraph',
      'heading',
      'bulletListItem',
      'numberedListItem',
      'checkListItem',
      'table',
      'codeBlock',
      'quote',
      'image',
    ])
      expect(compact).toContain(`${type}:defaultBlockSpecs.${type}`);
    expect(compact).toContain('aria-live="polite"');
    expect(compact).toContain('citationsneedreview');
  });
});
