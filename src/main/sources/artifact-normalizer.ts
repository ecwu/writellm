import { createHash } from 'node:crypto';
import path from 'node:path';
import type { BlockPreview } from '../../shared/sources.js';
import type { ArchiveEntry } from './archive-reader.js';

export type NormalizedBlock = BlockPreview & {
  plainText: string;
  contentHash: string;
  mediaIds: string[];
  mineruMetadata: Record<string, unknown>;
  structurallyValid: boolean;
  eligible: boolean;
};
export type NormalizedMedia = {
  mediaId: string;
  extension: 'png' | 'jpg' | 'jpeg' | 'webp';
  mimeType: string;
  sha256: string;
  alt: string;
  data: Uint8Array;
};
export type NormalizedArtifact = {
  fullMarkdown: string;
  blocks: NormalizedBlock[];
  media: NormalizedMedia[];
  rejectedBlockCount: number;
};

export function normalizeMinerUArtifact(
  sourceVersionId: string,
  entries: ArchiveEntry[],
): NormalizedArtifact {
  const byName = new Map(entries.map((entry) => [entry.name.replaceAll('\\', '/'), entry]));
  if (byName.size !== entries.length) throw malformed();
  const content = byName.get('content_list.json');
  if (!content || content.data.byteLength > 16 * 1024 * 1024) throw malformed();
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content.data));
  } catch {
    throw malformed();
  }
  if (!Array.isArray(raw) || raw.length > 10_000) throw malformed();
  const media: NormalizedMedia[] = [];
  const mediaByPath = new Map<string, NormalizedMedia>();
  for (const entry of entries) {
    const extension = path.posix.extname(entry.name).slice(1).toLowerCase();
    if (!['png', 'jpg', 'jpeg', 'webp'].includes(extension)) continue;
    const sha256 = hash(entry.data);
    const value: NormalizedMedia = {
      mediaId: `media-${sha256.slice(0, 24)}`,
      extension: extension as NormalizedMedia['extension'],
      mimeType:
        extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg',
      sha256,
      alt: '',
      data: entry.data,
    };
    media.push(value);
    mediaByPath.set(entry.name, value);
  }
  const seenRemote = new Set<string>();
  const blocks: NormalizedBlock[] = [];
  let rejectedBlockCount = 0;
  for (let remoteOrdinal = 0; remoteOrdinal < raw.length; remoteOrdinal++) {
    const value = raw[remoteOrdinal];
    if (!isRecord(value)) {
      rejectedBlockCount++;
      continue;
    }
    const remoteId = typeof value.id === 'string' ? value.id : `ordinal-${remoteOrdinal}`;
    if (seenRemote.has(remoteId)) throw malformed();
    seenRemote.add(remoteId);
    const type = normalizeType(value.type);
    const markdown = typeof value.text === 'string' ? value.text : '';
    const plainText = markdown
      .replace(/!\[[^\]]*\]\([^)]*\)|[#*_`>|~-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const imagePath =
      typeof value.image_path === 'string' ? value.image_path.replaceAll('\\', '/') : undefined;
    const relatedMedia = imagePath ? mediaByPath.get(imagePath) : undefined;
    if (relatedMedia && typeof value.text === 'string') relatedMedia.alt = value.text.slice(0, 512);
    const structurallyValid = !imagePath || Boolean(relatedMedia);
    const segments = splitMarkdown(markdown);
    if (segments.length === 0) segments.push('');
    for (let segment = 0; segment < segments.length; segment++) {
      const text = segments[segment];
      const contentHash = hash(new TextEncoder().encode(text));
      const chunkId = `chunk-${hash(new TextEncoder().encode(`${sourceVersionId}\0${remoteId}\0${segment}\0${contentHash}`)).slice(0, 24)}`;
      const metadata = boundedMetadata(value);
      const eligible = structurallyValid && plainText.length > 0 && text.length <= 64 * 1024;
      blocks.push({
        chunkId,
        ordinal: blocks.length,
        blockType: type,
        markdown: text,
        plainText,
        contentHash,
        mediaIds: relatedMedia ? [relatedMedia.mediaId] : [],
        media: relatedMedia
          ? [{ mediaId: relatedMedia.mediaId, alt: relatedMedia.alt, available: true }]
          : imagePath
            ? [{ mediaId: 'missing', alt: markdown.slice(0, 512), available: false }]
            : [],
        mineruMetadata: metadata,
        structurallyValid,
        eligible,
        searchable: false,
      });
      if (!eligible) rejectedBlockCount++;
    }
  }
  const markdownEntry = byName.get('full.md');
  const fullMarkdown =
    markdownEntry && markdownEntry.data.byteLength <= 64 * 1024 * 1024
      ? new TextDecoder('utf-8', { fatal: true }).decode(markdownEntry.data)
      : blocks.map((block) => block.markdown).join('\n\n');
  return { fullMarkdown, blocks, media, rejectedBlockCount };
}

function splitMarkdown(value: string): string[] {
  if (value.length <= 64 * 1024) return value ? [value] : [];
  const result: string[] = [];
  for (let start = 0; start < value.length; start += 64 * 1024)
    result.push(value.slice(start, start + 64 * 1024));
  return result;
}
function boundedMetadata(value: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  if (Number.isSafeInteger(value.page_idx)) metadata.page = value.page_idx;
  if (Array.isArray(value.bbox) && value.bbox.length === 4 && value.bbox.every(Number.isFinite))
    metadata.bbox = value.bbox;
  return JSON.stringify(metadata).length <= 8192 ? metadata : {};
}
function normalizeType(value: unknown): NormalizedBlock['blockType'] {
  const type = String(value ?? '').toLowerCase();
  if (['heading', 'paragraph', 'list', 'table', 'image', 'formula'].includes(type))
    return type as NormalizedBlock['blockType'];
  return 'other';
}
function hash(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
function malformed(): Error {
  return new Error('SOURCE_MINERU_MALFORMED');
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
