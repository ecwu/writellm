import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chapterChannels } from '../../../src/shared/chapters';

describe('chapter IPC contract', () => {
  test('exposes exactly five named wrappers without generic IPC', async () => {
    const source = await readFile(path.resolve('src/preload/preload.cts'), 'utf8');
    for (const method of Object.keys(chapterChannels)) expect(source).toContain(method);
    expect(source).toContain("exposeInMainWorld('writellmChapters'");
    expect(source).not.toContain('send:');
    expect(source).not.toContain('invoke: ipcRenderer.invoke');
  });
  test('channels are stable and chapter-specific', () =>
    expect(
      Object.values(chapterChannels).every((channel) => channel.startsWith('writellm:chapters:')),
    ).toBeTrue());
});
