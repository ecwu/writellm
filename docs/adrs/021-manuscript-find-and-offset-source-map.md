# ADR 021: Manuscript Find, Semantic Text Spans, And Offset Source Maps

Status: accepted for Checkpoint 29; implementation authorized
Date: 2026-08-12

## Context

WriteLLM already exposes an Agent-only `search_manuscript` read tool. Its matcher flattens a
BlockNote block, applies NFC and `toLocaleLowerCase()`, finds ranges in that transformed string,
then uses those offsets against the original text. This is incorrect whenever normalization or
lowercasing changes UTF-16 length. It is also locale-dependent and cannot identify the original
inline text nodes needed by navigation or the later safe-replacement checkpoint.

Checkpoint 29 adds interactive manuscript-wide literal find over section metadata and current
BlockNote revisions. The result must remain exact across styled text, links, tables, Unicode
normalization, and length-changing lower mappings without turning a flattened string offset into
manuscript authority. It must also stay within the accepted Renderer sandbox, current-revision
authority, fixed worker roles, and request-scoped work model.

A planning probe on 2026-08-12 ruled out constructing a grapheme record for every character in an
8 MiB manuscript: a naive `Intl.Segmenter` pass took roughly 0.9-1.6 seconds on the planning host.
Whole-string NFC/lower/search on the same synthetic sizes took roughly 18-72 milliseconds. These
numbers are design evidence only, not CP29 acceptance evidence; CP29 ships the reproducible
benchmark defined below.

## Decision

### 1. Search semantics are deterministic and deliberately narrower than full Unicode caseless matching

The two initial modes are:

```ts
case-sensitive:   NFC(input)
case-insensitive: NFC(input).toLowerCase()
```

`String.prototype.toLowerCase()` is used without a locale. `toLocaleLowerCase()` is prohibited in
the matcher. This makes results independent of the operating-system locale while retaining the
current Unicode lower-mapping behavior. CP29 does not use NFKC, accent stripping,
transliteration, stemming, regular expressions, or the Unicode full case-fold table. In
particular, compatibility forms remain distinct and `Straße` is not required to match `STRASSE`.

Matches are left-to-right and non-overlapping. A query never crosses a section-metadata field,
BlockNote block, table cell, block property, or child-block boundary. Within one ordinary inline
surface it may cross adjacent styled-text and link nodes because formatting does not insert
visible characters. Empty, ill-formed-Unicode, and over-limit queries are rejected.

The Renderer surface searches, in manuscript order:

1. section title;
2. section objective, when present;
3. visible inline text for paragraph, heading, list-item, quote, and code blocks;
4. each table cell as a separate surface in row/cell order; and
5. the visible `caption` property of image, Mermaid, and math blocks.

Image names and Mermaid/math source are not included because they are not visible manuscript prose
in the main editing surface. The existing Agent adapter may retain its currently bounded Agent-text
surface selection, including source-oriented text, but it uses the same projection matcher and
source-map implementation. CP29 does not add or rename an Agent tool and does not change the
model-visible `search_manuscript` schema.

### 2. Original semantic spans, not flattened offsets, identify a hit

Each Renderer-facing occurrence has a discriminated target:

```ts
type ManuscriptSearchTarget =
  | {
      kind: 'section_title' | 'section_objective'
      sectionId: string
      range: Utf16Range
    }
  | {
      kind: 'block_inline'
      sectionId: string
      revisionId: string
      blockId: string
      segments: NonEmptyArray<InlineTextSegment>
    }
  | {
      kind: 'table_cell'
      sectionId: string
      revisionId: string
      blockId: string
      rowIndex: number
      cellIndex: number
      segments: NonEmptyArray<InlineTextSegment>
    }
  | {
      kind: 'block_caption'
      sectionId: string
      revisionId: string
      blockId: string
      property: 'caption'
      range: Utf16Range
    }

interface InlineTextSegment {
  inlineIndex: number
  linkTextIndex?: number
  range: Utf16Range
}

interface Utf16Range {
  from: number // inclusive, in the original stored string
  to: number   // exclusive, in the original stored string
}
```

