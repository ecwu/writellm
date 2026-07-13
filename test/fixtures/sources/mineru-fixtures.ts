export type MinerUFixtureEntry = {
  name: string;
  data: Uint8Array;
  mode?: number;
  declaredSize?: number;
};

const bytes = (value: string) => new TextEncoder().encode(value);

export const orderedMinerUEntries = (): MinerUFixtureEntry[] => [
  {
    name: 'content_list.json',
    data: bytes(
      JSON.stringify([
        { id: 'remote-heading', type: 'heading', text: '# Title', page_idx: 0 },
        { id: 'remote-body', type: 'paragraph', text: 'Body', page_idx: 0 },
        { id: 'remote-image', type: 'image', text: 'Chart', image_path: 'images/chart.png' },
      ]),
    ),
  },
  { name: 'full.md', data: bytes('# Title\n\nBody\n\n![Chart](images/chart.png)') },
  { name: 'images/chart.png', data: Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10) },
];

export const traversalMinerUEntries = (): MinerUFixtureEntry[] => [
  { name: '../escaped.txt', data: bytes('escape') },
];
export const symlinkMinerUEntries = (): MinerUFixtureEntry[] => [
  { name: 'images/link', data: bytes('/etc/passwd'), mode: 0o120777 },
];
export const expansionMinerUEntries = (): MinerUFixtureEntry[] => [
  { name: 'huge.bin', data: bytes('small'), declaredSize: 2 * 1024 * 1024 * 1024 },
];
export const malformedJsonMinerUEntries = (): MinerUFixtureEntry[] => [
  { name: 'content_list.json', data: bytes('{not-json') },
];
export const missingMediaMinerUEntries = (): MinerUFixtureEntry[] => [
  {
    name: 'content_list.json',
    data: bytes(JSON.stringify([{ id: 'missing', type: 'image', image_path: 'missing.png' }])),
  },
];

export function storedZipFixture(entries: MinerUFixtureEntry[]): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
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
    directory.writeUInt32LE(entry.declaredSize ?? data.length, 24);
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

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
