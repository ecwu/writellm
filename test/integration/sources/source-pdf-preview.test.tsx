import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
test('PDF preview uses a local worker, bounded display controls, safe errors, and cancellation', async () => {
  const source = await readFile('src/renderer/features/sources/SourcePdfPreview.tsx', 'utf8');
  for (const value of [
    'pdf.worker.mjs',
    'Previous PDF page',
    'Next PDF page',
    'Zoom out',
    'Reset zoom',
    'Zoom in',
    'PDF page viewport',
    'task?.destroy()',
    'renderTask?.cancel()',
  ])
    expect(source).toContain(value);
  for (const forbidden of ['cdn.', '<iframe', '<embed', 'print(', 'attachment'])
    expect(source).not.toContain(forbidden);
});
