import { describe, expect, test } from 'bun:test';
import { BlockNoteAdapter } from '../../../src/renderer/features/editor/adapter/blocknote-adapter';
import { paragraph } from '../../fixtures/editor/chapter-fixtures';

describe('BlockNote adapter commands', () => {
  test('creates edits moves splits merges and normalizes last deletion', () => {
    const first = paragraph('hello');
    const adapter = new BlockNoteAdapter([first]);
    adapter.create({ ...paragraph('world'), id: undefined as never });
    const snap = adapter.snapshot();
    expect(snap.blocks).toHaveLength(2);
    adapter.move(snap.blocks[1].id, 0);
    adapter.update(first.id, { props: { level: 1 } });
    const split = adapter.split(first.id, 2);
    expect(split).toBeTruthy();
    expect(adapter.merge(first.id, split!)).toBeTrue();
    for (const block of adapter.snapshot().blocks) adapter.delete(block.id);
    expect(adapter.snapshot().blocks).toHaveLength(1);
    expect(adapter.snapshot().generation).toBeGreaterThan(0);
  });
});
