import { describe, expect, test } from 'bun:test';
import {
  initializeOrientation,
  markDraft,
  projectSectionNavigationItems,
  revalidateSectionSelection,
} from '../../../src/renderer/features/writing-orientation/orientation-state';
import { savedDocument } from '../../fixtures/writing-orientation/orientation-fixtures';

describe('section navigation projection', () => {
  test('preserves owner order and persisted/chapter identity', () => {
    const state = initializeOrientation(savedDocument());
    const projected = projectSectionNavigationItems(state);
    expect(projected.map((item) => item.id)).toEqual(
      state.draft.outlineItems.map((item) =>
        'outlineItemId' in item ? item.outlineItemId : item.clientDraftId,
      ),
    );
    expect(projected.every((item) => item.persisted)).toBeTrue();
  });
  test('includes client drafts and safely replaces a deleted selection', () => {
    let state = initializeOrientation(savedDocument());
    state = markDraft(state, {
      ...state.draft,
      outlineItems: [
        {
          clientDraftId: 'draft',
          title: 'Draft',
          summary: 'Summary',
          status: 'not-started',
          chapterRef: null,
        },
      ],
    });
    state = { ...state, selectedOutlineItemId: 'removed' };
    expect(projectSectionNavigationItems(state)[0]).toMatchObject({
      id: 'draft',
      persisted: false,
      chapter: { kind: 'not-created' },
    });
    expect(revalidateSectionSelection(state).selectedOutlineItemId).toBe('draft');
  });
});
