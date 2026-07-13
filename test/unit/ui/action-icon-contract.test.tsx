import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import { Save } from 'lucide-react';
import { Button } from '../../../src/renderer/components/ui/button';

test('action icons are decorative and their visible label names the control', () => {
  const html = renderToStaticMarkup(
    <Button>
      <Save aria-hidden="true" focusable="false" />
      Save
    </Button>,
  );
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain('focusable="false"');
  expect(html).toContain('Save');
});

test('canonical action sources use Lucide named imports and retain required labels', async () => {
  const files = await Promise.all(
    [
      'src/renderer/launch/LaunchPage.tsx',
      'src/renderer/workspace/components/ProjectNavigation.tsx',
      'src/renderer/features/writing-orientation/WritingOrientationPanel.tsx',
      'src/renderer/features/editor/components/ChapterEditor.tsx',
      'src/renderer/workspace/components/WorkspaceCategoryRail.tsx',
      'src/renderer/workspace/components/WorkspaceNavigationFrame.tsx',
      'src/renderer/components/ui/sidebar.tsx',
    ].map((file) => readFile(file, 'utf8')),
  );
  const source = files.join('\n');
  for (const icon of [
    'FolderPlus',
    'FolderOpen',
    'ArrowLeft',
    'Save',
    'Plus',
    'ArrowUp',
    'ArrowDown',
    'Trash2',
    'ClipboardPaste',
    'Download',
    'ListTree',
    'LibraryBig',
    'Settings',
    'PanelLeft',
  ])
    expect(source).toContain(icon);
  for (const label of [
    'Create project',
    'Open existing project',
    'Back to projects',
    'Add outline item',
    'Delete item',
    'Paste Markdown',
    'Export Markdown',
  ])
    expect(source).toContain(label);
  expect(source).not.toMatch(/[↑↓]/);
});
