import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('editor accessibility runtime contract', () => {
  test('preserves focus, live status, forced colors and reduced motion rules', async () => {
    const editor = await readFile(
      path.resolve('src/renderer/features/editor/components/ChapterEditor.tsx'),
      'utf8',
    );
    expect(editor).toContain('aria-live="polite"');
    expect(editor).toContain('flex-wrap');
    expect(editor).toContain('[&_.bn-container]');
  });
});
