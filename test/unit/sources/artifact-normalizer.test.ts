import { expect, test } from 'bun:test';
import { parseZipArchive } from '../../../src/main/sources/archive-reader';
import { normalizeMinerUArtifact } from '../../../src/main/sources/artifact-normalizer';
import {
  malformedJsonMinerUEntries,
  missingMediaMinerUEntries,
  orderedMinerUEntries,
  traversalMinerUEntries,
} from '../../fixtures/sources/mineru-fixtures';

test('rejects traversal archives, malformed schemas and duplicate remote identity', () => {
  expect(() => parseZipArchive(zip(traversalMinerUEntries()))).toThrow('SOURCE_MINERU_MALFORMED');
  expect(() => normalizeMinerUArtifact('version', malformedJsonMinerUEntries())).toThrow(
    'SOURCE_MINERU_MALFORMED',
  );
  const duplicate = orderedMinerUEntries();
  duplicate[0] = {
    ...duplicate[0],
    data: new TextEncoder().encode(
      JSON.stringify([
        { id: 'same', text: 'a' },
        { id: 'same', text: 'b' },
      ]),
    ),
  };
  expect(() => normalizeMinerUArtifact('version', duplicate)).toThrow('SOURCE_MINERU_MALFORMED');
});

test('normalizes deterministic order, identity, metadata and media integrity', () => {
  const first = normalizeMinerUArtifact('version', orderedMinerUEntries());
  const second = normalizeMinerUArtifact('version', orderedMinerUEntries());
  expect(first.blocks.map((block) => block.chunkId)).toEqual(
    second.blocks.map((block) => block.chunkId),
  );
  expect(first.blocks.map((block) => block.ordinal)).toEqual([0, 1, 2]);
  expect(first.media).toHaveLength(1);
  expect(first.blocks[2].media[0]).toMatchObject({ available: true });
  const missing = normalizeMinerUArtifact('version', missingMediaMinerUEntries());
  expect(missing.blocks[0]).toMatchObject({ structurallyValid: false, eligible: false });
});

test('accepts MinerU archives nested under the uploaded file name', () => {
  const entries = orderedMinerUEntries().map((entry) => ({
    ...entry,
    name:
      entry.name === 'content_list.json'
        ? 'source/source_content_list.json'
        : entry.name === 'full.md'
          ? 'source/source.md'
          : `source/${entry.name}`,
  }));
  const artifact = normalizeMinerUArtifact('version', entries);
  expect(artifact.blocks.map((block) => block.markdown)).toEqual(['# Title', 'Body', 'Chart']);
  expect(artifact.blocks[2].media[0]?.available).toBe(true);
});

function zip(entries: Array<{ name: string; data: Uint8Array; mode?: number }>): Uint8Array {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data);
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(0x0314, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + data.length;
  }
  const centralBuffer = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuffer, eocd]);
}
const table = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
