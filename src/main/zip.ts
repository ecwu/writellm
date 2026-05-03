import { inflateRawSync } from 'node:zlib';

export type ZipEntry = {
  path: string;
  data: Buffer;
};

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

export function unzipBuffer(buffer: Buffer): ZipEntry[] {
  const centralDirectoryOffset = findCentralDirectoryOffset(buffer);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;

  while (offset + 46 <= buffer.length && buffer.readUInt32LE(offset) === CENTRAL_DIRECTORY_HEADER) {
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8');
    offset += 46 + fileNameLength + extraLength + commentLength;

    if (!fileName || fileName.endsWith('/')) {
      continue;
    }
    entries.push({
      path: fileName,
      data: readLocalEntry(buffer, localHeaderOffset, compressionMethod, compressedSize, uncompressedSize)
    });
  }

  return entries;
}

function findCentralDirectoryOffset(buffer: Buffer): number {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
      return buffer.readUInt32LE(offset + 16);
    }
  }
  throw new Error('Invalid zip archive: central directory not found.');
}

function readLocalEntry(
  buffer: Buffer,
  localHeaderOffset: number,
  compressionMethod: number,
  compressedSize: number,
  uncompressedSize: number
): Buffer {
  if (buffer.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER) {
    throw new Error('Invalid zip archive: local file header not found.');
  }
  const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

  if (compressionMethod === 0) {
    return Buffer.from(compressed);
  }
  if (compressionMethod === 8) {
    const inflated = inflateRawSync(compressed);
    if (uncompressedSize > 0 && inflated.length !== uncompressedSize) {
      throw new Error('Invalid zip archive: inflated size mismatch.');
    }
    return inflated;
  }
  throw new Error(`Unsupported zip compression method: ${compressionMethod}`);
}
