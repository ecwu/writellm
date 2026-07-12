import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('runtime harness verifies first-paint owner and bridge inventories', async () => {
  const main = await readFile('src/main/main.ts', 'utf8');
  expect(main.indexOf('nativeTheme.themeSource')).toBeLessThan(
    main.indexOf('await ensureWindow()'),
  );
  const preload = await readFile('src/preload/preload.cts', 'utf8');
  expect(preload.match(/exposeInMainWorld/g) ?? []).toHaveLength(5);
  expect(preload).toContain("exposeInMainWorld('writellmAppearance'");
  expect(preload).toContain("exposeInMainWorld('writellmChapters'");
});
