import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('compiled source bridge and main import boundary support non-blocking bounded recovery', async () => {
  const [preload, main, handlers, imports] = await Promise.all([
    readFile('dist-electron/preload/preload.cjs', 'utf8'),
    readFile('dist-electron/main/main.js', 'utf8'),
    readFile('dist-electron/main/sources/handlers.js', 'utf8'),
    readFile('src/main/sources/import-service.ts', 'utf8'),
  ]);
  for (const method of [
    'listSources',
    'importSourcesFromDialog',
    'removeSource',
    'subscribeSourceEvents',
  ])
    expect(preload).toContain(method);
  expect(main).toContain('registerSourceHandlers');
  expect(handlers).toContain('sourceChannels.importDialog');
  expect(imports).toContain('slice(0, 100)');
  expect(imports).toContain('SOURCE_LIMIT_EXCEEDED');
  expect(imports).toContain("candidateStatus: 'duplicate-confirmed'");
  expect(imports).toContain('active?.sessionId === session.sessionId');
  expect(imports.indexOf('return { status:')).toBeLessThan(
    imports.indexOf('private async process'),
  );
});
