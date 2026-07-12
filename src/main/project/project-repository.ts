import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateProjectDirectory, validateProjectName } from './project-validation.js';
import { CleanupReceipts } from './cleanup-receipts.js';
import { RecentProjectIndex } from './recent-index.js';
import type { CreateProjectResult, ListRecentResult, OpenProjectResult, ProjectError, ProjectSnapshot, RecentProjectSummary, RemoveRecentResult } from '../../shared/project.js';

export type DirectoryDialogResult = { canceled: boolean; filePaths: string[] };
export type DirectoryDialog = { showOpenDialog(options: Record<string, unknown>): Promise<DirectoryDialogResult> };

export type ProjectRepositoryOptions = {
  userDataPath: string;
  dialog?: DirectoryDialog;
  now?: () => string;
};

export class ProjectRepository {
  private readonly dialog: DirectoryDialog;
  private readonly now: () => string;
  private readonly recent: RecentProjectIndex;
  private readonly cleanup: CleanupReceipts;
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(options: ProjectRepositoryOptions) {
    this.dialog = options.dialog ?? { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) };
    this.now = options.now ?? (() => new Date().toISOString());
    this.recent = new RecentProjectIndex(path.join(options.userDataPath, 'recent-projects.json'));
    this.cleanup = new CleanupReceipts(options.userDataPath);
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.recentPath()), { recursive: true });
    await this.cleanup.load();
    await this.cleanup.cleanup();
    await this.recent.load();
  }

  async listRecentProjects(): Promise<ListRecentResult> {
    const result = await this.recent.list();
    const warnings = [result.warning, this.cleanup.warning].filter(Boolean);
    return warnings.length ? { ...result, warning: warnings.join(' ') } : result;
  }

  async createProject(displayName: unknown): Promise<CreateProjectResult> {
    const name = validateProjectName(displayName);
    if (!name.ok) return failure(name.code, name.message);
    const parent = await this.chooseDirectory('Choose a parent folder for the new project.');
    if (!parent) return { status: 'canceled' };
    const finalRoot = path.join(parent, `${displayName}.writellm`);
    if (path.dirname(finalRoot) !== path.resolve(parent)) return failure('INVALID_PROJECT_NAME', 'Project name must remain inside the selected folder.');

    return this.serialized(async () => {
      const token = randomUUID();
      const tempManifest = path.join(finalRoot, `project.json.${token}.tmp`);
      const manifestPath = path.join(finalRoot, 'project.json');
      const workspacePath = path.join(finalRoot, 'workspace');
      const createdAt = this.now();
      const snapshot: ProjectSnapshot = { projectId: randomUUID(), displayName: displayName as string };
      const receipt = await this.cleanup.add(finalRoot).catch(() => undefined);
      if (!receipt) return failure('STORAGE_WRITE_FAILED', 'The project could not be prepared safely.');

      try {
        await mkdir(finalRoot, { recursive: false });
        const manifest = {
          kind: 'writellm.project' as const,
          schemaVersion: 1 as const,
          projectId: snapshot.projectId,
          displayName: snapshot.displayName,
          requiredDirectories: ['workspace'],
          createdAt,
          updatedAt: createdAt
        };
        await writeFile(tempManifest, `${JSON.stringify(manifest)}\n`, { encoding: 'utf8', flag: 'wx' });
        await mkdir(workspacePath, { recursive: false });
        await rename(tempManifest, manifestPath);
        const verified = await validateProjectDirectory(finalRoot);
        if (!verified.ok) return failure('STORAGE_WRITE_FAILED', 'The new project could not be verified.');
        await this.cleanup.remove(receipt);
        try {
          await this.recent.upsert(finalRoot, verified.project, undefined, createdAt);
        } catch {
          return failure('STORAGE_WRITE_FAILED', 'The project was created, but recent projects could not be updated.');
        }
        return { status: 'created', project: verified.project };
      } catch (error) {
        await this.rollbackCreation(finalRoot, token).catch(() => undefined);
        await this.cleanup.remove(receipt).catch(() => undefined);
        if (isNodeError(error) && error.code === 'EEXIST') return failure('PROJECT_EXISTS', 'A project with that name already exists.');
        if (isNodeError(error) && (error.code === 'EINVAL' || error.code === 'ENAMETOOLONG')) return failure('INVALID_PROJECT_NAME', 'The filesystem rejected this project name.');
        return failure('STORAGE_WRITE_FAILED', 'The project could not be created safely.');
      }
    });
  }

  async openProjectFromDialog(): Promise<OpenProjectResult> {
    const selected = await this.chooseDirectory('Choose a WriteLLM project folder.');
    if (!selected) return { status: 'canceled' };
    return this.openPath(selected, 'opened');
  }

  async openRecentProject(recentId: string): Promise<OpenProjectResult> {
    const record = this.recent.get(recentId);
    if (!record) return failure('RECENT_NOT_FOUND', 'That recent project record is no longer available.');
    return this.openPath(record.mainOnlyPath, 'opened', record.recentId);
  }

  async relinkRecentProject(recentId: string): Promise<OpenProjectResult> {
    const record = this.recent.get(recentId);
    if (!record) return failure('RECENT_NOT_FOUND', 'That recent project record is no longer available.');
    const selected = await this.chooseDirectory('Choose the moved project folder.');
    if (!selected) return { status: 'canceled' };
    const validation = await validateProjectDirectory(selected);
    if (!validation.ok) return failure(validation.error.code, validation.error.message);
    if (validation.manifest.projectId !== record.projectId) return failure('PROJECT_ID_MISMATCH', 'The selected project is not the same project.');
    return this.serialized(async () => {
      try {
        await this.recent.upsert(selected, validation.project, record.recentId, this.now());
        return { status: 'opened', project: validation.project };
      } catch {
        return failure('STORAGE_WRITE_FAILED', 'The recent project record could not be updated.');
      }
    });
  }

  async removeRecentProject(recentId: string): Promise<RemoveRecentResult> {
    return this.serialized(async () => {
      try {
        const error = await this.recent.remove(recentId);
        if (error) return { status: 'error', error };
        return { status: 'removed', recentId };
      } catch {
        return failure('STORAGE_WRITE_FAILED', 'The recent project record could not be removed.');
      }
    });
  }

  private async openPath(projectRoot: string, status: 'opened', recentId?: string): Promise<OpenProjectResult> {
    const validation = await validateProjectDirectory(projectRoot);
    if (!validation.ok) return failure(validation.error.code, validation.error.message);
    return this.serialized(async () => {
      try {
        await this.recent.upsert(projectRoot, validation.project, recentId, this.now());
        return { status, project: validation.project };
      } catch {
        return failure('STORAGE_WRITE_FAILED', 'The project opened, but recent projects could not be updated.');
      }
    });
  }

  private async chooseDirectory(message: string): Promise<string | undefined> {
    try {
      const result = await this.dialog.showOpenDialog({ properties: ['openDirectory'], title: message });
      if (result.canceled || result.filePaths.length !== 1 || !path.isAbsolute(result.filePaths[0])) return undefined;
      const selected = path.resolve(result.filePaths[0]);
      const selectedStat = await stat(selected);
      return selectedStat.isDirectory() ? selected : undefined;
    } catch {
      return undefined;
    }
  }

  private async rollbackCreation(finalRoot: string, token: string): Promise<void> {
    try {
      const names = await readdir(finalRoot);
      const expectedTemp = `project.json.${token}.tmp`;
      if (names.every((name) => name === 'workspace' || name === expectedTemp) && !names.includes('project.json')) {
        await rm(finalRoot, { recursive: true, force: true });
      }
    } catch {
      // The receipt remains the only authorization for a later conservative cleanup.
    }
  }

  private recentPath(): string {
    return this.recent.storagePath;
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(operation, operation);
    this.writeQueue = next.then(() => undefined, () => undefined);
    return next;
  }
}

function failure(code: ProjectError['code'], message: string): { status: 'error'; error: ProjectError } {
  return { status: 'error', error: { code, message } };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === 'string';
}
