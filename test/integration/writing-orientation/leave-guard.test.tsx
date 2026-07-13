import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('leave guard offers Save Discard Stay and blocks failed save', async () => {
  const source = await readFile('src/renderer/workspace/WorkspaceShell.tsx', 'utf8');
  for (const term of [
    'Save and leave',
    'Discard and leave',
    'Stay',
    'if (result.ok) onLeaveWorkspace()',
    'setLeaveError(result.message)',
  ])
    expect(source).toContain(term);
});

test('category navigation does not own orientation or source mutations', async () => {
  const source = await readFile('src/renderer/workspace/WorkspaceShell.tsx', 'utf8');
  for (const mutation of [
    'deleteOutlineItem',
    'openForOutlineItem',
    'retrySource',
    'removeSource',
    'importSourcesFromDialog',
  ])
    expect(source).not.toContain(mutation);
});
