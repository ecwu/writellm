import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppearancePreferencesRepository } from '../../../src/main/appearance/appearance-preferences';
import { defaultAppearancePreferences } from '../../../src/shared/appearance';

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))),
);
async function repo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'appearance-'));
  roots.push(root);
  return { root, value: new AppearancePreferencesRepository(root) };
}
describe('appearance repository', () => {
  test('missing uses defaults and update atomically publishes a complete snapshot', async () => {
    const { value } = await repo();
    expect((await value.initialize()).preferences).toEqual(defaultAppearancePreferences);
    const next = { ...defaultAppearancePreferences, themeMode: 'dark' as const };
    const { schemaVersion: _, ...input } = next;
    expect((await value.update(input)).status).toBe('updated');
    expect(JSON.parse(await readFile(value.filePath, 'utf8'))).toEqual(next);
  });
  test('corrupt and unsupported files warn without overwrite', async () => {
    for (const raw of [
      '{broken',
      JSON.stringify({ ...defaultAppearancePreferences, schemaVersion: 2 }),
    ]) {
      const { root, value } = await repo();
      await writeFile(path.join(root, 'appearance-preferences.json'), raw);
      const result = await value.initialize();
      expect(result.warning).toBeDefined();
      expect(result.preferences).toEqual(defaultAppearancePreferences);
      expect(await readFile(value.filePath, 'utf8')).toBe(raw);
    }
  });
  test('rejects invalid renderer input', async () => {
    const { value } = await repo();
    await value.initialize();
    expect(await value.update({ themeMode: 'dark' })).toMatchObject({
      status: 'error',
      error: { code: 'APPEARANCE_INVALID_INPUT' },
    });
  });
});
