import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MarkdownExportService } from '../../../src/main/project/markdown-export';
import { paragraph } from '../../fixtures/editor/chapter-fixtures';

let root = '';
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
describe('Markdown export boundary', () => {
  test('writes exact preview bytes and isolates cancellation', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'markdown-export-'));
    const target = path.join(root, 'chapter.md'),
      session = {
        projectId: crypto.randomUUID(),
        projectRoot: root,
        sessionId: crypto.randomUUID(),
      };
    const service = new MarkdownExportService({
      showSaveDialog: async () => ({ canceled: false, filePath: target }),
    });
    const preview = service.preview(session, crypto.randomUUID(), [paragraph('exact')], []);
    const result = await service.export(
      session,
      (service as any).previews.get(preview.previewId).chapterId,
      preview.previewId,
    );
    expect(result.ok).toBeTrue();
    expect(await readFile(target, 'utf8')).toBe(preview.markdown);
  });
});
