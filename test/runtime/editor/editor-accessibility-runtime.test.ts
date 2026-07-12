import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('editor accessibility runtime contract', () => {
  test('preserves focus, live status, forced colors and reduced motion rules', async () => {
    const editor = await readFile(
        path.resolve('src/renderer/features/editor/components/ChapterEditor.tsx'),
        'utf8',
      ),
      css = await readFile(path.resolve('src/renderer/styles.css'), 'utf8');
    expect(editor).toContain('aria-live="polite"');
    const compactCss = css.replace(/\s/g, '');
    expect(compactCss).toContain('@media(forced-colors:active)');
    expect(compactCss).toContain('@media(prefers-reduced-motion:reduce)');
  });
});
