import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Protocol } from 'electron';
import type { ProjectSession } from '../project/project-transaction.js';
import type { SourceRepository } from './source-repository.js';
import { sourceOriginalPreviewResponse } from './source-preview-protocol.js';

export function registerSourceMediaProtocol(options: {
  protocol: Pick<Protocol, 'handle'>;
  repository: SourceRepository;
  getActiveSession(): ProjectSession | null;
}): void {
  options.protocol.handle('writellm-source', async (request) => {
    try {
      const original = await sourceOriginalPreviewResponse(request, options);
      if (original) return original;
      const url = new URL(request.url);
      const sourceId = decodeURIComponent(url.hostname);
      const mediaId = decodeURIComponent(url.pathname.replace(/^\//, ''));
      if (!safeId(sourceId) || !safeId(mediaId) || url.search || url.hash)
        return new Response('Not found', { status: 404 });
      const session = options.getActiveSession();
      if (!session) return new Response('Not found', { status: 404 });
      const media = await options.repository.resolveMedia(session, sourceId, mediaId);
      if (!media) return new Response('Not found', { status: 404 });
      const bytes = await readFile(media.absolutePath);
      if (createHash('sha256').update(bytes).digest('hex') !== media.sha256)
        return new Response('Not found', { status: 404 });
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': media.mimeType,
          'Content-Length': String(bytes.byteLength),
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}
function safeId(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
}
