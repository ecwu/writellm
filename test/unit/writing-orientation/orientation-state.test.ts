import { expect, test } from 'bun:test';
import {
  applyDelete,
  applySave,
  content,
  createDraftItem,
  initializeOrientation,
  isDirty,
  updateMotivation,
} from '../../../src/renderer/features/writing-orientation/orientation-state';
import {
  emptyDocument,
  savedDocument,
} from '../../fixtures/writing-orientation/orientation-fixtures';

test('baseline/draft preserves in-flight edits', () => {
  let state = initializeOrientation(emptyDocument());
  state = updateMotivation(state, 'problem', 'A');
  const submitted = content(state.draft);
  state = updateMotivation(state, 'problem', 'B');
  state = applySave(state, submitted, {
    document: {
      ...emptyDocument(),
      revision: 1,
      motivation: { ...emptyDocument().motivation, problem: 'A' },
    },
    createdItemIds: [],
  });
  expect(state.saveState).toBe('dirty');
  expect(state.draft.motivation.problem).toBe('B');
});
test('new item defaults and empty reopen selection', () => {
  const state = createDraftItem(initializeOrientation(emptyDocument()), crypto.randomUUID());
  expect(isDirty(state)).toBeTrue();
  expect(state.draft.outlineItems[0].status).toBe('not-started');
  expect(initializeOrientation(emptyDocument()).selectedOutlineItemId).toBeNull();
});
test('deleting a saved item preserves unrelated unsaved draft edits', () => {
  const original = savedDocument();
  let state = initializeOrientation(original);
  state = updateMotivation(state, 'problem', 'unsaved');
  const deleted = original.outlineItems[0]!;
  const canonical = {
    ...original,
    revision: original.revision + 1,
    outlineItems: original.outlineItems.slice(1),
  };
  state = applyDelete(state, deleted.outlineItemId, canonical);
  expect(state.draft.motivation.problem).toBe('unsaved');
  expect(state.saveState).toBe('dirty');
  expect(
    state.draft.outlineItems.some(
      (item) => 'outlineItemId' in item && item.outlineItemId === deleted.outlineItemId,
    ),
  ).toBeFalse();
});