For a `block_inline` target, `inlineIndex` addresses the block's `content` array and the optional
`linkTextIndex` addresses a styled-text child of a link. For a `table_cell` target, the same path is
relative to the identified cell's inline content. Segments are ordered, non-empty, non-overlapping,
and together reproduce the original visible match. These are application-owned semantic paths,
not arbitrary JSON Pointer or JSON Patch paths.

A result also carries a bounded plain-text preview, outline heading path, section title/status,
and a derived editor-decoration locator. The locator is never mutation authority. CP30 must
revalidate the semantic target and its original strings and must not apply a replacement from a
preview, ProseMirror position, DOM node, or flattened block range.

Metadata ranges are tied to the exact outline snapshot. Body targets carry the exact current
revision ID. A stable `matchId` hashes the matching mode, semantic path, original ranges, and hash
of the original matched slices; it contains no manuscript text and deliberately excludes the
whole-manuscript snapshot fingerprint so unrelated saves do not change it.

### 3. The offset source map has two layers and a fast path

The pure matcher first constructs an original surface:

```ts
interface SourceRun {
  flatFrom: number
  flatTo: number
  target: metadata range | inline-text-node range | caption range
}

interface OffsetMapRun {
  searchFrom: number
  searchTo: number
  sourceFrom: number
  sourceTo: number
  mapping: 'linear' | 'atomic'
}
```

`SourceRun` maps a raw, concatenated visible surface back to the stored strings. The
`OffsetMapRun` sequence maps the transformed search projection back to that raw surface.

For the common path, if `raw.normalize('NFC') === raw` and the selected lower mapping preserves
UTF-16 length, the entire surface receives a linear map. A transformed interval maps directly to
the same raw UTF-16 interval and is then intersected with `SourceRun` boundaries to produce the
semantic segments.

Only a surface whose normalization changes or whose lower mapping changes length takes the slow
path. That surface is segmented into extended grapheme clusters with one reused
`Intl.Segmenter('und', { granularity: 'grapheme' })`. Each cluster is transformed independently and
becomes a map run. A run may be linear only when every internal UTF-16 boundary remains reversible;
composition, reordering, expansion, or contraction produces an atomic run. The concatenated
per-cluster projection must equal the whole-surface projection; a mismatch fails closed and is
covered by property tests.

A candidate match whose start or end falls inside an atomic run is rejected. A candidate that
consumes the complete run maps to the complete original grapheme. Thus a decomposed `e` plus acute
may match composed `é` and returns the two original UTF-16 code units, while a query that matches
only half of a length-expanded lowercase mapping cannot produce a destructive or misleading
range.

The offset source map is ephemeral derived memory. It is not returned as a generic transform,
persisted, stored in SQLite, reused after a revision change, or exposed as a mutation capability.

### 4. Main captures one authoritative search snapshot and pagination is fail-closed

Main assembles outline metadata and all current section revisions in one existing short SQLite
snapshot. Its fingerprint is SHA-256 over a versioned canonical structure containing the outline
version and the ordered section IDs, structure/status metadata, title/objective hashes, current
revision IDs, and content hashes. It never contains or logs the query or manuscript text.

The request contract contains:

- the active `projectSessionId`;
- a well-formed query of 1-512 UTF-16 code units;
- `caseSensitive`;
- one scope: whole manuscript, explicit section IDs, or one outline subtree root;
- zero or more section statuses;
- an optional opaque cursor; and
- a page limit of 1-50, defaulting to 25.

Results are ordered by outline order, then title/objective/body surface order, then original
range. At most 2,000 occurrences are navigable for one request fingerprint. Reaching that limit
returns `complete: false` and `incompleteReason: 'result_limit'`; it is never presented as a full
count. A cursor encodes a version, snapshot fingerprint, request fingerprint, and next occurrence
ordinal. Main recomputes and validates all fields. A changed snapshot, changed options, malformed
cursor, or project switch fails as stale/invalid instead of mixing pages.

