# Data Model: Block editor

## Durable aggregate

`ChapterDocument` is the canonical, revisioned snapshot for one outline item. It is
stored inside the active project and contains editor-native BlockNote blocks plus
WriteLLM-owned citation relations. Markdown is an interchange projection, never a
second durable truth.

```ts
type ChapterDocument = {
  kind: "writellm.chapter.blocknote";
  schemaVersion: 1;
  projectId: string;
  chapterId: string;
  outlineItemId: string;
  revision: number;
  editorFormat: "blocknote-json";
  editorSchemaVersion: 1;
  blocks: BlockNoteBlockSnapshot[];
  citations: CitationAnchor[];
  createdAt: string;
  updatedAt: string;
};
```

Main generates `chapterId`, timestamps and every new durable citation ID. Main
derives `projectId` from the active project session and rejects a payload whose
identities do not match the active project, linked outline item or stored chapter.
The displayed title is projected from 003's authoritative outline item at load;
it is not a second writable field in the chapter document.

## Entities

### Chapter

- Has exactly one `outlineItemId`; an outline item has zero or one chapter.
- Has one monotonically increasing `revision`, beginning at `0` for a newly
  created empty chapter and incrementing once per successful canonical save.
- An empty chapter is represented by the editor's valid empty document shape. It
  is never represented by a missing, null or malformed `blocks` value.

### BlockNote block snapshot

`BlockNoteBlockSnapshot` preserves the selected BlockNote schema's `id`, `type`,
`props`, inline/table content and ordered `children`. The exact discriminated
union is generated from the pinned editor schema during implementation and then
frozen in shared types.

Invariants:

- Block IDs are non-empty and unique across the whole chapter tree.
- Order and nesting come only from `blocks` and `children`; no parallel order
  field is persisted.
- The accepted editor schema supports the FR-013 baseline: headings, paragraphs,
  bullet/number/task lists, tables, code, quotes, links, images, emphasis,
  strike-through and hard breaks.
- Unknown block types, invalid props, excessive nesting or malformed inline
  content cause `UNSUPPORTED_SCHEMA` or `INVALID_DOCUMENT`; they are not dropped.
- Package version is runtime metadata, not a user-data schema version.

### Citation anchor

```ts
type CitationAnchor = {
  citationId: string;
  sourceId: string;
  chunkId: string;
  blockId: string;
  start: number;
  end: number;
  quotedText: string;
  status: "valid" | "needs-review";
  reviewReason?:
    | "range-split"
    | "text-deleted"
    | "block-missing"
    | "text-mismatch"
    | "ambiguous-transform";
};
```

Offsets use UTF-16 code units in the block's normalized plain-text projection,
matching JavaScript/editor selection semantics. `0 <= start < end <= text.length`
for a valid anchor, and `quotedText` must equal that range. Moving a complete
block preserves anchors. A split or merge remaps an anchor only when the complete
quoted range maps unambiguously; cutting through, deleting or ambiguously mapping
the range changes it to `needs-review`. Proximity alone never rebinds an anchor.

### Save draft state (renderer-only)

```ts
type ChapterDraftState = {
  baseRevision: number;
  localGeneration: number;
  persistedGeneration: number;
  saveStatus: "saved" | "dirty" | "saving" | "failed" | "conflict";
  lastError?: ChapterError;
};
```

This state is not part of `ChapterDocument`. Each edit increments
`localGeneration`. A successful save marks only the generation included in that
request as persisted, so edits made while a save is in flight remain dirty.

### Markdown conversion result (transient)

```ts
type ConversionWarning = {
  code: "UNSUPPORTED_MARKDOWN" | "LOSSY_BLOCK" | "LOSSY_CITATION";
  message: string;
  location?: { blockId?: string; line?: number };
};

type MarkdownPreview = {
  previewId: string;
  markdown: string;
  warnings: ConversionWarning[];
  expiresAt: string;
};

type MarkdownPastePreview = {
  previewId: string;
  candidateBlocks: BlockNoteBlockSnapshot[];
  warnings: ConversionWarning[];
  expiresAt: string;
};
```

A paste/import preview contains a candidate block snapshot and warnings held in
renderer/editor memory until confirmed or cancelled. Export preview contains
Markdown and warnings and is held by main for the bounded export flow. Preview
creation never mutates the chapter or its saved revision.

## State transitions

```text
no chapter --create--> revision 0 / saved empty chapter
saved --edit--> dirty --autosave/save-now--> saving
saving --success(no newer edits)--> saved
saving --success(newer edits)--> dirty
saving --failure--> failed --retry/edit--> saving/dirty
saving --stale base revision--> conflict
conflict --reload saved--> saved
conflict --keep current--> dirty at latest acknowledged base revision
```

“Keep current” acknowledges the latest saved revision but does not overwrite it;
the retained local draft remains dirty and requires a new explicit save attempt.
Leaving is unprompted only when `localGeneration === persistedGeneration`.

## Validation ceilings

The contract freezes a 2 MiB UTF-8 request ceiling, at most 10,000 blocks, block
tree depth at most 32, and at most 10,000 citations per chapter. Image content is
a validated URL/reference in the document, never an inline unbounded binary.
These are safety ceilings rather than user-facing performance targets and may
only change with contract review.
