import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('1200x800, 960x640 and zoom-like layouts preserve action labels and avoid fixed rows', async () => {
  const launch = await readFile('src/renderer/launch/LaunchPage.tsx', 'utf8');
  const frame = await readFile(
    'src/renderer/workspace/components/WorkspaceNavigationFrame.tsx',
    'utf8',
  );
  expect(launch).toContain('sm:flex-row');
  expect(frame).toContain('max-[719px]');
  expect(frame).toContain('minmax(0,1fr)');
  expect(launch).toContain('flex-wrap');
});
