import JSZip from 'jszip';

export type ZipEntry = {
  path: string;
  data: Buffer;
};

export async function unzipBuffer(buffer: Buffer): Promise<ZipEntry[]> {
  const archive = await JSZip.loadAsync(buffer, { checkCRC32: true });
  const entries = await Promise.all(
    Object.values(archive.files)
      .filter((entry) => !entry.dir)
      .map(async (entry) => ({
        path: entry.name,
        data: Buffer.from(await entry.async('uint8array'))
      }))
  );
  return entries.filter((entry) => entry.path.trim());
}
