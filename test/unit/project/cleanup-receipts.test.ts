import { expect, test } from 'bun:test';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CleanupReceipts } from '../../../src/main/project/cleanup-receipts';

test('cleanup receipts remove only an authorized tokenized incomplete root', async () => {
  const userData = await os.tmpdir();
  const root = await import('node:fs/promises').then(({ mkdtemp }) =>
    mkdtemp(path.join(userData, 'writellm-receipt-')),
  );
  const receipts = new CleanupReceipts(root);
  const finalRoot = path.join(root, 'unfinished.writellm');
  const receipt = await receipts.add(finalRoot);
  await mkdir(finalRoot, { recursive: true });
  await writeFile(path.join(finalRoot, `project.json.${receipt.token}.tmp`), '{}');
  await receipts.cleanup();
  await expect(readdir(finalRoot)).rejects.toThrow();
});

test('persisted receipt token is the cleanup authorization token', async () => {
  const root = await import('node:fs/promises').then(({ mkdtemp }) =>
    mkdtemp(path.join(os.tmpdir(), 'writellm-receipt-token-')),
  );
  const receipts = new CleanupReceipts(root);
  const receipt = await receipts.add(path.join(root, 'pending.writellm'));
  const persisted = JSON.parse(
    await readFile(path.join(root, 'pending-project-cleanups.json'), 'utf8'),
  );
  expect(persisted.receipts[0].token).toBe(receipt.token);
});

test('one malformed receipt invalidates the whole index and authorizes no cleanup', async () => {
  const root = await import('node:fs/promises').then(({ mkdtemp }) =>
    mkdtemp(path.join(os.tmpdir(), 'writellm-receipt-corrupt-')),
  );
  const finalRoot = path.join(root, 'retain.writellm');
  await mkdir(finalRoot);
  const token = crypto.randomUUID();
  await writeFile(path.join(finalRoot, `project.json.${token}.tmp`), '{}');
  await writeFile(
    path.join(root, 'pending-project-cleanups.json'),
    JSON.stringify({
      kind: 'writellm.pending-project-cleanups',
      schemaVersion: 1,
      receipts: [
        { finalRoot, token, createdAt: '2026-07-12T00:00:00.000Z' },
        { finalRoot: 'relative/path', token: crypto.randomUUID(), createdAt: 'invalid' },
      ],
    }),
  );
  const receipts = new CleanupReceipts(root);
  await receipts.load();
  await receipts.cleanup();
  expect(await readdir(finalRoot)).toContain(`project.json.${token}.tmp`);
  expect(receipts.warning).toContain('safely');
});
