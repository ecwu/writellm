import { expect, test } from 'bun:test';
import { moveItem } from '../../../src/renderer/features/writing-orientation/reorder';

test('move command has shared bounded array semantics', () => {
  expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  expect(moveItem(['a'], 0, 0)).toEqual(['a']);
  expect(moveItem(['a'], -1, 0)).toEqual(['a']);
  expect(moveItem(moveItem(['a', 'b', 'c'], 2, 0), 0, 2)).toEqual(['a', 'b', 'c']);
});
