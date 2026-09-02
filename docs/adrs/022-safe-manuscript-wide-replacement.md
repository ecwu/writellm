# ADR 022: Safe Manuscript-Wide Replacement Plans And Atomic Application

Status: accepted for Checkpoint 30; implementation authorized
Date: 2026-08-12

## Context

Checkpoint 29 introduced exact literal matching, application-owned semantic text spans, original
UTF-16 source ranges, current-revision fingerprints, and fail-closed navigation revalidation. Those
results are safe locators, but they are not mutation authority. A replacement feature must decide
which visible strings are structurally safe to edit, present a complete preview, survive concurrent
manual or Agent changes, append ordinary manuscript revisions, keep asset reference accounting
correct, and never report a partially committed batch.

The existing manuscript authority already provides the necessary primitives: synchronous
`better-sqlite3` immediate transactions, canonical BlockNote revisions and content hashes,
revision asset-reference registration, atomic materialization with startup repair, an active-editor
mutation flush, and per-section revision lineage. Project version history is optional and cannot be
silently enabled. No existing durable record groups user-driven replacements, and CP30 does not
justify adding one.

Several CP29 search targets are deliberately unsuitable for the first replacement boundary.
Section titles and objectives are outline metadata without body-revision Undo lineage. Link text,
canonical citation labels, code blocks, inline code, and formula source carry structure beyond
plain prose. Treating all search hits as writable would therefore violate the promise of exact
preview and per-section Undo.

## Decision

### 1. CP30 replaces only revision-owned prose with an explicit eligibility matrix

The first release accepts literal replacement targets only when they can be rewritten inside one
current section revision without changing structural meaning:

| CP29 target or overlap | CP30 result | Reason |
| --- | --- | --- |
| Ordinary inline text in paragraph, heading, list item, or quote | Eligible | Revision-owned prose |
| Ordinary inline text in a table cell | Eligible | Revision-owned prose within one cell |
| Image, Mermaid, or math `caption` | Eligible | Plain revision-owned caption text |
| Section title or objective | Skipped | No equivalent body-revision Undo lineage |
| Any match overlapping a canonical readable citation | Skipped | Citation identity/provenance must remain canonical |
| Any match touching link text | Skipped | Plain replacement must not silently relabel a link |
| Any match in a code block or touching `styles.code` text | Skipped | Code is structured content |
| Mermaid or math source, image name/URL, block props other than caption | Not searched | Outside the CP29 prose surface |

One candidate that crosses both eligible and excluded nodes is skipped as a whole; it is never
partially rewritten. Skip reasons are the closed enum `section_metadata`, `readable_citation`,
`link_text`, `code_block`, `inline_code`, `structured_overlap`, and `unchanged`. When more than one
reason applies, that list is also the precedence order, except `unchanged` is evaluated only after
structural eligibility. Every reason is shown in preview. CP30 has no override that makes an
excluded candidate selectable. A later checkpoint may add a separately reviewed structured-edit
mode, but it must not widen this plain-text contract in place.

Readable-citation overlap is determined with the shared canonical citation parser over the exact
original surface. Link and inline-code overlap is determined from the semantic segments and their
stored inline nodes. The containing block type decides the code-block rule. This classification is
pure application-domain logic and is covered by fixtures; it is not inferred from DOM,
ProseMirror, decoration, preview, or rendered HTML state.

The query keeps CP29 semantics: well-formed UTF-16, 1-512 code units, NFC projection, optional
locale-independent `toLowerCase()`, left-to-right non-overlapping matches, and atomic grapheme
boundaries. The replacement is exact user text: 0-4,096 well-formed UTF-16 code units, with empty
text meaning deletion. CR, LF, and NUL are rejected because CP30 does not create or split blocks.
Replacement text is not normalized, case-folded, citation-expanded, or interpreted as markup.

A candidate whose concatenated original slices already equal the replacement is reported as
skipped `unchanged`. A replacement that happens to form readable citation syntax is allowed: it is
explicit user-authored canonical text, not an implicit structural conversion.

### 2. A complete bounded plan is an ephemeral Main-owned capability

