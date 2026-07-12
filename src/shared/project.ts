export const PROJECT_KIND = 'writellm.project' as const;
export const RECENT_INDEX_KIND = 'writellm.recent-index' as const;
export const CLEANUP_INDEX_KIND = 'writellm.pending-project-cleanups' as const;
export const PROJECT_SCHEMA_VERSION = 1 as const;
export const REQUIRED_PROJECT_DIRECTORIES = ['workspace'] as const;

export type ProjectManifest = {
  kind: typeof PROJECT_KIND;
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  projectId: string;
  displayName: string;
  requiredDirectories: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectSnapshot = {
  projectId: string;
  displayName: string;
};

export type ProjectAvailability = 'available' | 'missing' | 'invalid' | 'inaccessible';

export type RecentDiagnosticCode =
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_INVALID'
  | 'PROJECT_UNSUPPORTED_VERSION'
  | 'PROJECT_INACCESSIBLE'
  | null;

export type RecentProjectSummary = {
  recentId: string;
  projectId: string;
  displayName: string;
  lastOpenedAt: string;
  availability: ProjectAvailability;
  diagnosticCode: RecentDiagnosticCode;
};

export type RecentRecord = RecentProjectSummary & { mainOnlyPath: string };

export type RecentIndex = {
  kind: typeof RECENT_INDEX_KIND;
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  records: RecentRecord[];
};

export type CleanupReceipt = {
  finalRoot: string;
  token: string;
  createdAt: string;
};

export type CleanupReceiptIndex = {
  kind: typeof CLEANUP_INDEX_KIND;
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  receipts: CleanupReceipt[];
};

export type ProjectErrorCode =
  | 'INVALID_PROJECT_NAME'
  | 'PROJECT_EXISTS'
  | 'PROJECT_INVALID'
  | 'PROJECT_UNSUPPORTED_VERSION'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_INACCESSIBLE'
  | 'PROJECT_ID_MISMATCH'
  | 'RECENT_NOT_FOUND'
  | 'STORAGE_READ_FAILED'
  | 'STORAGE_WRITE_FAILED';

export type ProjectError = {
  code: ProjectErrorCode;
  message: string;
};

export type ProjectFailure = { status: 'error'; error: ProjectError };
export type Canceled = { status: 'canceled' };
export type ProjectSuccess<T extends object> = {
  status: 'created' | 'opened';
  project: ProjectSnapshot;
} & T;
export type RemoveRecentSuccess = { status: 'removed'; recentId: string };

export type CreateProjectResult = ProjectSuccess<{}> | Canceled | ProjectFailure;
export type OpenProjectResult = ProjectSuccess<{}> | Canceled | ProjectFailure;
export type RemoveRecentResult = RemoveRecentSuccess | ProjectFailure;

export type ListRecentResult = {
  recentProjects: RecentProjectSummary[];
  warning?: string;
};

export type CleanupWarning = string;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
