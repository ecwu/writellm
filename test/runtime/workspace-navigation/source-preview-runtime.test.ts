import { expect, test } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
test('compiled PDF boundary is local, offline, range-streamed, version-fenced and plugin-free', async () => {
  const [protocol, repository, main, preview, assets] = await Promise.all([
    readFile('src/main/sources/source-preview-protocol.ts', 'utf8'),
    readFile('src/main/sources/source-repository.ts', 'utf8'),
    readFile('src/main/main.ts', 'utf8'),
    readFile('src/renderer/features/sources/SourcePdfPreview.tsx', 'utf8'),
    readdir('dist/assets').catch(() => []),
  ]);
  for (const value of [
    'createReadStream',
    'Content-Range',
    'Accept-Ranges',
    'MAX_PDF_BYTES',
    '%PDF-',
    'sha256',
    'session.sessionId',
  ])
    expect(protocol).toContain(value);
  expect(repository).toContain('document.currentVersionId !== sourceVersionId');
  expect(main).toContain('webviewTag: false');
  expect(main).not.toContain('plugins: true');
  expect(preview).not.toContain('http://');
  expect(preview).not.toContain('https://');
  expect(assets.some((asset) => asset.startsWith('pdf.worker-'))).toBeTrue();
});
