import { describe, expect, test } from 'bun:test';
import {
  acceptsOwnerResult,
  createWorkspaceNavigationSession,
  workspaceNavigationSessionReducer,
} from '../../../src/renderer/workspace/workspaceNavigationSession';

describe('workspace navigation session', () => {
  test('keeps one active category and restores each category selection', () => {
    let state = createWorkspaceNavigationSession('project');
    state = workspaceNavigationSessionReducer(state, {
      type: 'item.activate',
      category: 'sections',
      itemId: 'section-1',
    });
    state = workspaceNavigationSessionReducer(state, {
      type: 'category.activate',
      category: 'knowledge-base',
    });
    state = workspaceNavigationSessionReducer(state, {
      type: 'item.activate',
      category: 'knowledge-base',
      itemId: 'source-1',
    });
    state = workspaceNavigationSessionReducer(state, {
      type: 'category.activate',
      category: 'sections',
    });
    expect(state.activeCategory).toBe('sections');
    expect(state.lastValidItemId).toEqual({ sections: 'section-1', 'knowledge-base': 'source-1' });
    expect(state.visitedCategories).toEqual(new Set(['sections', 'knowledge-base']));
  });
  test('expands on category activation and controls compact disclosure', () => {
    let state = createWorkspaceNavigationSession('project');
    state = workspaceNavigationSessionReducer(state, { type: 'sidebar.toggle' });
    expect(state.sidebarExpanded).toBeFalse();
    state = workspaceNavigationSessionReducer(state, {
      type: 'category.activate',
      category: 'knowledge-base',
    });
    expect(state.sidebarExpanded).toBeTrue();
    state = workspaceNavigationSessionReducer(state, {
      type: 'item.activate',
      category: 'knowledge-base',
      itemId: 'source',
    });
    expect(state.compactPane).toBe('detail');
    state = workspaceNavigationSessionReducer(state, { type: 'list.show' });
    expect(state.compactPane).toBe('list');
  });
  test('records Settings return and resets on project identity change', () => {
    let state = createWorkspaceNavigationSession('one');
    state = workspaceNavigationSessionReducer(state, {
      type: 'item.activate',
      category: 'sections',
      itemId: 'section',
    });
    state = workspaceNavigationSessionReducer(state, {
      type: 'settings.open',
      focusKey: 'settings',
    });
    expect(state.settings).toEqual({
      category: 'sections',
      itemId: 'section',
      focusKey: 'settings',
    });
    state = workspaceNavigationSessionReducer(state, { type: 'settings.close' });
    expect(state.settings).toBeNull();
    state = workspaceNavigationSessionReducer(state, { type: 'project.reset', projectId: 'two' });
    expect(state.projectId).toBe('two');
    expect(state.lastValidItemId.sections).toBeNull();
  });
  test('invalidates removed items and rejects stale owner results', () => {
    let state = createWorkspaceNavigationSession('project');
    state = workspaceNavigationSessionReducer(state, {
      type: 'item.activate',
      category: 'sections',
      itemId: 'removed',
    });
    const staleGeneration = state.generation;
    state = workspaceNavigationSessionReducer(state, {
      type: 'selection.revalidate',
      category: 'sections',
      validItemIds: ['other'],
    });
    expect(state.lastValidItemId.sections).toBeNull();
    expect(
      acceptsOwnerResult(state, {
        category: 'sections',
        itemId: 'removed',
        generation: staleGeneration,
      }),
    ).toBeFalse();
  });
});
