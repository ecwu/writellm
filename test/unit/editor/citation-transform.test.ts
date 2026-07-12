import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  flagMissingAnchors,
  transformDelete,
  transformMerge,
  transformSplit,
} from '../../../src/renderer/features/editor/adapter/citation-transform';
import { citation, paragraph } from '../../fixtures/editor/chapter-fixtures';

describe('citation transforms', () => {
  test('preserves only provable split/merge mappings', () => {
    const block = paragraph('evidence'),
      anchor = citation(block),
      next = randomUUID();
    expect(transformSplit([anchor], block.id, next, 8)[0].blockId).toBe(block.id);
    expect(transformSplit([anchor], block.id, next, 4)[0].status).toBe('needs-review');
    expect(transformMerge([{ ...anchor, blockId: next }], block.id, next, 3)[0].start).toBe(3);
  });
  test('flags deletes and missing blocks without proximity rebinding', () => {
    const anchor = citation(paragraph('evidence'));
    expect(transformDelete([anchor], anchor.blockId, 1, 2)[0].reviewReason).toBe('text-deleted');
    expect(flagMissingAnchors([anchor], new Set())[0].reviewReason).toBe('block-missing');
  });
});
