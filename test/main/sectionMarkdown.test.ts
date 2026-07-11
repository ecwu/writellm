import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ensureSectionsDirectory,
  hashMarkdown,
  readSectionMarkdownFile,
  sectionMarkdownPath,
  writeSectionMarkdownFile
} from '../../src/main/sectionMarkdown.js';

describe('section Markdown files', () => {
  test('writes and reads nested section files atomically inside the workspace', () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'writellm-section-test-'));
    try {
      ensureSectionsDirectory(workspace);
      writeSectionMarkdownFile(workspace, 'sections/chapter/intro.md', 'Hello Markdown');

      expect(sectionMarkdownPath('intro')).toBe('sections/intro.md');
      expect(readSectionMarkdownFile(workspace, 'sections/chapter/intro.md')).toBe('Hello Markdown');
      expect(readFileSync(path.join(workspace, 'sections/chapter/intro.md'), 'utf8')).toBe('Hello Markdown');
      expect(readSectionMarkdownFile(workspace, 'sections/missing.md')).toBeNull();
      expect(hashMarkdown('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('rejects paths outside sections and non-Markdown files', () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'writellm-section-test-'));
    try {
      expect(() => writeSectionMarkdownFile(workspace, '../outside.md', 'no')).toThrow('inside the workspace sections directory');
      expect(() => writeSectionMarkdownFile(workspace, 'sections/notes.txt', 'no')).toThrow('must be a .md file');
      expect(() => readSectionMarkdownFile(workspace, '/tmp/outside.md')).toThrow('inside the workspace sections directory');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
