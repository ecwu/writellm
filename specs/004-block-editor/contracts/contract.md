# Contract: Block editor IPC and adapter boundaries

Status: Draft design; frozen only when the 004 plan and ADR-001 are accepted.

## Preload namespace

Preload exposes one named namespace, `window.writellmChapters`. The active project
is main-owned; renderer submits no project ID, path, Git command or repository
handle.

```ts
type ChapterErrorCode =
  | "NO_ACTIVE_PROJECT"
  | "OUTLINE_ITEM_NOT_FOUND"
  | "CHAPTER_NOT_FOUND"
  | "INVALID_INPUT"
  | "INVALID_DOCUMENT"
  | "PAYLOAD_TOO_LARGE"
  | "REVISION_CONFLICT"
  | "STORAGE_READ_FAILED"
  | "STORAGE_WRITE_FAILED"
  | "STORAGE_RECOVERY_REQUIRED"
  | "UNSUPPORTED_SCHEMA"
  | "CONVERSION_FAILED"
  | "EXPORT_FAILED";

type ChapterError = {
  code: ChapterErrorCode;
  message: string;
  retryable: boolean;
};

type ChapterResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ChapterError };

interface ChapterApi {
  openForOutlineItem(input: {
    outlineItemId: string;
    baseOrientationRevision: number;
    mutationId: string;
  }): Promise<ChapterResult<{ document: ChapterDocument; created: boolean }>>;

  load(input: {
    chapterId: string;
  }): Promise<ChapterResult<ChapterDocument>>;

  save(input: {
    chapterId: string;
    baseRevision: number;
    mutationId: string;
    blocks: BlockNoteBlockSnapshot[];
    citations: CitationAnchor[];
  }): Promise<ChapterResult<{ document: ChapterDocument }>>;

  previewMarkdownExport(input: {
    chapterId: string;
    blocks: BlockNoteBlockSnapshot[];
    citations: CitationAnchor[];
  }): Promise<ChapterResult<MarkdownPreview>>;

  exportMarkdown(input: {
    chapterId: string;
    previewId: string;
  }): Promise<ChapterResult<{ status: "exported" | "canceled" }>>;
}
```

`openForOutlineItem` is an idempotent create-or-open operation. Main reloads the
accepted 003 orientation document, verifies the item, and returns its linked
chapter. Creation uses the shared content transaction required by ADR-001 so the
orientation link and revision-0 empty chapter either both commit or neither does.

`save` is the only canonical chapter write. Block operations are renderer-local
editor commands until the bounded snapshot crosses this method. Main validates
the full document, active session and `baseRevision`, serializes saves per
project, atomically replaces the file and completes the ADR-001 Git transaction
before returning success.

## Revision, conflict and idempotency

- `baseRevision` must equal the current durable revision. Otherwise main returns
  `REVISION_CONFLICT` with no write and no saved-content payload.
- On conflict, renderer retains its local draft and separately calls `load` to
  offer “keep current” or “reload saved”. No silent last-writer-wins path exists.
- `mutationId` is a UUID scoped to one active project session, method and exact
  validated payload. Repeating a completed request returns its prior result;
  reusing it for another method/payload returns `INVALID_INPUT`.
- A successful save increments revision exactly once. A failed, cancelled,
  preview-only or conflict result does not increment revision.
- Autosave and “save now” use the same `save` method and state machine. At most one
  save per chapter is in flight in a renderer view; main serialization remains
  authoritative across views.

## Markdown boundary

- Markdown support is the selected editor adapter's pinned CommonMark/GFM-derived
  baseline enumerated by FR-013; no additional dialect is implied.
- The renderer adapter parses explicit Markdown paste into a transient
  `MarkdownPastePreview` with candidate blocks and warnings. It inserts the
  candidate only after required confirmation. Cancel or conversion failure leaves
  editor state and durable content unchanged; no privileged IPC is needed.
- Export first produces `MarkdownPreview`. Warnings identify lossy blocks and
  citations. `exportMarkdown` accepts only the unexpired preview ID, opens a
  main-owned save dialog and writes exactly the previewed UTF-8 Markdown.
- Export cancellation is a successful `{status: "canceled"}` domain result;
  export failure is distinct from canonical chapter save failure.
- Markdown cannot restore BlockNote IDs or citation truth. It may contain readable
  citation degradation, but import treats that as text unless a future accepted
  citation-import contract says otherwise.

## Editor adapter contract

The renderer adapter owns BlockNote construction and maps user intent to editor
transactions. It must provide:

- load/replace a validated `BlockNoteBlockSnapshot[]`;
- read a bounded snapshot;
- create, edit, move, split, merge and delete blocks;
- normalize the last-block deletion to a valid editable empty document;
- remap citations using transaction mapping and return every ambiguous anchor as
  `needs-review`;
- emit monotonically increasing local generations for dirty tracking.

The adapter does not expose its editor instance across preload, read files, choose
paths, assign durable revisions, write Git history or report a local transaction
as durably saved.

## Validation and redaction

Main validates sender, active project session, plain-object DTO shape, exact
properties, UUIDs, outline/chapter linkage, revision, schema, block IDs/types,
nesting, citation ranges, preview ownership/expiry and all ceilings in
`data-model.md`. Unknown properties and prototype-bearing inputs are rejected.

`message` is safe user-facing text. No result may contain an absolute path, raw
exception, stack, IPC channel, Electron object, editor instance, database/Git
handle or secret. Preload exposes no generic `send`, `invoke` or event channel.

## Durable storage contract

Logical path: `workspace/chapters/<chapterId>.json` below the validated project
root; only main resolves the absolute path. Missing linked files, malformed JSON,
identity mismatch and unknown schema are explicit errors, never empty chapters.

Writes use the main-owned serialized content transaction and recovery rules in
accepted ADR-001: sibling temporary file, flush/close, atomic replacement,
structured Git commit, pending receipt and conservative recovery. Ambiguity yields
`STORAGE_RECOVERY_REQUIRED`; it never overwrites a valid target automatically.
