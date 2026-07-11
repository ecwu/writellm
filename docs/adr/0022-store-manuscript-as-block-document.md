---
id: ADR-0022
title: Store the manuscript as one block document with logical section ranges
date: 2026-07-11
scope: project
initiative: DOC
project_prd: ../project-prd.md
initiative_prd: null
task_tracker: ../task-tracker.md
prd_decisions: []
related_tasks: [DOC-003]
depends_on: [DAT-001]
external_task_gates: []
supersedes: [ADR-0021]
superseded_by: null
decision_status: ACCEPTED
implementation_status: IN_PROGRESS
last_updated: 2026-07-11
---

# ADR-0022: Store the manuscript as one block document with logical section ranges

## Context

The current `section` node conflates outline structure, authoring scope, and a physical `sections/<id>.md` file. This splits one manuscript into competing physical documents, forces startup reconciliation between files and SQLite, and makes a Notion-like block editor impossible without retaining a misleading file boundary.

The requested authoring model has one canonical manuscript composed of ordered blocks. Sections remain valuable as logical ranges for navigation, intent, description, citation coverage, generation scope, review, history, and export, but they must no longer own a physical Markdown file.

## Decision

Persist manuscript content in SQLite as a single ordered block tree. A block has a stable ID, type, parent, sibling order, text or structured payload, and optional logical-section ID. Logical sections are metadata records with stable IDs, ordered nesting, title, `intention`, and `description`; their content is the ordered block range tagged with that logical-section ID.

For the first migration, Markdown remains the editing interchange format: the main process serializes a logical section's blocks to Markdown for the existing editor and replaces only that section's blocks on save. New writes do not create, read, reconcile, or Git-track `sections/<id>.md`. Existing live section text is migrated transactionally to paragraph blocks, with a pre-migration SQLite snapshot and unchanged section IDs. Legacy files remain unmodified so workspace Git history stays recoverable, but are no longer canonical or tracked for new checkpoints.

## Alternatives considered

| Alternative | Why it was not selected or what must be proven |
| --- | --- |
| Keep one Markdown file per section and add block UI state | Rejected: the physical partition remains the canonical data boundary and cannot express block moves across logical sections safely. |
| Store one monolithic Markdown string in SQLite | Rejected: it removes files but not the stable, individually addressable block model needed for Notion-style editing and future block-level operations. |
| Adopt a third-party rich-text editor/database immediately | Deferred: it would make this migration depend on a new editing framework. The durable data and IPC contract must first be owned locally and work with the current Markdown editor. |

## Consequences and constraints

- SQLite owns canonical manuscript content; the manifest records logical sections and document revision metadata, not file paths or Markdown hashes.
- A migration must create a recoverable snapshot before changing a non-empty workspace, preserve all non-deleted section text and IDs, and be idempotent after completion.
- The persisted first-wave block types are `paragraph`, `heading`, `quote`, `code`, `list_item`, `divider`, and `image`; unknown Markdown is preserved as paragraph text rather than dropped.
- A logical section's `intention` and `description` are metadata, never injected into manuscript Markdown or export body.
- Existing callers may continue to use `sectionId` as a logical scope, but must receive derived Markdown rather than path-backed Markdown fields.
- Git checkpoints track the SQLite document snapshot and manifest. Section-specific history becomes a logical-section projection over checkpoint snapshots, not a file-path query.
- Pi remains proposal-only. Its offsets are calculated against the derived Markdown snapshot and a successful apply replaces the selected logical section's blocks only after stale-snapshot validation.
- This decision deliberately does not promise a full drag-and-drop rich-text editor in the first implementation; it establishes the block persistence and editor-facing contract that such a UI consumes.

## Linked implementation work

Task state, owner, and evidence are canonical in the project task tracker.

| Task | Contribution to this decision |
| --- | --- |
| DOC-003 | Implement the schema/migration, block/section APIs, history/export/agent adaptations, UI metadata editing, and deterministic verification. |

### Completion conditions

- [ ] A new workspace stores only the SQLite block document and logical-section metadata; no section Markdown file is created.
- [ ] An existing workspace migrates every active section's Markdown into ordered blocks without changing logical section IDs or losing text, and a second open is a no-op.
- [ ] Outline, intent/description, citation coverage, export, history, and Pi proposal application operate against the derived logical-section Markdown.
- [ ] Tests cover empty/new and legacy workspaces, persistence, migration idempotence, block ordering, metadata, and a reviewable patch application; typecheck, unit tests, build, and Electron smoke pass.

## Status history

| Date | Decision status | Implementation status | Change and evidence |
| --- | --- | --- | --- |
| 2026-07-11 | ACCEPTED | IN_PROGRESS | Product requested the block-document refactor; DOC-003 was created and claimed. |
