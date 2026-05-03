import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PaperLabDatabase } from './database.js';
import { nowIso } from './ids.js';
import { startKnowledgeIngestWorker, stopKnowledgeIngestWorker } from './knowledgeIngest.js';
import type { FocusedWorkspaceState, RecentWorkspace, WorkspaceSummary } from '../shared/types.js';

let activeDb: PaperLabDatabase | null = null;
const MAX_RECENT_WORKSPACES = 10;
const WORKSPACE_EXTENSION = '.paperlab';

export function createWorkspace(workspacePath: string): WorkspaceSummary {
  const normalizedPath = normalizeWorkspacePath(workspacePath);
  assertWorkspacePath(normalizedPath);
  const summary = setActiveWorkspace(normalizedPath);
  rememberWorkspace(summary.path);
  return summary;
}

export function openWorkspace(workspacePath: string): WorkspaceSummary {
  const normalizedPath = normalizeWorkspacePath(workspacePath);
  assertWorkspacePath(normalizedPath);
  assertExistingWorkspace(normalizedPath);
  const summary = setActiveWorkspace(normalizedPath);
  rememberWorkspace(summary.path);
  return summary;
}

export function listRecentWorkspaces(): RecentWorkspace[] {
  return readRecentWorkspaces();
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
      knowledgeItems: [],
      knowledgeIngestJobs: [],
      nodeStats: {},
      edges: [],
      nodeLayouts: []
    };
  }
  return activeDb.getState(focusSectionId);
}

function setActiveWorkspace(workspacePath: string): WorkspaceSummary {
  stopKnowledgeIngestWorker();
  const nextDb = new PaperLabDatabase(workspacePath);
  if (activeDb) {
    activeDb.close();
  }
  activeDb = nextDb;
  startKnowledgeIngestWorker(activeDb);
  return activeDb.summary();
}

function normalizeWorkspacePath(workspacePath: string): string {
  const trimmedPath = workspacePath.trim();
  if (!trimmedPath) {
    return '';
  }
  return path.resolve(trimmedPath);
}

function assertWorkspacePath(workspacePath: string): void {
  if (!workspacePath) {
    throw new Error('Workspace path is required.');
  }
  if (path.extname(workspacePath) !== WORKSPACE_EXTENSION) {
    throw new Error('Workspace must be a .paperlab folder.');
  }
}

function assertExistingWorkspace(workspacePath: string): void {
  if (!existsSync(workspacePath) || !existsSync(path.join(workspacePath, 'project.sqlite'))) {
    throw new Error('Selected folder is not an existing PaperLab workspace.');
  }
}

function recentWorkspacesPath(): string {
  return path.join(app.getPath('userData'), 'recent-workspaces.json');
}

function readRecentWorkspaces(): RecentWorkspace[] {
  const filePath = recentWorkspacesPath();
  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isRecentWorkspace).slice(0, MAX_RECENT_WORKSPACES);
  } catch {
    return [];
  }
}

function rememberWorkspace(workspacePath: string): void {
  const openedAt = nowIso();
  const recent = [
    {
      path: workspacePath,
      name: path.basename(workspacePath),
      openedAt
    },
    ...readRecentWorkspaces().filter((workspace) => workspace.path !== workspacePath)
  ].slice(0, MAX_RECENT_WORKSPACES);

  const filePath = recentWorkspacesPath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(recent, null, 2));
}

function isRecentWorkspace(value: unknown): value is RecentWorkspace {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.path === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.openedAt === 'string'
  );
}
