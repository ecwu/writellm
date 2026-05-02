import { PaperLabDatabase } from './database.js';
import type { FocusedWorkspaceState, WorkspaceSummary } from '../shared/types.js';

let activeDb: PaperLabDatabase | null = null;

export function createWorkspace(workspacePath: string): WorkspaceSummary {
  return openWorkspace(workspacePath);
}

export function openWorkspace(workspacePath: string): WorkspaceSummary {
  if (activeDb) {
    activeDb.close();
  }
  activeDb = new PaperLabDatabase(workspacePath);
  return activeDb.summary();
}

export function getActiveDb(): PaperLabDatabase {
  if (!activeDb) {
    throw new Error('No active workspace. Create or open a .paperlab directory first.');
  }
  return activeDb;
}

export function getState(focusSectionId?: string): FocusedWorkspaceState {
  if (!activeDb) {
    return {
      workspace: null,
      compositionTree: [],
      focusSectionId: null,
      nodes: [],
      visibleNodes: [],
      contextNodes: [],
      nodeStats: {},
      edges: [],
      nodeLayouts: []
    };
  }
  return activeDb.getState(focusSectionId);
}
