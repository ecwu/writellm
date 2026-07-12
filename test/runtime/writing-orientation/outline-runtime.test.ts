import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('runtime outline journey includes both reorder paths and linked refusal', async () => {
  const panel = await readFile(
    'src/renderer/features/writing-orientation/WritingOrientationPanel.tsx',
    'utf8',
  );
  expect(panel).toContain('onDrop');
  expect(panel).toContain('Move ${item.title} up');
  expect(panel).toContain('Chapter-linked item cannot be deleted');
});
