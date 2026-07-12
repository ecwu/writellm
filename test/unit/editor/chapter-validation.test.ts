import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  ChapterValidationError,
  parseChapterDocument,
  parseSaveInput,
} from '../../../src/main/project/chapter-validation';
import { chapterDocument, emptyBlock, paragraph } from '../../fixtures/editor/chapter-fixtures';

describe('chapter validation', () => {
  test('accepts the frozen canonical schema', () =>
    expect(parseChapterDocument(chapterDocument(), chapterDocument().projectId).revision).toBe(0));
  test('rejects prototype-bearing and unknown properties', () => {
    const value = Object.create({ evil: true });
    Object.assign(value, {
      chapterId: randomUUID(),
      baseRevision: 0,
      mutationId: randomUUID(),
      blocks: [emptyBlock()],
      citations: [],
    });
    expect(() => parseSaveInput(value)).toThrow(ChapterValidationError);
    expect(() => parseSaveInput({ ...value, extra: true })).toThrow();
  });
  test('rejects duplicate block IDs and citation mismatch', () => {
    const block = paragraph('abc');
    expect(() =>
      parseSaveInput({
        chapterId: randomUUID(),
        baseRevision: 0,
        mutationId: randomUUID(),
        blocks: [block, block],
        citations: [],
      }),
    ).toThrow();
    expect(() =>
      parseChapterDocument(
        chapterDocument({
          blocks: [block],
          citations: [
            {
              citationId: randomUUID(),
              sourceId: randomUUID(),
              chunkId: randomUUID(),
              blockId: block.id,
              start: 0,
              end: 2,
              quotedText: 'wrong',
              status: 'valid',
            },
          ],
        }),
        chapterDocument().projectId,
      ),
    ).toThrow();
  });
  test('enforces depth and citation ceilings', () => {
    let block = emptyBlock();
    for (let i = 0; i < 33; i++) block = { ...emptyBlock(), children: [block] };
    expect(() =>
      parseSaveInput({
        chapterId: randomUUID(),
        baseRevision: 0,
        mutationId: randomUUID(),
        blocks: [block],
        citations: [],
      }),
    ).toThrow();
  });
});