Plan creation takes the active `projectSessionId`, the CP29 query/mode/scope/status filters, and
replacement text. Main first requests the existing serialized flush of pending active-section
title metadata and, when the active body is inside the requested scope, that body. It waits for
acknowledgement, then captures one authoritative manuscript assembly. It enumerates matches with
the CP29 domain core, classifies every match, and builds before/after previews. Renderer search
pages and CP29 cursors are never accepted as plan input.

A plan contains:

- a cryptographically random opaque `planId` scoped to the active project session;
- the exact outline version and scope/filter fingerprint;
- each candidate's CP29 semantic target, match/source hashes, containing block type, involved
  original-string hashes, eligibility, and skip reason;
- the exact current revision ID and content hash for each candidate section;
- bounded before/after preview text and aggregate eligible/skipped counts; and
- creation/expiry time and application state.

Only one unapplied live plan is retained per active project session. Creating another plan revokes
the previous unapplied plan. A plan expires after 15 minutes, on project close/switch, after
successful application, or when explicitly dismissed. A bounded completed-command receipt may
remain until the same expiry solely for idempotent retry, without remaining applicable. Main
retains at most 32 MiB for live-plan and receipt state, including the bounded 8 MiB manuscript
snapshot and derived candidates. Plan state is never stored in SQLite, a job, Renderer storage, or
a project file.

Plan creation must be exhaustive. It fails with an explicit `result_limit`, `scan_budget`, or
`plan_size` outcome rather than returning an applicable partial plan. The limits are:

- at most 2,000 total candidates, including skipped candidates;
- cooperative yield after at most 16 milliseconds of synchronous planning work;
- a 500-millisecond complete-plan budget on the maximum manuscript fixture;
- candidate pages of 1-50 entries; and
- at most 512 KiB for each IPC response.

Opaque plan cursors contain the plan ID, plan fingerprint, and next ordinal. A replaced, expired,
applied, malformed, or cross-session plan/cursor fails closed. Query and replacement text are not
embedded in cursors or IDs.

### 3. Selection is explicit and application revalidates only the selected body authority

Renderer initially selects no candidates. It may select individual eligible candidates, one
section's eligible candidates, or all eligible candidates within the application limit. Skipped
candidates are visible but cannot be selected. Application accepts one `planId`, a unique list of
candidate IDs, a random `commandId`, and whether to create an optional pre-change project
checkpoint.

One application is bounded to 500 selected candidates across at most 100 sections. Zero selection,
unknown/duplicate/ineligible candidate IDs, or a selection beyond either bound is rejected before
mutation. A larger replacement is performed only as multiple explicit re-plan/review/apply cycles;
the product never silently partitions one confirmation into partially successful batches.

The exact outline version is revalidated because deletion, movement, or metadata changes can make
the preview context misleading. For each selected section, Main revalidates inside the write
transaction:

- the section is active and belongs to the primary manuscript;
- current revision ID and content hash equal the plan base;
- every stored block ID, block type, table row/cell, inline/link index, property, and UTF-16 range
  still resolves;
- each involved original string hash and concatenated source-slice hash still matches;
- the candidate remains eligible under the same structural/citation rules; and
- the transformed section remains valid under BlockNote schema, per-section byte/block/inline/
  depth limits, and the 8 MiB current-workspace limit.

An unselected section revision may change without invalidating selected body replacements, but an
outline-version change invalidates the plan. Any failed selected precondition aborts the entire
transaction and returns a bounded conflict summary. Main never relocates a candidate, reruns a
nearest-text search, accepts a changed occurrence count, or applies the remaining candidates.

### 4. The pure transformer preserves structure and applies ranges deterministically

Candidates are grouped by section and surface, then applied from the greatest original offset to
the smallest. For a single ordinary text node, the replacement is a normal UTF-16 splice and the
node's styles are retained. For a match crossing adjacent ordinary styled-text nodes:

1. the replacement is inserted once at the first matched segment and inherits that node's styles;
2. matched slices are removed from every participating node;
3. untouched prefix/suffix text and its existing styles remain in their original nodes;
4. fully emptied text nodes are removed; and
5. adjacent nodes are not opportunistically merged.

