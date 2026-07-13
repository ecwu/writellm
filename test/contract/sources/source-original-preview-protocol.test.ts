import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sourceOriginalPreviewResponse } from '../../../src/main/sources/source-preview-protocol';
import type { SourceRepository } from '../../../src/main/sources/source-repository';
import { smallRangedPdfFixture, tamperedPdfFixture } from '../../fixtures/sources/pdf-fixtures';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'source-preview-'));
  roots.push(root);
  const file = path.join(root, 'original.pdf');
  const bytes = smallRangedPdfFixture();
  await writeFile(file, bytes);
  const descriptor = {
    absolutePath: file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.byteLength,
    sourceRevision: 1,
  };
  const repository = {
    resolveOriginalPdf: async (_session: unknown, sourceId: string, versionId: string) =>
      sourceId === 'source' && versionId === 'version' ? descriptor : null,
  } as unknown as SourceRepository;
  const options = {
    repository,
    getActiveSession: () => ({ projectId: 'project', projectRoot: root, sessionId: 'session' }),
  };
  return { bytes, file, options };
}
describe('original PDF protocol', () => {
  test('serves HEAD, full and single bounded ranges with safe headers', async () => {
    const { bytes, options } = await fixture();
    const url = 'writellm-source://source/__original__/version.pdf';
    const head = await sourceOriginalPreviewResponse(new Request(url, { method: 'HEAD' }), options);
    expect(head?.status).toBe(200);
    expect(head?.headers.get('content-length')).toBe(String(bytes.byteLength));
    const full = await sourceOriginalPreviewResponse(
      new Request(url, { headers: { Origin: 'http://127.0.0.1:5173' } }),
      options,
    );
    expect(full?.status).toBe(200);
    expect(full?.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173');
    expect(new Uint8Array(await full!.arrayBuffer())).toEqual(bytes);
    const ranged = await sourceOriginalPreviewResponse(
      new Request(url, { headers: { Range: 'bytes=2-8' } }),
      options,
    );
    expect(ranged?.status).toBe(206);
    expect(ranged?.headers.get('content-range')).toBe(`bytes 2-8/${bytes.byteLength}`);
    expect(new Uint8Array(await ranged!.arrayBuffer())).toEqual(bytes.slice(2, 9));
    const untrustedOrigin = await sourceOriginalPreviewResponse(
      new Request(url, { headers: { Origin: 'https://example.com' } }),
      options,
    );
    expect(untrustedOrigin?.headers.has('access-control-allow-origin')).toBe(false);
  });
  test('normalizes route, session, version, malformed ranges and tampering', async () => {
    const { file, options } = await fixture();
    for (const url of [
      'writellm-source://source/__original__/stale.pdf',
      'writellm-source://source/__original__/version.txt',
      'writellm-source://source/__original__/version.pdf?path=x',
    ])
      expect((await sourceOriginalPreviewResponse(new Request(url), options))?.status).toBe(404);
    expect(
      (
        await sourceOriginalPreviewResponse(
          new Request('writellm-source://source/__original__/version.pdf', {
            headers: { Range: 'bytes=1-2,4-5' },
          }),
          options,
        )
      )?.status,
    ).toBe(416);
    await writeFile(file, tamperedPdfFixture());
    expect(
      (
        await sourceOriginalPreviewResponse(
          new Request('writellm-source://source/__original__/version.pdf'),
          options,
        )
      )?.status,
    ).toBe(404);
    expect(
      (
        await sourceOriginalPreviewResponse(
          new Request('writellm-source://source/__original__/version.pdf'),
          { ...options, getActiveSession: () => null },
        )
      )?.status,
    ).toBe(404);
  });
});
