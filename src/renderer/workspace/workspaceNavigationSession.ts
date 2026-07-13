export type WorkspaceCategoryId = 'sections' | 'knowledge-base';
export type CompactPane = 'list' | 'detail';

export type SettingsReturnPoint = {
  category: WorkspaceCategoryId;
  itemId: string | null;
  focusKey: string;
};

export type WorkspaceNavigationSession = {
  projectId: string;
  activeCategory: WorkspaceCategoryId;
  lastValidItemId: Record<WorkspaceCategoryId, string | null>;
  visitedCategories: ReadonlySet<WorkspaceCategoryId>;
  sidebarExpanded: boolean;
  compactPane: CompactPane;
  settings: SettingsReturnPoint | null;
  focusReturnKey: string | null;
  generation: number;
};

export type WorkspaceNavigationEvent =
  | { type: 'category.activate'; category: WorkspaceCategoryId }
  | { type: 'item.activate'; category: WorkspaceCategoryId; itemId: string }
  | { type: 'item.invalidate'; category: WorkspaceCategoryId; itemId: string }
  | { type: 'selection.revalidate'; category: WorkspaceCategoryId; validItemIds: readonly string[] }
  | { type: 'sidebar.toggle' }
  | { type: 'list.show'; focusReturnKey?: string }
  | { type: 'settings.open'; focusKey: string }
  | { type: 'settings.close' }
  | { type: 'project.reset'; projectId: string; initialCategory?: WorkspaceCategoryId };

export function createWorkspaceNavigationSession(
  projectId: string,
  initialCategory: WorkspaceCategoryId = 'sections',
): WorkspaceNavigationSession {
  return {
    projectId,
    activeCategory: initialCategory,
    lastValidItemId: { sections: null, 'knowledge-base': null },
    visitedCategories: new Set([initialCategory]),
    sidebarExpanded: true,
    compactPane: 'list',
    settings: null,
    focusReturnKey: null,
    generation: 0,
  };
}

export function workspaceNavigationSessionReducer(
  session: WorkspaceNavigationSession,
  event: WorkspaceNavigationEvent,
): WorkspaceNavigationSession {
  const nextGeneration = () => session.generation + 1;
  switch (event.type) {
    case 'project.reset':
      return event.projectId === session.projectId
        ? session
        : createWorkspaceNavigationSession(event.projectId, event.initialCategory);
    case 'category.activate': {
      const visited = new Set(session.visitedCategories);
      visited.add(event.category);
      return {
        ...session,
        activeCategory: event.category,
        visitedCategories: visited,
        sidebarExpanded: true,
        compactPane: 'list',
        generation: nextGeneration(),
      };
    }
    case 'item.activate':
      if (!event.itemId.trim()) return session;
      return {
        ...session,
        activeCategory: event.category,
        lastValidItemId: { ...session.lastValidItemId, [event.category]: event.itemId },
        compactPane: 'detail',
        generation: nextGeneration(),
      };
    case 'item.invalidate':
      if (session.lastValidItemId[event.category] !== event.itemId) return session;
      return {
        ...session,
        lastValidItemId: { ...session.lastValidItemId, [event.category]: null },
        compactPane: 'list',
        generation: nextGeneration(),
      };
    case 'selection.revalidate': {
      const selected = session.lastValidItemId[event.category];
      if (!selected || event.validItemIds.includes(selected)) return session;
      return {
        ...session,
        lastValidItemId: { ...session.lastValidItemId, [event.category]: null },
        compactPane: session.activeCategory === event.category ? 'list' : session.compactPane,
        generation: nextGeneration(),
      };
    }
    case 'sidebar.toggle':
      return { ...session, sidebarExpanded: !session.sidebarExpanded };
    case 'list.show':
      return {
        ...session,
        compactPane: 'list',
        focusReturnKey: event.focusReturnKey ?? session.focusReturnKey,
      };
    case 'settings.open':
      if (session.settings) return session;
      return {
        ...session,
        settings: {
          category: session.activeCategory,
          itemId: session.lastValidItemId[session.activeCategory],
          focusKey: event.focusKey,
        },
        focusReturnKey: event.focusKey,
      };
    case 'settings.close':
      if (!session.settings) return session;
      return {
        ...session,
        activeCategory: session.settings.category,
        settings: null,
        generation: nextGeneration(),
      };
  }
}

export const selectedItemId = (session: WorkspaceNavigationSession) =>
  session.lastValidItemId[session.activeCategory];
export const isCategoryMounted = (
  session: WorkspaceNavigationSession,
  category: WorkspaceCategoryId,
) => session.visitedCategories.has(category);
export const acceptsOwnerResult = (
  session: WorkspaceNavigationSession,
  fence: { category: WorkspaceCategoryId; itemId: string; generation: number },
) =>
  !session.settings &&
  session.activeCategory === fence.category &&
  selectedItemId(session) === fence.itemId &&
  session.generation === fence.generation;
