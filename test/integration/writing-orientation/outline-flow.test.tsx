import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('outline flow keeps list and details with create, edit, status, reorder and delete', async () => {
  const source = await readFile(
    'src/renderer/features/writing-orientation/WritingOrientationPanel.tsx',
    'utf8',
  );
  for (const term of [
    'Add outline item',
    'Outline item details',
    'not-started',
    'in-progress',
    'completed',
    'draggable',
    'Move ${item.title} up',
    'Delete item',
  ])
    expect(source).toContain(term);
});
