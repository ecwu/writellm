import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('workspace itself adds no preload namespace or IPC channel', async () => {
  const preload = await readFile('src/preload/preload.cts', 'utf8');
  expect((preload.match(/exposeInMainWorld/g) ?? []).length).toBe(7);
  expect(preload).toContain("exposeInMainWorld('writellmChapters'");
  expect(preload).toContain("exposeInMainWorld('writellmSources'");
  expect(preload).toContain("exposeInMainWorld('writellmSourceServices'");
  for (const term of ['workspace', 'panel', 'focusReturn'])
    expect(preload.toLowerCase()).not.toContain(term.toLowerCase());
});

test('navigation and PDF display add no generic IPC, path, or byte preload method', async () => {
  const [preload, shell, preview] = await Promise.all([
    readFile('src/preload/preload.cts', 'utf8'),
    readFile('src/renderer/workspace/WorkspaceShell.tsx', 'utf8'),
    readFile('src/renderer/features/sources/SourcePdfPreview.tsx', 'utf8'),
  ]);
  for (const forbidden of ['readFile', 'resolvePath', 'getPdfBytes', 'invoke(channel'])
    expect(preload).not.toContain(forbidden);
  expect(shell).toContain('workspaceNavigationSessionReducer');
  expect(preview).toContain('writellm-source://');
});
