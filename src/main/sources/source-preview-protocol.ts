import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { ProjectSession } from '../project/project-transaction.js';
import type { SourceRepository } from './source-repository.js';

const MAX_PDF_BYTES = 200 * 1024 * 1024;
let verifiedFile: { key: string; identity: string; sha256: string } | null = null;
const headers = (length: number, origin?: string) => ({
  'Content-Type': 'application/pdf',
  'Content-Length': String(length),
  'Accept-Ranges': 'bytes',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'X-Content-Type-Options': 'nosniff',
  ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
});
const notFound = () => new Response('Not found', { status: 404 });
const rangeFailure = (size: number) =>
  new Response('Range not satisfiable', {
    status: 416,
    headers: { 'Content-Range': `bytes */${size}`, 'Cache-Control': 'no-store' },
  });

export async function sourceOriginalPreviewResponse(
  request: Request,
  options: { repository: SourceRepository; getActiveSession(): ProjectSession | null },
): Promise<Response | null> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  const match = /^\/__original__\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})\.pdf$/.exec(url.pathname);
  if (!match) return url.pathname.startsWith('/__original__') ? notFound() : null;
  if (!['GET', 'HEAD'].includes(request.method) || url.search || url.hash || !safeId(url.hostname))
    return notFound();
  const sourceId = decodeURIComponent(url.hostname);
  const versionId = match[1];
  const session = options.getActiveSession();
  if (!session) return notFound();
  try {
    const descriptor = await options.repository.resolveOriginalPdf(session, sourceId, versionId);
    if (!descriptor) return notFound();
    const info = await stat(descriptor.absolutePath);
    if (
      !info.isFile() ||
      info.size !== descriptor.sizeBytes ||
      info.size < 5 ||
      info.size > MAX_PDF_BYTES
    )
      return notFound();
    const handle = await open(descriptor.absolutePath, 'r');
    try {
      const signature = Buffer.alloc(5);
      await handle.read(signature, 0, 5, 0);
      if (signature.toString('ascii') !== '%PDF-') return notFound();
    } finally {
      await handle.close();
    }
    const verificationKey = `${session.sessionId}:${sourceId}:${versionId}`;
    const fileIdentity = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`;
    if (
      verifiedFile?.key !== verificationKey ||
      verifiedFile.identity !== fileIdentity ||
      verifiedFile.sha256 !== descriptor.sha256
    ) {
      if ((await hashFile(descriptor.absolutePath)) !== descriptor.sha256) return notFound();
      verifiedFile = { key: verificationKey, identity: fileIdentity, sha256: descriptor.sha256 };
    }
    const range = parseRange(request.headers.get('range'), info.size);
    if (range === false) return rangeFailure(info.size);
    const origin = allowedRendererOrigin(request.headers.get('origin'));
    const start = range?.start ?? 0;
    const end = range?.end ?? info.size - 1;
    const responseHeaders: Record<string, string> = { ...headers(end - start + 1, origin) };
    if (range) responseHeaders['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    if (request.method === 'HEAD')
      return new Response(null, { status: 200, headers: headers(info.size, origin) });
    const stream = createReadStream(descriptor.absolutePath, { start, end });
    return new Response(Readable.toWeb(stream) as unknown as BodyInit, {
      status: range ? 206 : 200,
      headers: responseHeaders,
    });
  } catch {
    return notFound();
  }
}

function parseRange(
  value: string | null,
  size: number,
): { start: number; end: number } | null | false {
  if (!value) return null;
  if (!value.startsWith('bytes=') || value.includes(',')) return false;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return false;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1 || suffix > size) return false;
    return { start: size - suffix, end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start ||
    end >= size
  )
    return false;
  return { start, end };
}
async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
function safeId(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}
function allowedRendererOrigin(value: string | null): string | undefined {
  if (value === 'null' || value === 'file://') return value;
  return value && /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(value)
    ? value
    : undefined;
}
