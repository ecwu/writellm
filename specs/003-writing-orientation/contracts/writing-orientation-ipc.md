# Writing Orientation IPC Contract

Namespace: `window.writellmWritingOrientation`

```ts
type OutlineStatus = "not-started" | "in-progress" | "completed";

type MotivationInput = {
  problem: string;
  targetReaders: string;
  desiredOutcome: string;
};

type ExistingOutlineItemInput = {
  outlineItemId: string;
  clientDraftId?: never;
  title: string;
  summary: string;
  status: OutlineStatus;
};

type NewOutlineItemInput = {
  outlineItemId?: never;
  clientDraftId: string;
  title: string;
  summary: string;
  status: OutlineStatus;
};

type OutlineItemSaveInput = ExistingOutlineItemInput | NewOutlineItemInput;

type SaveOrientationValue = {
  document: WritingOrientationDocument;
  createdItemIds: Array<{
    clientDraftId: string;
    outlineItemId: string;
  }>;
};

type OrientationErrorCode =
  | "NO_ACTIVE_PROJECT"
  | "INVALID_INPUT"
  | "PAYLOAD_TOO_LARGE"
  | "REVISION_CONFLICT"
  | "LINKED_DELETE_NOT_AVAILABLE"
  | "GIT_INITIALIZATION_FAILED"
  | "GIT_COMMIT_FAILED"
  | "STORAGE_READ_FAILED"
  | "STORAGE_WRITE_FAILED"
  | "STORAGE_RECOVERY_REQUIRED"
  | "UNSUPPORTED_SCHEMA";

type OrientationError = {
  code: OrientationErrorCode;
  message: string;
  retryable: boolean;
};

type OrientationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: OrientationError };

type DeleteOutlineItemValue = {
  kind: "deleted";
  outlineItemId: string;
  document: WritingOrientationDocument;
};

interface WritingOrientationApi {
  load(): Promise<OrientationResult<WritingOrientationDocument>>;
  save(input: {
    baseRevision: number;
    mutationId: string;
    motivation: MotivationInput;
    outlineItems: OutlineItemSaveInput[];
  }): Promise<OrientationResult<SaveOrientationValue>>;
  deleteOutlineItem(input: {
    outlineItemId: string;
    baseRevision: number;
    mutationId: string;
  }): Promise<OrientationResult<DeleteOutlineItemValue>>;
}
```

The active project comes from the main-owned session; renderer does not submit a path or project ID.

For `save`, an existing item carries exactly one durable `outlineItemId`; a new item carries exactly one renderer-generated UUID `clientDraftId`. Neither input variant contains `chapterRef`: main preserves that field from the current canonical document and assigns `null` to new items. The durable-ID set in the request must exactly equal the current document's durable-ID set, so omission cannot act as deletion. The successful response contains a canonical document plus a complete `clientDraftId` to generated `outlineItemId` mapping for every new item in that request.

`deleteOutlineItem` is the only 003 deletion path. Main reloads the current document after validating `baseRevision`. An unlinked item is deleted directly. If the authoritative item has a non-null `chapterRef`, 003 returns `LINKED_DELETE_NOT_AVAILABLE` and changes nothing. A stale revision never authorizes deletion. A future 004 accepted extension may replace this refusal with a separately reviewed atomic linked-delete transaction; 003 does not reserve a confirmation boolean or speculate about that contract.

`mutationId` is a UUID scoped to the active project session and one exact method plus payload. Repeating the same completed request returns the previous result. Reusing it with a different method or payload returns `INVALID_INPUT`; failed results perform no write and may be retried with a new mutation ID.

Stable error codes are exactly `NO_ACTIVE_PROJECT`, `INVALID_INPUT`, `PAYLOAD_TOO_LARGE`, `REVISION_CONFLICT`, `LINKED_DELETE_NOT_AVAILABLE`, `GIT_INITIALIZATION_FAILED`, `GIT_COMMIT_FAILED`, `STORAGE_READ_FAILED`, `STORAGE_WRITE_FAILED`, `STORAGE_RECOVERY_REQUIRED`, and `UNSUPPORTED_SCHEMA`. `message` is safe user-facing text, `retryable` describes whether repeating after the user or environment addresses the cause is meaningful, and neither field may contain a path, raw exception, stack, secret, channel name, or Electron object. Unknown properties and non-plain-object payloads are rejected.

Main validates sender, active session, DTO shape, IDs, status, uniqueness, NUL, size and revision. Preload exposes no generic invoke, paths, filesystem/Git handles, Electron objects or raw Error/stack.
