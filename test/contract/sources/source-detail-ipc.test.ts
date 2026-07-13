import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('source detail contract is bounded text-only and excludes paths and remote identity', async () => {
  const [shared, handlers] = await Promise.all([
    readFile('src/shared/sources.ts', 'utf8'),
    readFile('src/main/sources/handlers.ts', 'utf8'),
  ]);
  expect(shared).toContain('(value.limit as number) > 100');
  expect(shared).not.toContain('remoteBatchId: string;');
  expect(handlers).toContain('blockType, markdown, media, searchable');
  expect(handlers).not.toContain('absolutePath');
  expect(handlers).not.toContain('resultUrl');
  expect(handlers).not.toContain('plainText, contentHash');
  for (const field of [
    'sourceVersionId',
    'originalPreviewAvailable',
    'indexedBlockCount',
    'failedBlockCount',
    'incompleteBlockCount',
  ])
    expect(shared).toContain(field);
  expect(handlers).toContain('page.sourceVersionId !== source.sourceVersionId');
  expect(handlers).toContain("status: 'conflict'");
});
