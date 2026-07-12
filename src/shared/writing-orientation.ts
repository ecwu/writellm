export const ORIENTATION_KIND = 'writellm.writing-orientation' as const;
export const ORIENTATION_SCHEMA_VERSION = 1 as const;
export const ORIENTATION_MAX_BYTES = 2 * 1024 * 1024;

export type OutlineStatus = 'not-started' | 'in-progress' | 'completed';
export type MotivationInput = { problem: string; targetReaders: string; desiredOutcome: string };
export type OutlineItem = {
  outlineItemId: string;
  title: string;
  summary: string;
  status: OutlineStatus;
  chapterRef: string | null;
};
export type WritingOrientationDocument = {
  kind: typeof ORIENTATION_KIND;
  schemaVersion: typeof ORIENTATION_SCHEMA_VERSION;
  projectId: string;
  revision: number;
  updatedAt: string;
  motivation: MotivationInput;
  outlineItems: OutlineItem[];
};
export type ExistingOutlineItemInput = Omit<OutlineItem, 'chapterRef'> & { clientDraftId?: never };
export type NewOutlineItemInput = Omit<OutlineItem, 'outlineItemId' | 'chapterRef'> & {
  outlineItemId?: never;
  clientDraftId: string;
};
export type OutlineItemSaveInput = ExistingOutlineItemInput | NewOutlineItemInput;
export type SaveOrientationInput = {
  baseRevision: number;
  mutationId: string;
  motivation: MotivationInput;
  outlineItems: OutlineItemSaveInput[];
};
export type DeleteOutlineItemInput = {
  outlineItemId: string;
  baseRevision: number;
  mutationId: string;
};
export type SaveOrientationValue = {
  document: WritingOrientationDocument;
  createdItemIds: Array<{ clientDraftId: string; outlineItemId: string }>;
};
export type DeleteOutlineItemValue = {
  kind: 'deleted';
  outlineItemId: string;
  document: WritingOrientationDocument;
};
export type OrientationErrorCode =
  | 'NO_ACTIVE_PROJECT'
  | 'INVALID_INPUT'
  | 'PAYLOAD_TOO_LARGE'
  | 'REVISION_CONFLICT'
  | 'LINKED_DELETE_NOT_AVAILABLE'
  | 'GIT_INITIALIZATION_FAILED'
  | 'GIT_COMMIT_FAILED'
  | 'STORAGE_READ_FAILED'
  | 'STORAGE_WRITE_FAILED'
  | 'STORAGE_RECOVERY_REQUIRED'
  | 'UNSUPPORTED_SCHEMA';
export type OrientationError = { code: OrientationErrorCode; message: string; retryable: boolean };
export type OrientationResult<T> = { ok: true; value: T } | { ok: false; error: OrientationError };
export interface WritingOrientationApi {
  load(): Promise<OrientationResult<WritingOrientationDocument>>;
  save(input: SaveOrientationInput): Promise<OrientationResult<SaveOrientationValue>>;
  deleteOutlineItem(
    input: DeleteOutlineItemInput,
  ): Promise<OrientationResult<DeleteOutlineItemValue>>;
}
export const orientationChannels = {
  load: 'writellm:writing-orientation:load',
  save: 'writellm:writing-orientation:save',
  deleteOutlineItem: 'writellm:writing-orientation:delete-outline-item',
} as const;