Table-cell paths use the same rule relative to that cell. Caption replacement is a descending
splice in the exact `caption` string. Block IDs, hierarchy, props, links outside the match, asset
URLs, Mermaid/math source, and all unrelated JSON remain byte-semantically unchanged after
canonical serialization.

The transformer takes validated semantic candidates and a BlockNote document and returns one new
document plus an exact change summary. It does not know about IPC, SQLite, React, BlockNote editor
instances, ProseMirror positions, or filesystem materialization.

### 5. All selected canonical changes commit in one short transaction

After a second serialized active-body and pending-title mutation flush, the application service
enters one synchronous immediate SQLite transaction. It performs the complete precondition checks
and pure transforms, then appends at most one new revision for each affected section:

```text
source       = manual
source_class = manual_checkpoint
prior        = exact current revision from the plan
```

The existing canonical preparation recalculates content hash, word/character counts, and schema
version. Existing asset-reference extraction records the full asset set for each new revision.
The section's `current_revision_id` is changed with an exact compare-and-swap. Revision IDs and
timestamps are allocated before entering the transaction, but no authoritative result is emitted
until every selected section has committed.

No metadata row, Agent proposal, job, index, or external file is changed in the transaction. CP30
uses existing revision source values and therefore requires no project migration. Revision
retention is amended to protect the direct parent body of every retained `manual_checkpoint`
revision, analogous to the existing protection for an accepted Agent revision, so the promised
per-section Undo source cannot be pruned while its replacement checkpoint remains retained.

The maximum-application benchmark uses 100 affected sections, 500 selected candidates, mixed
styled/table/caption content, citations, links, and assets. After warmup, at least 30 applications
against disposable database copies must keep the SQLite transaction-body p95 at or below 100
milliseconds. Missing this gate stops implementation for a revised bound or transaction decision;
it does not justify a background worker or partial-commit protocol.

### 6. Materialization is post-commit repairable work, not a second authority

After the database transaction commits, the application service materializes every new current
revision through `EditorPersistenceService`. File publication remains outside the transaction. A
materialization failure is logged with the original error and returned as
`materializationPendingSectionIds`; it does not roll back or disguise the already-atomic canonical
database commit. Existing materialization guards prevent an older publication from overwriting a
newer revision, and startup/open repair restores missing or stale mirrors.

The user-facing state is therefore either:

- `conflict`/validation failure with zero canonical replacements committed; or
- `applied`/`already_applied`, meaning all selected canonical replacements committed, possibly
  with an explicit mirror-repair warning.

There is no state in which only some selected section revisions are accepted. If the process
crashes after database commit and before materialization or response, reopening reads the complete
canonical batch and repairs mirrors. The application does not claim that an unobserved response
was delivered.

While the process remains alive, the consumed plan retains the completed `commandId`, selection
fingerprint, revision IDs, and result until expiry. Retrying the same command returns
`already_applied`; a different command or selection against the consumed plan is rejected. Plan
state is intentionally not durable across process restart. Once the write transaction begins the
operation is non-cancellable; cancellation and project-close aborts are honored before that
boundary, then finalization completes against the committed authority.

### 7. Undo is a narrow per-section capability; project checkpoints stay optional

An applied result returns one random, session-bound Undo capability per affected section. Each
capability identifies only the replacement revision and its exact retained parent and expires
after 30 minutes, project close/switch, use, or a later change to that section. It is not a generic
revision-read or restore API.

Undo first flushes the active editor if it is the target section, then in one short transaction
verifies that the section's current revision is exactly the replacement revision and that the
parent body remains retained. It appends a new `source = undo`,
`source_class = manual_checkpoint` revision containing the parent's document and updates the
current pointer by compare-and-swap. Asset references, materialization, idempotent command retry,
and pending-repair reporting follow the application rules. One section's Undo has no effect on the
other sections in the original batch. A changed section fails stale rather than discarding later
work.

