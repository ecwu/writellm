import { expect, test } from 'bun:test';
import { initializeOrientation } from '../../../src/renderer/features/writing-orientation/orientation-state';
import {
  emptyDocument,
  savedDocument,
} from '../../fixtures/writing-orientation/orientation-fixtures';

test('reopen selects first item or empty without changing revision', () => {
  const saved = savedDocument(),
    state = initializeOrientation(saved);
  expect(state.selectedOutlineItemId).toBe(saved.outlineItems[0].outlineItemId);
  expect(state.draft.revision).toBe(saved.revision);
  expect(initializeOrientation(emptyDocument()).selectedOutlineItemId).toBeNull();
});
