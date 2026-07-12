import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  isRecord,
  type ListRecentResult,
  PROJECT_SCHEMA_VERSION,
  type ProjectError,
  type ProjectSnapshot,
  RECENT_INDEX_KIND,
  type RecentIndex,
  type RecentProjectSummary,
  type RecentRecord,
} from '../../shared/project.js';
import { writeAtomicJson } from './atomic-json.js';
import { isUuid, isValidTimestamp, validateProjectDirectory } from './project-validation.js';

export class RecentProjectIndex {
  private readonly indexPath: string;
  private records: RecentRecord[] = [];
  private warning: string | undefined;

  constructor(indexPath: string) {
    this.indexPath = indexPath;
  }

  get storagePath(): string {
    return this.indexPath;
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.indexPath, 'utf8')) as unknown;
      if (!isRecentIndex(parsed)) {
        this.warning = 'Recent projects could not be loaded safely; the list is empty.';
        return;
      }
      this.records = parsed.records.slice(0, 5);
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT')
        this.warning = 'Recent projects could not be loaded safely; the list is empty.';
    }
  }

  get(recentId: string): RecentRecord | undefined {
    return this.records.find((record) => record.recentId === recentId);
  }

  async list(): Promise<ListRecentResult> {
    const refreshed = await Promise.all(
      this.records.map(async (record) => {
        const validation = await validateProjectDirectory(record.mainOnlyPath);
        if (validation.ok) {
          if (validation.manifest.projectId !== record.projectId) {
            return {
              ...record,
              availability: 'invalid' as const,
              diagnosticCode: 'PROJECT_INVALID' as const,
            };
          }
          return {
            ...record,
            displayName: validation.manifest.displayName,
            availability: 'available' as const,
            diagnosticCode: null,
          };
        }
        return {
          ...record,
          availability: availabilityFor(validation.error.code),
          diagnosticCode: diagnosticFor(validation.error.code),
        };
      }),
    );
    this.records = refreshed.sort(sortNewest);
    return {
      recentProjects: this.records.map(toSummary),
      ...(this.warning ? { warning: this.warning } : {}),
    };
  }

  async upsert(
    projectRoot: string,
    project: ProjectSnapshot,
    recentId?: string,
    now = new Date().toISOString(),
  ): Promise<RecentProjectSummary> {
    const existing = this.records.find(
      (record) => record.projectId === project.projectId || record.recentId === recentId,
    );
    const record: RecentRecord = {
      recentId: existing?.recentId ?? recentId ?? randomUUID(),
      projectId: project.projectId,
      mainOnlyPath: path.resolve(projectRoot),
      displayName: project.displayName,
      lastOpenedAt: now,
      availability: 'available',
      diagnosticCode: null,
    };
    const next = [
      record,
      ...this.records.filter(
        (candidate) =>
          candidate.recentId !== record.recentId && candidate.projectId !== record.projectId,
      ),
    ]
      .sort(sortNewest)
      .slice(0, 5);
    await this.persist(next);
    this.records = next;
    return toSummary(record);
  }

  async remove(recentId: string): Promise<void | ProjectError> {
    if (!this.get(recentId))
      return { code: 'RECENT_NOT_FOUND', message: 'Recent project record was not found.' };
    const next = this.records.filter((record) => record.recentId !== recentId);
    await this.persist(next);
    this.records = next;
  }

  private async persist(records: RecentRecord[]): Promise<void> {
    const value: RecentIndex = {
      kind: RECENT_INDEX_KIND,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      records,
    };
    try {
      await writeAtomicJson(this.indexPath, value);
    } catch {
      throw new Error('RECENT_INDEX_WRITE_FAILED');
    }
  }
}

export function toSummary(record: RecentRecord): RecentProjectSummary {
  const { mainOnlyPath: _path, ...summary } = record;
  return summary;
}

function isRecentIndex(value: unknown): value is RecentIndex {
  if (
    !isRecord(value) ||
    value.kind !== RECENT_INDEX_KIND ||
    value.schemaVersion !== PROJECT_SCHEMA_VERSION ||
    !Array.isArray(value.records)
  )
    return false;
  if (value.records.length > 5 || !value.records.every(isRecentRecord)) return false;
  const records = value.records as RecentRecord[];
  if (new Set(records.map((record) => record.recentId)).size !== records.length) return false;
  if (new Set(records.map((record) => record.projectId)).size !== records.length) return false;
  return records.every(
    (record, index) => index === 0 || sortNewest(records[index - 1], record) <= 0,
  );
}

function isRecentRecord(value: unknown): value is RecentRecord {
  if (
    !isRecord(value) ||
    !isUuid(value.recentId) ||
    !isUuid(value.projectId) ||
    typeof value.mainOnlyPath !== 'string' ||
    !path.isAbsolute(value.mainOnlyPath) ||
    typeof value.displayName !== 'string' ||
    !isValidTimestamp(value.lastOpenedAt)
  )
    return false;
  if (value.availability === 'available') return value.diagnosticCode === null;
  if (value.availability === 'missing') return value.diagnosticCode === 'PROJECT_NOT_FOUND';
  if (value.availability === 'inaccessible') return value.diagnosticCode === 'PROJECT_INACCESSIBLE';
  return (
    value.availability === 'invalid' &&
    (value.diagnosticCode === 'PROJECT_INVALID' ||
      value.diagnosticCode === 'PROJECT_UNSUPPORTED_VERSION')
  );
}

function sortNewest(a: RecentRecord, b: RecentRecord): number {
  return Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt);
}

function availabilityFor(code: string): RecentRecord['availability'] {
  if (code === 'PROJECT_NOT_FOUND') return 'missing';
  if (code === 'PROJECT_INACCESSIBLE') return 'inaccessible';
  return 'invalid';
}

function diagnosticFor(code: string): RecentRecord['diagnosticCode'] {
  if (code === 'PROJECT_NOT_FOUND') return 'PROJECT_NOT_FOUND';
  if (code === 'PROJECT_UNSUPPORTED_VERSION') return 'PROJECT_UNSUPPORTED_VERSION';
  if (code === 'PROJECT_INACCESSIBLE') return 'PROJECT_INACCESSIBLE';
  return 'PROJECT_INVALID';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === 'string';
}
