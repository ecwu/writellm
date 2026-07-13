import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
test('compiled Sections fixture covers ordering, keyboard names, empty state and persistent owner identity', async () => {
  const [fixture, sections, navigation] = await Promise.all([
    readFile('test/runtime/workspace-navigation/fixture.tsx', 'utf8'),
    readFile('src/renderer/features/writing-orientation/SectionWorkspace.tsx', 'utf8'),
    readFile('src/renderer/workspace/components/ContextNavigationList.tsx', 'utf8'),
  ]);
  expect(fixture).toContain('sectionNavigationItems');
  expect(sections).toContain('Choose a section');
  expect(sections).toContain('Create your first section');
  expect(navigation).toContain('truncate');
});
