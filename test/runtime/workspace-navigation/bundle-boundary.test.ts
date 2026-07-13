import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
test('workspace bundle boundary excludes parallel navigation, persistence, generic bridges and AI placeholders', async () => {
  const [pkg, shell, session, frame, preload, app] = await Promise.all([
    readFile('package.json', 'utf8'),
    readFile('src/renderer/workspace/WorkspaceShell.tsx', 'utf8'),
    readFile('src/renderer/workspace/workspaceNavigationSession.ts', 'utf8'),
    readFile('src/renderer/workspace/components/WorkspaceNavigationFrame.tsx', 'utf8'),
    readFile('src/preload/preload.cts', 'utf8'),
    readFile('src/renderer/App.tsx', 'utf8'),
  ]);
  for (const forbidden of [
    'react-router',
    '@radix-ui',
    'sidebar_state',
    'localStorage',
    'Control+B',
    'Meta+B',
    'AI agent placeholder',
  ])
    expect(`${pkg}\n${shell}\n${session}\n${frame}\n${app}`).not.toContain(forbidden);
  expect(preload).not.toContain('getPdfBytes');
  expect(preload).not.toContain('getFilePath');
  expect(frame).not.toContain('iframe');
  expect(frame).not.toContain('embed');
});
