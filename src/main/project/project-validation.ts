import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  PROJECT_KIND,
  PROJECT_SCHEMA_VERSION,
  REQUIRED_PROJECT_DIRECTORIES,
  isRecord,
  type ProjectErrorCode,
  type ProjectManifest,
  type ProjectSnapshot
} from '../../shared/project.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ValidationFailure = {
  code: Extract<ProjectErrorCode, 'PROJECT_INVALID' | 'PROJECT_UNSUPPORTED_VERSION' | 'PROJECT_NOT_FOUND' | 'PROJECT_INACCESSIBLE'>;
  message: string;
};

export type ProjectValidation =
  | { ok: true; manifest: ProjectManifest; project: ProjectSnapshot }
  | { ok: false; error: ValidationFailure };

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

export function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function validateProjectName(displayName: unknown): { ok: true } | { ok: false; code: 'INVALID_PROJECT_NAME'; message: string } {
  if (typeof displayName !== 'string' || displayName.length === 0) {
    return { ok: false, code: 'INVALID_PROJECT_NAME', message: 'Project name must not be empty.' };
  }
  if (displayName === '.' || displayName === '..' || displayName.includes('\0') || displayName.includes(path.sep)) {
    return { ok: false, code: 'INVALID_PROJECT_NAME', message: 'Project name must be a single filesystem name.' };
  }
  if (process.platform === 'win32' && displayName.includes('/')) {
    return { ok: false, code: 'INVALID_PROJECT_NAME', message: 'Project name must be a single filesystem name.' };
  }
  return { ok: true };
}

export function validateManifest(value: unknown): { ok: true; manifest: ProjectManifest } | { ok: false; code: 'PROJECT_INVALID' | 'PROJECT_UNSUPPORTED_VERSION'; message: string } {
  if (!isRecord(value)) return { ok: false, code: 'PROJECT_INVALID', message: 'Project manifest is not an object.' };
  if (value.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    return { ok: false, code: 'PROJECT_UNSUPPORTED_VERSION', message: 'Project format version is not supported.' };
  }
  if (value.kind !== PROJECT_KIND || !isUuid(value.projectId) || typeof value.displayName !== 'string' || !validateProjectName(value.displayName).ok) {
    return { ok: false, code: 'PROJECT_INVALID', message: 'Project manifest identity is invalid.' };
  }
  if (!Array.isArray(value.requiredDirectories) || value.requiredDirectories.length !== 1 || value.requiredDirectories[0] !== REQUIRED_PROJECT_DIRECTORIES[0]) {
    return { ok: false, code: 'PROJECT_INVALID', message: 'Project required directories are invalid.' };
  }
  if (!isValidTimestamp(value.createdAt) || !isValidTimestamp(value.updatedAt) || value.createdAt !== value.updatedAt) {
    return { ok: false, code: 'PROJECT_INVALID', message: 'Project timestamps are invalid.' };
  }
  return { ok: true, manifest: value as ProjectManifest };
}

export async function validateProjectDirectory(projectRoot: string): Promise<ProjectValidation> {
  try {
    const root = await stat(projectRoot);
    if (!root.isDirectory()) return invalid('PROJECT_INVALID', 'Selected project is not a directory.');
  } catch (error) {
    return filesystemFailure(error);
  }

  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(await readFile(path.join(projectRoot, 'project.json'), 'utf8')) as unknown;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return invalid('PROJECT_INVALID', 'Project manifest is missing.');
    return filesystemFailure(error, 'Project manifest could not be read.');
  }

  const manifestResult = validateManifest(manifestValue);
  if (!manifestResult.ok) return { ok: false, error: manifestResult };

  try {
    const workspace = await stat(path.join(projectRoot, 'workspace'));
    if (!workspace.isDirectory()) return invalid('PROJECT_INVALID', 'Project workspace directory is missing.');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return invalid('PROJECT_INVALID', 'Project workspace directory is missing.');
    return filesystemFailure(error, 'Project workspace directory could not be read.');
  }

  return {
    ok: true,
    manifest: manifestResult.manifest,
    project: { projectId: manifestResult.manifest.projectId, displayName: manifestResult.manifest.displayName }
  };
}

function invalid(code: 'PROJECT_INVALID' | 'PROJECT_UNSUPPORTED_VERSION', message: string): ProjectValidation {
  return { ok: false, error: { code, message } };
}

function filesystemFailure(error: unknown, fallback = 'Project could not be verified.'): ProjectValidation {
  const code = isNodeError(error) && error.code === 'ENOENT' ? 'PROJECT_NOT_FOUND' : 'PROJECT_INACCESSIBLE';
  return { ok: false, error: { code, message: code === 'PROJECT_NOT_FOUND' ? 'Project was not found.' : fallback } };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === 'string';
}
