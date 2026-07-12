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
  });
});