When managed project history is already `ready`, preview offers an optional named pre-change
checkpoint. If selected, Main creates it through the existing snapshot barrier after the final
flush and before replacement application, then revalidates the plan. `uninitialized` and `damaged`
history states are shown as unavailable; CP30 never enables, repairs, or requires version history.
Checkpoint failure prevents application. The generated name contains a timestamp but no query,
replacement, or manuscript content.

### 8. CP30 extends Find instead of creating another command system

This is an Operate-mode extension for an author already working in a long-lived editor session.
The interaction thesis is progressive commitment: find first, disclose replacement input, review a
complete immutable plan, then apply an explicit selection. The editor stays mounted and remains
visually primary; Replace does not become a standalone page or decorative diff experience.

Find gains a progressive-disclosure Replace mode. Entering replacement text performs no mutation.
`Review replacement` requests a complete plan and opens a grouped preview in the same workspace
rail language. Each candidate shows bounded before/after context, section/outline context,
target type when useful, eligibility, and a human-readable skip reason. Selection controls expose
individual, per-section, and all-eligible actions; the default selection is empty.

Preview uses one scroll region. Sections are ordered like the manuscript and use compact headings;
eligible candidates are immediately visible, while each section's skipped candidates sit in one
collapsed `Skipped (n)` disclosure. Before and after appear as stacked text in each candidate, not
side-by-side columns. A sticky action footer shows selected replacement/section counts and the
single confirmation action without covering the final result. The surface composes the existing
shadcn `Command` result language with official `Checkbox`, `Button`, `Collapsible`, `Badge`,
`Alert`, and Sidebar primitives. It does not use Cards as layout, add nested scroll regions,
create product-specific form controls, or introduce a second preview component system.

The confirmation action states the exact selected replacement and section counts. It is disabled
for zero selection, expired/stale plans, or exceeded bounds. Conflict keeps the query/replacement
draft, refreshes the plan, and never implies that a subset succeeded. A committed result publishes
one typed Main-to-Renderer event containing only affected section/revision IDs. Renderer invalidates
the workspace and reconciles the mounted editor through the existing serialized mutation path so
an old editor document cannot autosave over the applied revision.

Opening Replace focuses the replacement field. Entering review moves focus to its count/status
heading; conflict moves focus to the refresh alert; completion moves focus to the applied summary.
Selection/count changes and repair warnings use bounded polite live regions. Primary copy is
specific (`Review replacements`, `Apply 12 replacements in 3 sections`, `Manuscript changed —
review refreshed`, and `Saved; 1 local mirror will repair automatically`) instead of generic
`Continue`, `Success`, or `Error` labels.

The desktop layout keeps query, replacement, filters, preview, skipped reasons, selection, apply,
repair warning, and Undo reachable by keyboard and screen reader. Escape closes the current
Replace layer before closing Find. The feature introduces no generic command palette, generic
batch framework, Agent conversation, or automatic model call.

### 9. IPC, observability, and security remain narrow

Shared strict Zod contracts define plan creation, page retrieval, apply, and Undo. Every request
authorizes the sender and active `projectSessionId`; planning is tracked as request-scoped work and
is revoked on close/switch. Renderer receives no raw document, database handle, arbitrary JSON
path, reusable revision restore token, filesystem path, or reusable project-root capability.

The result discriminants are fixed before implementation:

```text
plan:  ready | unavailable(result_limit | scan_budget | plan_size)
page:  ready | invalid_plan | expired_plan
apply: applied | already_applied | conflict | invalid_plan | expired_plan
undo:  undone | already_undone | stale | invalid_capability | expired_capability
```

Only `applied` and `already_applied` mean that every selected canonical revision committed. A
bounded conflict carries reason/count/section IDs, never manuscript slices. Sanitized transport or
unexpected failures remain errors rather than being mislabeled as a domain result.

