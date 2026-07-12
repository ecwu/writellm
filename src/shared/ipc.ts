import type {
  CreateProjectResult,
  ListRecentResult,
  OpenProjectResult,
  RemoveRecentResult
} from './project.js';

export const ipcChannels = {
  listRecentProjects: 'writellm:project:list-recent',
  createProject: 'writellm:project:create',
  openProjectFromDialog: 'writellm:project:open-dialog',
  openRecentProject: 'writellm:project:open-recent',
  relinkRecentProject: 'writellm:project:relink',
  removeRecentProject: 'writellm:project:remove-recent'
} as const;

export type CreateProjectRequest = { displayName: string };
export type RecentProjectRequest = { recentId: string };

export type WriteLLMIpc = {
  listRecentProjects(): Promise<ListRecentResult>;
  createProject(request: CreateProjectRequest): Promise<CreateProjectResult>;
  openProjectFromDialog(): Promise<OpenProjectResult>;
  openRecentProject(request: RecentProjectRequest): Promise<OpenProjectResult>;
  relinkRecentProject(request: RecentProjectRequest): Promise<OpenProjectResult>;
  removeRecentProject(request: RecentProjectRequest): Promise<RemoveRecentResult>;
};
