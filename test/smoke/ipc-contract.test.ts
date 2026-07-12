import { expect, test } from 'bun:test';
import { chapterChannels } from '../../src/shared/chapters';
import { ipcChannels } from '../../src/shared/ipc';
import { orientationChannels } from '../../src/shared/writing-orientation';

test('the project foundation exposes exactly six named IPC channels', () => {
  expect(Object.keys(ipcChannels).sort()).toEqual([
    'createProject',
    'listRecentProjects',
    'openProjectFromDialog',
    'openRecentProject',
    'relinkRecentProject',
    'removeRecentProject',
  ]);
  expect(
    Object.values(ipcChannels).every((channel) => channel.startsWith('writellm:project:')),
  ).toBe(true);
});

test('chapters expose exactly five named IPC channels', () => {
  expect(Object.keys(chapterChannels).sort()).toEqual([
    'exportMarkdown',
    'load',
    'openForOutlineItem',
    'previewMarkdownExport',
    'save',
  ]);
  expect(
    Object.values(chapterChannels).every((channel) => channel.startsWith('writellm:chapters:')),
  ).toBe(true);
});

test('writing orientation exposes exactly three named IPC channels', () => {
  expect(Object.keys(orientationChannels).sort()).toEqual(['deleteOutlineItem', 'load', 'save']);
  expect(
    Object.values(orientationChannels).every((channel) =>
      channel.startsWith('writellm:writing-orientation:'),
    ),
  ).toBe(true);
});
