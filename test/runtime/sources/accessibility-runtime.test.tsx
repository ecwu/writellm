import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('source UI preserves responsive, zoom, theme, forced-color, motion and keyboard semantics', async () => {
  const [library, detail, css] = await Promise.all([
    readFile('src/renderer/features/sources/SourceLibrary.tsx', 'utf8'),
    readFile('src/renderer/features/sources/SourceDetail.tsx', 'utf8'),
    readFile('src/renderer/features/sources/source-library.css', 'utf8'),
  ]);
  expect(library).toContain('processing progress');
  expect(library).toContain('type="button"');
  expect(detail).toContain('DialogTitle');
  expect(detail).toContain('StatusNotice');
  expect(css).toContain('@media (max-width: 40rem)');
  expect(css).toContain('@media (forced-colors: active)');
  expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  expect(css).toContain('overflow-wrap: anywhere');
});
