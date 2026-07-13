import { expect, test } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

test('compiled renderer bundle contains no privileged source implementation', async () => {
  const assets = path.join('dist', 'assets');
  const scripts = (await readdir(assets)).filter((name) => name.endsWith('.js'));
  expect(scripts.length).toBeGreaterThan(0);
  const bundle = (
    await Promise.all(scripts.map((name) => readFile(path.join(assets, name), 'utf8')))
  ).join('\n');
  for (const forbidden of [
    'node:fs',
    'node:path',
    'ipcMain',
    'safeStorage',
    'SourceScheduler',
    'SourceJobRepository',
    'MinerUAdapter',
    'EmbeddingAdapter',
    'IndexRepository',
    'Float32Array(1024)',
    'mineru.net/api',
    'api.siliconflow.cn',
    'api.siliconflow.com',
  ])
    expect(bundle).not.toContain(forbidden);
  expect(bundle).not.toMatch(/require\(["']electron["']\)/);
  expect(bundle).not.toMatch(/from["']electron["']/);
  expect(bundle).not.toContain('source-services.json');
});
