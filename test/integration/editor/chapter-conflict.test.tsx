import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('chapter conflict integration', () => {
  test('offers explicit keep-current and reload-saved paths', async () => {
    const source = await readFile(
      path.resolve('src/renderer/features/editor/components/ChapterEditor.tsx'),
      'utf8',
    );
    expect(source).toContain('keepCurrent');
    expect(source).toContain('reloadSaved');
    const dialog = await readFile(
      path.resolve('src/renderer/features/editor/components/ChapterConflictDialog.tsx'),
      'utf8',
    );
    expect(dialog).toContain('Keep current draft');
    expect(dialog).toContain('Reload saved');
  });
});
