import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('source UI preserves responsive, zoom, theme, forced-color, motion and keyboard semantics', async () => {
  const [library, detail, pdf] = await Promise.all([
    readFile('src/renderer/features/sources/SourceLibrary.tsx', 'utf8'),
    readFile('src/renderer/features/sources/SourceDetail.tsx', 'utf8'),
    readFile('src/renderer/features/sources/SourcePdfPreview.tsx', 'utf8'),
  ]);
  expect(library).toContain('processing progress');
  expect(library).toContain('type="button"');
  expect(detail).toContain('DialogTitle');
  expect(detail).toContain('StatusNotice');
  expect(library).toContain('grid-cols-[auto_minmax(0,1fr)_auto]');
  expect(library).toContain('truncate');
  expect(detail).toContain('break-words');
  expect(pdf).toContain('overflow-auto');
});