Scanning is request-scoped. It uses the active project's operation tracker, checks its abort signal
between surfaces, yields to Main after at most 16 milliseconds of synchronous work, and enforces a
250-millisecond scan budget for the maximum fixture. A budget exit is explicit
`incompleteReason: 'scan_budget'` with scanned section/byte counts; the UI asks the user to narrow
scope and never implies exhaustive results. Project close or switch aborts the request and no
search row is written to `jobs` or another table.

### 5. Activation flushes, revalidates, then navigates without guessing

Opening Find does not save. Query changes are debounced, and normal autosave/revision changes
invalidate the current query through existing Renderer state. Selecting a result performs:

1. flush the current editor content and pending section-title metadata through the existing paths;
2. ask Main to revalidate the exact semantic path, original ranges, source-slice hash, query mode,
   and active project session against current authority;
3. if stale, refresh results, retain Find focus, and report that the manuscript changed; never
   relocate by nearest text or occurrence number;
4. if valid, switch through the existing serialized section-switch path without editor autofocus;
5. wait until the loaded editor revision equals Main's validated revision;
6. scroll the exact text range or owning block into view and install a non-mutating temporary
   highlight.

Inline and table highlights use an application-owned BlockNote extension with an official
ProseMirror plugin and `DecorationSet`, following the existing readable-citation extension. The
adapter resolves the stable block ID and validated surface-local range against the loaded
ProseMirror document; it must not depend on `_tiptapEditor`, persist a ProseMirror position, or
rewrite BlockNote JSON. BlockNote 0.47.2's public `getBlock`, `prosemirrorState`,
`prosemirrorView`, and extension/plugin surfaces are the pinned integration boundary.

The selected result remains the durable visual/accessible indicator. The editor decoration clears
on document change, another result, query change, Escape, Find close, or project switch; it does
not use a short timer that a keyboard or assistive-technology user could miss. Caption results
scroll to and mark the owning rich-media block. Title results select the exact range in the title
editor only when the user explicitly chooses to edit it. Objective results open the existing
outline editor at that section and exact field. Navigation never changes Agent conversation,
stream, selection capture, or proposal state.

### 6. Find extends the existing workspace language

`Cmd/Ctrl+F` and an enabled-project Menubar item open Find and focus its query. Find is a new
workspace-rail destination that keeps the editor mounted and replaces the contextual secondary
sidebar contents, like References. The shadcn `Command` composition renders the query and remote
result list with client filtering disabled; official Button, DropdownMenu/Popover, Badge, Empty,
and Sidebar behavior provide filters and states. No parallel component system or general
command-palette framework is introduced.

The default result shows section/outline context, one bounded excerpt with the matched text
distinguished, and target type only when it is not ordinary body text. Filters are progressive
disclosure, not an always-visible form. Enter activates the selected result; next/previous
commands and result counts are keyboard and screen-reader accessible. Results, filters,
empty/error/incomplete states, and close controls remain reachable in the desktop workspace.
Scrolling honors reduced motion.

### 7. Reuse is at the matching core, not through an Agent or Renderer dependency

The source enumerators, Unicode projection matcher, semantic-span builder, ordering/filter rules,
and snapshot fingerprint are pure application-owned domain functions. A Main manuscript-search
service owns assembly, budgets, pagination, revalidation, logging, and the Renderer IPC adapter.

The Agent tool calls the same projection matcher behind its existing snapshot and output limits.
Its adapter continues to return the current bounded block-level result shape, but every legacy
`matchRanges` entry is projected back to original Agent block text before being returned. The
Renderer never calls an Agent tool, and the Agent service never imports Renderer contracts.

No new dependency, database migration, worker role, durable job, persisted search history,
manuscript FTS table, or `index.sqlite` content is introduced in CP29.

## Performance Decision Gate

