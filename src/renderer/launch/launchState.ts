import type { WriteLLMIpc } from '../../shared/ipc';
import type { ProjectSnapshot, RecentProjectSummary } from '../../shared/project';

export type LaunchState =
  | { status: 'loading'; recentProjects: RecentProjectSummary[] }
  | { status: 'ready'; recentProjects: RecentProjectSummary[]; warning?: string }
  | { status: 'working'; recentProjects: RecentProjectSummary[]; message: string }
  | { status: 'workspace'; recentProjects: RecentProjectSummary[]; project: ProjectSnapshot }
  | { status: 'error'; recentProjects: RecentProjectSummary[]; message: string };

export const initialLaunchState: LaunchState = { status: 'loading', recentProjects: [] };

export async function loadLaunchState(api: WriteLLMIpc): Promise<LaunchState> {
  try {
    const result = await api.listRecentProjects();
    return { status: 'ready', recentProjects: result.recentProjects, ...(result.warning ? { warning: result.warning } : {}) };
  } catch {
    return { status: 'error', recentProjects: [], message: 'Recent projects are unavailable. You can try again.' };
  }
}

export function operationMessage(result: { status: string; error?: { message: string } }): string | undefined {
  if (result.status === 'canceled') return undefined;
  if (result.status === 'error') return result.error?.message ?? 'The operation could not be completed.';
  return undefined;
}

