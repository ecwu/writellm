import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { inflateRaw, inflateRawSync } from 'node:zlib';

export type ArchiveEntry = { name: string; data: Uint8Array };
const MAX_ENTRIES = 10_000;
const MAX_ENTRY_BYTES = 100 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 1024 * 1024 * 1024;
const ACTIVE_EXTENSIONS = new Set(['.html', '.htm', '.svg', '.js', '.mjs', '.css', '.xml']);
const inflateRawAsync = promisify(inflateRaw);

export async function readZipArchive(archivePath: string): Promise<ArchiveEntry[]> {
  const bytes = Buffer.from(await readFile(archivePath));
  const descriptors = describeArchive(bytes);
  const entries: ArchiveEntry[] = [];
  for (const descriptor of descriptors) {
    let data: Buffer;
    if (descriptor.method === 0) data = Buffer.from(descriptor.compressed);
    else {
      try {
        data = await inflateRawAsync(descriptor.compressed, { maxOutputLength: MAX_ENTRY_BYTES });
      } catch {
        throw invalid();
      }
    }
    validateExpandedEntry(descriptor, data);
    if (!descriptor.name.endsWith('/')) entries.push({ name: descriptor.name, data });
  }
  return entries;
}

export function parseZipArchive(input: Uint8Array): ArchiveEntry[] {
  const bytes = Buffer.from(input);
  return describeArchive(bytes).flatMap((descriptor) => {
    let data: Buffer;
    if (descriptor.method === 0) data = Buffer.from(descriptor.compressed);
    else {
      try {
        data = inflateRawSync(descriptor.compressed, { maxOutputLength: MAX_ENTRY_BYTES });
      } catch {
        throw invalid();
      }
    }
    validateExpandedEntry(descriptor, data);
    return descriptor.name.endsWith('/') ? [] : [{ name: descriptor.name, data }];
  });
}

type ArchiveDescriptor = {
  name: string;
  method: 0 | 8;
  crc: number;
  uncompressedSize: number;
  compressed: Buffer;
};

function describeArchive(bytes: Buffer): ArchiveDescriptor[] {
  const eocd = findSignature(bytes, 0x06054b50, Math.max(0, bytes.length - 65_557));
  if (eocd < 0 || eocd + 22 > bytes.length) throw invalid();
  const count = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES || centralOffset + centralSize > eocd) throw invalid();
  const entries: ArchiveDescriptor[] = [];
  const names = new Set<string>();
  let offset = centralOffset;
  let expanded = 0;
  for (let index = 0; index < count; index++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50 || offset + 46 > bytes.length) throw invalid();
    const method = bytes.readUInt16LE(offset + 10);
    const crc = bytes.readUInt32LE(offset + 16);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const externalAttributes = bytes.readUInt32LE(offset + 38);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    validateName(name);
    if (names.has(name) || ((externalAttributes >>> 16) & 0o170000) === 0o120000) throw invalid();
    names.add(name);
    if (
      uncompressedSize > MAX_ENTRY_BYTES ||
      (uncompressedSize > compressedSize * 200 && uncompressedSize > 1024 * 1024)
    )
      throw invalid();
    expanded += uncompressedSize;
    if (expanded > MAX_EXPANDED_BYTES) throw invalid();
    if (bytes.readUInt32LE(localOffset) !== 0x04034b50) throw invalid();
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    if (compressed.length !== compressedSize) throw invalid();
    if (method !== 0 && method !== 8) throw invalid();
    entries.push({ name, method, crc, uncompressedSize, compressed });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== centralOffset + centralSize) throw invalid();
  return entries;
}

function validateExpandedEntry(descriptor: ArchiveDescriptor, data: Buffer): void {
  if (data.length !== descriptor.uncompressedSize || crc32(data) !== descriptor.crc)
    throw invalid();
}

function validateName(name: string): void {
  const normalized = name.replaceAll('\\', '/');
  if (
    !name ||
    name.includes('\0') ||
    path.posix.isAbsolute(normalized) ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split('/').some((part) => part === '..') ||
    ACTIVE_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase())
  )
    throw invalid();
}
function findSignature(bytes: Buffer, signature: number, start: number): number {
  for (let offset = bytes.length - 4; offset >= start; offset--)
    if (bytes.readUInt32LE(offset) === signature) return offset;
  return -1;
}
function invalid(): Error {
  return new Error('SOURCE_MINERU_MALFORMED');
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
