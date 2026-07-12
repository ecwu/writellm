import { describe, expect, test } from 'bun:test';
import { openChapterSession } from '../../../src/renderer/features/editor/chapter-session';
import { chapterDocument } from '../../fixtures/editor/chapter-fixtures';

describe('chapter entry', () => {
  test('opens an empty chapter and reports created state', async () => {
    const document = chapterDocument();
    const state = await openChapterSession(
      {
        openForOutlineItem: async () => ({ ok: true, value: { document, created: true } }),
      } as never,
      {
        outlineItemId: document.outlineItemId,
        baseOrientationRevision: 1,
        mutationId: crypto.randomUUID(),
      },
    );
    expect(state.status).toBe('ready');
    expect(state.document?.blocks).toHaveLength(1);
    expect(state.created).toBeTrue();
  });
  test('retains a safe load error for retry', async () => {
    const state = await openChapterSession(
      {
        openForOutlineItem: async () => ({
          ok: false,
          error: { code: 'STORAGE_READ_FAILED', message: 'Try again', retryable: true },
        }),
      } as never,
      {
        outlineItemId: crypto.randomUUID(),
        baseOrientationRevision: 1,
        mutationId: crypto.randomUUID(),
      },
    );
    expect(state).toEqual({ status: 'error', message: 'Try again' });
  });
});
