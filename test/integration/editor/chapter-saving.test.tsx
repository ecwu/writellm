import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('chapter saving integration', () => {
  test('shares autosave/save-now command and leave guard', async () => {
    const source = await readFile(
      path.resolve('src/renderer/features/editor/components/ChapterEditor.tsx'),
      'utf8',
    );
    const compact = source.replace(/\s/g, '');
    expect(compact).toContain('setTimeout(()=>voidsave(),900)');
    expect(compact).toContain('Savenow');
    expect(compact).toContain("ownerId:'chapter'");
    expect(compact).toContain("saveStatus==='saving'");
    expect(source).toContain('Save aria-hidden="true"');
    expect(source).toContain("busy={draft.saveStatus === 'saving'}");
  });
  test('workspace navigation never owns chapter save or draft replacement', async () => {
    const source = await readFile('src/renderer/workspace/workspaceNavigationSession.ts', 'utf8');
    expect(source).not.toContain('ChapterDocument');
    expect(source).not.toContain('.save(');
    expect(source).not.toContain('blocks');
  });
});
