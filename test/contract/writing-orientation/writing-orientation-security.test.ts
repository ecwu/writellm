import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('security boundary stays sandboxed without renderer storage authority', async () => {
  const main = await readFile('src/main/main.ts', 'utf8'),
    shared = await readFile('src/shared/writing-orientation.ts', 'utf8');
  expect(main).toContain('contextIsolation: true');
  expect(main).toContain('nodeIntegration: false');
  expect(main).toContain('sandbox: true');
  for (const term of ['projectroot', 'filesystem', 'repository handle', 'git command'])
    expect(shared.toLowerCase()).not.toContain(term);
});
