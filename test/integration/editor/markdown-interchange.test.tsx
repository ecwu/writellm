import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('Markdown UI isolation', () => {
  test('requires confirmation and separates export feedback', async () => {
    const editor = await readFile(
      path.resolve('src/renderer/features/editor/components/ChapterEditor.tsx'),
      'utf8',
    );
    expect(editor).toContain('MarkdownPasteDialog');
    expect(editor).toContain('MarkdownExportDialog');
    const paste = await readFile(
      path.resolve('src/renderer/features/editor/components/MarkdownPasteDialog.tsx'),
      'utf8',
    );
    expect(paste).toContain('Insert converted blocks');
    expect(paste).toContain('Cancel');
  });
});
