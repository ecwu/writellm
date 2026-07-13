import { expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SourceServiceCredentials } from '../../../src/main/sources/service-credentials';

const SENTINELS = {
  credential: 'credential-SENTINEL-never-render',
  absolutePath: '/private/SENTINEL/source.pdf',
  remoteId: 'remote-SENTINEL-batch',
  resultUrl: 'https://example.invalid/SENTINEL/archive.zip',
  rawBody: 'raw-SENTINEL-provider-body',
  vector: 'vector-SENTINEL-payload',
  archive: 'archive-SENTINEL-temporary',
} as const;

test('credentials remain protected and renderer-facing source code exposes only redacted DTOs', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'source-redaction-'));
  const credentials = new SourceServiceCredentials(
    directory,
    {
      available: async () => true,
      protect: async () => 'opaque-protected-value',
      unprotect: async () => SENTINELS.credential,
    },
    () => 'credential-revision',
    () => '2026-01-01T00:00:00.000Z',
  );
  await credentials.initialize();
  const saved = await credentials.save('mineru', null, SENTINELS.credential);
  expect(saved).toMatchObject({
    status: 'saved',
    summary: { configured: true, available: false, revision: 'credential-revision' },
  });
  const persisted = await readFile(path.join(directory, 'source-services.json'), 'utf8');
  expect(persisted).not.toContain(SENTINELS.credential);
  expect(JSON.stringify(saved)).not.toContain(SENTINELS.credential);

  const rendererBoundary = await Promise.all(
    [
      'src/shared/sources.ts',
      'src/preload/preload.cts',
      'src/main/sources/handlers.ts',
      'src/renderer/features/sources/SourceLibrary.tsx',
      'src/renderer/features/sources/SourceDetail.tsx',
    ].map((file) => readFile(file, 'utf8')),
  );
  const exposed = rendererBoundary.join('\n');
  for (const forbiddenField of [
    'absolutePath',
    'remoteBatchId',
    'resultUrl',
    'resultArchive',
    'Float32Array',
  ])
    expect(exposed).not.toContain(forbiddenField);
  for (const sentinel of Object.values(SENTINELS)) expect(exposed).not.toContain(sentinel);
});

test('temporary service material has no renderer, export, diagnostic, log, or project-history route', async () => {
  const sourceFiles = await collectFiles('src/main/sources');
  const boundaryFiles = [
    ...sourceFiles,
    'src/shared/sources.ts',
    'src/preload/preload.cts',
    'src/main/project/git-repository.ts',
  ];
  const text = (await Promise.all(boundaryFiles.map((file) => readFile(file, 'utf8')))).join('\n');
  expect(text).not.toMatch(/console\.(?:log|info|debug)\s*\(/);
  expect(text).not.toMatch(
    /export(?:Markdown|Project|Bundle).*(?:credential|remoteBatchId|resultUrl)/s,
  );
  expect(text).toContain('runtime/embeddings/');
  expect(text).toContain('runtime/logs/');
  expect(text).toContain('secrets/');
  expect(text).toContain("'runtime', 'source-downloads'");
  for (const sentinel of Object.values(SENTINELS)) expect(text).not.toContain(sentinel);
});

async function collectFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await collectFiles(target)));
    else if (/\.(?:ts|tsx|cts)$/.test(entry.name)) result.push(target);
  }
  return result;
}
