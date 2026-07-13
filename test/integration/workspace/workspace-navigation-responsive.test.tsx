import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
test('constrained navigation uses labeled strip, list/detail disclosure, Back, inertness and utility-owned layout', async () => {
  const [frame, location, section] = await Promise.all([
    readFile('src/renderer/workspace/components/WorkspaceNavigationFrame.tsx', 'utf8'),
    readFile('src/renderer/workspace/components/WorkspaceLocationHeader.tsx', 'utf8'),
    readFile('src/renderer/features/writing-orientation/SectionWorkspace.tsx', 'utf8'),
  ]);
  for (const value of [
    'max-[719px]',
    'data-compact-pane',
    'invisible',
    'pointer-events-none',
    'group-data-[sidebar-expanded=false]/workspace:grid-cols-[0_minmax(0,1fr)]',
  ])
    expect(`${frame}\n${section}`).toContain(value);
  expect(frame).toContain('inert={settingsOpen');
  expect(location).toContain('Back to {category}');
});

test('desktop navigation reserves header space and hides the compact Back action', async () => {
  const location = await readFile(
    'src/renderer/workspace/components/WorkspaceLocationHeader.tsx',
    'utf8',
  );
  expect(location).toContain('hidden max-[719px]:inline-flex');
  expect(location).toContain('max-[719px]:hidden');
  expect(location).toContain('px-4');
});