Lifecycle logs use `subsystem: 'manuscript'`, a replacement component, and fixed events for plan
completion/truncation/failure/expiry, apply start/conflict/commit/materialization failure, and Undo.
Safe fields include operation/request ID, project/session IDs, a one-way plan-ID hash, mode,
scope/filter counts, query/replacement UTF-16 lengths, candidate/eligible/skipped/selected/section
counts, skip-reason counts, bytes, duration, result class, and pending-repair count. Logs never
contain raw plan/Undo/cursor capabilities, command IDs, query or replacement text, previews,
original slices, titles/objectives, document bodies, citation text, inline paths with content,
URLs, or private paths. Every caught failure logs the original top-level `err` before a sanitized
error crosses IPC.

No dependency, project migration, worker role, durable job, persisted plan/history table,
manuscript index, provider call, Agent tool/schema change, or Renderer authority is added.

## Implementation Slices

1. Add pure replacement eligibility, target revalidation, and structural transformer fixtures on
   top of the CP29 semantic-span core.
2. Add strict replacement contracts, ephemeral plan storage, exhaustive bounded planning, paging,
   expiry, and safe logging.
3. Add the bounded transaction application service, revision/asset integration, parent-retention
   protection, materialization finalization, idempotent retry, and per-section Undo capabilities.
4. Wire sender/session-authorized IPC, active-editor mutation flush, optional version checkpoint,
   typed section-change events, preload projection, and session revocation.
5. Extend the Find rail with Replace disclosure, complete preview, skip reasons, selection,
   conflict refresh, repair warning, and Undo.
6. Complete focused, transaction/fault, Electron, Real-Electron, performance, recovery, accessibility,
   Impeccable, and diff gates.

## Acceptance And Verification

Implementation acceptance requires all of the following:

- composed/decomposed Unicode, length-changing lowercase, CJK, emoji/surrogates, empty replacement,
  and exact replacement-byte preservation;
- single-node, cross-styled-node, nested block, table-cell, and caption transforms with unchanged
  block IDs, props, assets, source strings, and unrelated inline structure;
- deterministic skip fixtures for title/objective, readable citations, links, code blocks, inline
  code, mixed eligible/excluded spans, unchanged candidates, and non-searchable formula/source
  properties;
- exhaustive-plan limits, cooperative yield/budget, cursor/plan tampering, expiry/replacement,
  output-byte bounds, one-live-plan enforcement, and project-switch revocation;
- zero/duplicate/ineligible/over-limit selections, duplicate matches, descending transforms, exact
  section/revision/block/string/range revalidation, outline changes, changed match counts, manual
  edits, Agent edits, and no partial commit under injected failure at every transaction step;
- new revision lineage, current count algorithm, asset-reference sets, parent-body retention,
  materialization failure/repair, crash after commit, same-command idempotence, and lost-plan restart
  behavior;
- per-section Undo success, stale Undo after later edit, repeated Undo command, parent unavailable,
  Undo materialization repair, and independent Undo across a multi-section batch;
- version-history ready/uninitialized/damaged/checkpoint-failure states without automatic enable or
  repair;
- Renderer stale-plan refresh, default-empty and grouped selection, skipped reasons, exact counts,
  mounted-editor reconciliation, repair warning, keyboard/screen-reader behavior, and no
  interaction with Agent proposal/conversation state;
- the 100-section/500-selection transaction performance gate, `pnpm check:fast`, focused
  Electron-hosted tests, `pnpm check:electron`, fresh focused/full Real-Electron E2E, all recovery
  fixtures, scoped Impeccable review, and `git diff --check`.

Package/release verification is not required because CP30 changes no Electron major, native
module, worker entrypoint, packaged resource, builder, or release boundary.

## Consequences

CP30 can safely deliver literal manuscript-wide replacement without turning search results into
write authority or introducing a generic mutation framework. The first boundary deliberately
leaves titles, objectives, citations, links, and code as find-only results. The complete preview
and single canonical transaction make selection honest, while repairable materialization preserves
the existing database/file authority split.

The ephemeral plan and Undo capabilities avoid a new persistence lifecycle, but they do not offer
a durable replacement audit record or generic revision restore after restart. Optional managed
project checkpoints cover users who want a durable pre-change recovery point. Regex, semantic/AI
replacement, formatting replacement, block creation/splitting, structured link/citation/code edits,
and metadata replacement remain deferred.
