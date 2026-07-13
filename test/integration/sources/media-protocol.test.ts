import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerSourceMediaProtocol } from '../../../src/main/sources/media-protocol';
import type { SourceRepository } from '../../../src/main/sources/source-repository';

test('serves only active-project hash-validated media identities', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'source-media-'));
  const file = path.join(root, 'media.png');
  const bytes = Uint8Array.of(137, 80, 78, 71);
  await writeFile(file, bytes);
  let handler: ((request: Request) => Promise<Response>) | undefined;
  registerSourceMediaProtocol({
    protocol: {
      handle: (_scheme, next) => {
        handler = next as typeof handler;
      },
    },
    repository: {
      resolveMedia: async (_session: unknown, _source: string, mediaId: string) =>
        mediaId === 'media'
          ? {
              absolutePath: file,
              mimeType: 'image/png',
              sha256: createHash('sha256').update(bytes).digest('hex'),
            }
          : null,
    } as unknown as SourceRepository,
    getActiveSession: () => ({ projectId: 'project', projectRoot: root, sessionId: 'session' }),
  });
  const response = await handler?.(new Request('writellm-source://source/media'));
  expect(response?.status).toBe(200);
  expect(response?.headers.get('content-type')).toBe('image/png');
  const rejected = await handler?.(new Request('writellm-source://source/../secret'));
  expect(rejected?.status).toBe(404);
});