CP29 adds `scripts/benchmark-manuscript-search.mjs`, following the repository's existing benchmark
style. The fixture reaches the accepted manuscript maxima (1,000 sections and 8 MiB current
workspace) and contains mixed English, Chinese, styled/link-split phrases, tables, captions,
composed/decomposed text, and length-changing lowercase cases. It records fixture fingerprint,
runtime/architecture, query/mode, warmups/samples, p50/p95 wall time, maximum synchronous slice,
scanned bytes/surfaces, slow-path surfaces, hit count, and peak RSS delta.

After five warmups, at least 30 complete scans per representative query must meet both:

- p95 wall time at or below 250 milliseconds; and
- maximum synchronous Main slice at or below 16 milliseconds.

The benchmark is opt-in performance evidence, not a flaky routine test. Correctness, budget exit,
and yield behavior remain deterministic test-suite coverage. If the reference fixture misses
either threshold, implementation stops before adding an index or moving authority. A revised
decision must compare a project-local derived manuscript index against the existing bounded scan
and obtain explicit approval.

## Observability And Safety

Lifecycle logs use `subsystem: 'manuscript'` and fixed events for search completion, cancellation,
budget/limit truncation, failure, navigation validation, and stale navigation. Safe fields include
operation/request ID, project/session IDs, mode, filter counts, query UTF-16 length, scanned
section/surface/byte counts, hit count, slow-path count, incomplete reason, and duration. Logs never
contain the query, title/objective, excerpts, matched text, inline paths with content, document
bodies, or private paths. Every caught failure logs the original top-level `err` before returning
a sanitized IPC error.

Every IPC input/output is a shared strict Zod contract with byte and collection limits. Main
authorizes the sender, validates the active `projectSessionId` before capture and after async scan,
tracks cancellation, and rejects stale results after close/switch. Search and navigation are read
operations except for the explicit existing editor flush; neither grants database, filesystem,
credential, Agent, or mutation authority to Renderer.

## Acceptance And Verification

Implementation acceptance requires all of the following:

- exact original UTF-16 slices for NFC composed/decomposed text, combining-mark reorderings,
  Turkish dotted/dotless I, Greek sigma forms, German sharp-S forms, CJK, emoji/surrogates, and
  length expansion/contraction; results are invariant under the host locale;
- property tests showing projection/source-map round-trip invariants and fail-closed atomic-run
  boundaries;
- styled/link-crossing matches return ordered semantic segments, while block/table-cell/property
  boundaries never merge;
- title, objective, inline, table-cell, code, and caption coverage plus deterministic ordering,
  subtree/section/status filters, result cap, budget exit, cursor tampering, stale snapshot, abort,
  and output-byte bounds;
- Agent/UI matcher equivalence for shared fixtures with an unchanged Agent tool schema and exact
  legacy ranges on original Agent text;
- navigation flush/revalidation, unrelated-save tolerance, same-target stale rejection, revision
  load ordering, decoration/citation coexistence, edit invalidation, and project-switch cleanup;
- desktop Real-Electron coverage for Menubar and `Cmd/Ctrl+F`, keyboard-only filters and
  result traversal, unsaved edits, exact scroll/highlight, incomplete/error/empty states, focus
  preservation, reduced motion, and screen-reader labels/status;
- the performance decision gate above, `pnpm check:fast`, focused Electron tests,
  `pnpm check:electron`, a fresh build plus the focused/full applicable E2E gate, the scoped
  Impeccable detector, and `git diff --check`.

Package/release verification is not required because CP29 changes no Electron major, native module,
worker entrypoint, packaged resource, builder, or release boundary.

## Consequences

Find results become safe inputs for exact navigation and a later replacement planner without
making search state authoritative. The common path remains a bounded current-revision scan, while
pathological Unicode and result volume fail visibly within explicit budgets. The offset map adds a
small pure domain abstraction, but avoids a manuscript index, new process, schema migration, and
duplicate Agent/Renderer matcher.

Regular expressions, fuzzy/semantic search, accent-insensitive search, full Unicode case folding,
cross-block phrases, persisted query history, replace, and a derived manuscript index remain
deferred. CP30 owns mutation planning and application; CP29 exposes no replacement IPC.
