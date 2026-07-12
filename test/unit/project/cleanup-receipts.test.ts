import { expect, test } from 'bun:test';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CleanupReceipts } from '../../../src/main/project/cleanup-receipts';

test('cleanup receipts remove only an authorized tokenized incomplete root', async () => {
  const userData = await os.tmpdir();
  const root = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(path.join(userData, 'writellm-receipt-')));
  const receipts = new CleanupReceipts(root);
  const finalRoot = path.join(root, 'unfinished.writellm');
  const receipt = await receipts.add(finalRoot);
  await mkdir(finalRoot, { recursive: true });
  await writeFile(path.join(finalRoot, `project.json.${receipt.token}.tmp`), '{}');
  await receipts.cleanup();
  await expect(readdir(finalRoot)).rejects.toThrow();
});

