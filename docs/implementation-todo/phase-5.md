# Phase 5: Manuscript And BlockNote Product Slice

## Phase overview

- Purpose: own manuscript brief/outline state, BlockNote persistence/materialization, and the writing workspace UI.
- Checkpoints: 9–11.
- Current status: Completed after audit remediation; Checkpoints 9–11 are complete and verified.
- Implementation state: functional workspace implementation exists; current audit remediation is listed at the end of this file.

> **历史记录：BlockNote autosave 规则已过时。** The historical Checkpoint 10 verification records a 650 ms debounce and a broad retention-cleanup description. CP19.5 supersedes it with canonicalize/hash no-op detection, a 1–2 second idle debounce, single-flight pending-save replacement, explicit revision source classes, and best-effort cleanup outside the body revision transaction.

### Checkpoint 9: Manuscript Brief, Outline, Section State, And Revisions

Implementation scope: complete schema v6 on top of the existing manuscript bootstrap, then add Main-only contracts, domain services, deterministic content metrics, structured lifecycle logs, and tests. This checkpoint does not add BlockNote dependencies, manuscript IPC/preload/renderer surfaces, editor autosave, file materialization, Markdown interchange, agent/proposal tables, or revision retention cleanup.

- [x] Define the initial one-primary-manuscript schema.
- [x] Define a versioned manuscript brief with title, description/purpose, topic/coverage, audience, language, style/tone, scope/exclusions, target length, citation requirements, and extra instructions.
- [x] Define ordered hierarchical sections with stable IDs, parent, position, level, title, objective, status, and current revision.
- [x] Fix the section status enum to `planned`, `drafting`, and `completed` for the initial product.
- [x] Define section body content as native BlockNote JSON separate from the section title.
- [x] Add `section_revisions` with source type, content JSON, content hash, prior revision, agent lineage fields, and timestamps.
- [x] Define optimistic concurrency using `baseRevisionId` and content hash.
- [x] Add domain services for brief read/update, section create/update/reorder/delete, revision read, and whole-manuscript assembly.
- [x] Prevent deleting a section with unresolved agent proposals without an explicit policy.
- [x] Define deterministic word/character count extraction from BlockNote content.
- [x] Test nested outline ordering, status transitions, revision conflicts, delete/reorder constraints, and full assembly.

Acceptance criteria: manuscript metadata, ordered structure, status, and section bodies have explicit non-overlapping ownership; stale writes cannot silently overwrite a newer section revision.

Checkpoint 9 verification: project schema v6 adds `outline_version`, independently schema-versioned immutable brief rows, non-null section revision pointers, and append-only `section_revisions` with deterministic bootstrap backfill, canonical SHA-256 content hashes, persisted Unicode counts, prior-revision chains, reserved source values, and constrained agent lineage. Populated v5 databases are backed up and upgraded without changing section identity or metadata; unexplained legacy revision pointers fail and roll back, while empty legacy databases remain empty. The Main-only `ManuscriptService` requires exactly one primary manuscript, uses brief-version, outline-version, and revision ID/hash optimistic concurrency, maintains ordered trees and subtree levels in short `BEGIN IMMEDIATE` transactions, exposes an explicit proposal deletion guard, and assembles current bodies using persisted counts. CP9 emits content-free structured lifecycle logs and mounts the service in `ProjectContext`; manuscript content/brief serialization failures stay inside that logging boundary, and deletion-guard failures log the original top-level `err` before safe domain transformation. New project bootstrap creates the correctly titled first brief and initial empty revision in one transaction. No BlockNote dependency, manuscript IPC/preload/renderer surface, materialized file, Markdown interchange, proposal table, or retention cleanup was added.

### Checkpoint 10: BlockNote Editor Persistence And Materialization

- [x] Install and pin BlockNote React and the shadcn-compatible UI packages required by the chosen integration.
- [x] Define the approved BlockNote schema and initial allowed block types/props.
- [x] Preserve native BlockNote block IDs and reject duplicate IDs.
- [x] Implement active-section load into BlockNote.
- [x] Implement debounced save of the complete native BlockNote document with `baseRevisionId`.
- [x] Validate document shape, nesting, inline content, block count, and serialized size in Main.
- [x] Commit the canonical revision transactionally in `project.sqlite`.
- [x] Atomically materialize the current revision to `manuscript/sections/<section-id>.blocknote.json`.
- [x] Store materialization revision/hash and repair missing or stale files on project open.
- [x] Expose explicit save states: clean, saving, saved, conflict, failed.
- [x] Retain useful manual and accepted-agent revisions under a bounded retention policy.
- [x] Implement native JSON export and lossy Markdown import/export as separate operations.
- [x] Ensure Markdown export never replaces the canonical native document.
- [x] Add tests for rich text, nested blocks, tables, links, Unicode, duplicate IDs, invalid props, stale saves, crash between revision commit and materialization, and materialization repair.

Acceptance criteria: BlockNote native JSON round-trips without loss; Markdown is treated as lossy interchange; a committed revision survives renderer crash even if its mirror must be repaired later.

Checkpoint 10 verification (historical; autosave portion superseded by CP19.5): BlockNote core, React, and shadcn packages are exactly pinned to 0.47.2, with no Mantine dependency. Characterization proves CP9 `[]` cannot be passed as `initialContent`, records the real default paragraph/heading/list/quote/code/table/link JSON shapes, and proves JSON serialization plus reload preserves IDs, props, styles, links, children, and table cells. The shared strict contract allowlists paragraph, heading, bullet/numbered/check lists, quote, code block, table, styled text, links, and nested children while rejecting missing/duplicate IDs, unknown props/types, unsafe URL schemes, excessive depth/count/size, and non-native media/file blocks. Schema v7 adds deterministic section materialization metadata and bounded revision-body retention while preserving revision IDs, hashes, sources, and lineage metadata.

The asynchronous Main persistence path validates the full document, performs idempotent revision/hash CAS, commits SQLite authority first, fsyncs and atomically renames a deterministic envelope, records materialization metadata, and repairs missing, corrupt, stale, or metadata-lagging mirrors on project open without blocking access to canonical content. Fault tests cover failure immediately after DB commit, before rename, and after rename before metadata commit; concurrent stale saves conflict, and a lost-response retry with the current hash succeeds idempotently. Sender-authorized session-scoped IPC exposes first-section open/load/save, Markdown import, native JSON export, lossy Markdown export, and one-shot closing-token flush/ack. The minimal renderer uses the approved shadcn BlockNote schema, the historical 650 ms debounce, a single-flight merge loop, visible clean/saving/saved/mirror-pending/conflict/failed states, and preserves local content on conflict. CP19.5 replaces the debounce and retention behavior with the amended rules. Electron E2E proves an edit made immediately before close is final-flushed and restored after reopen, and proves Markdown/native exports are separate files while the canonical materialization remains native.

Verification: `pnpm check` passes with the pre-existing generated shadcn sidebar cookie warning; Node and web TypeScript checks pass; Electron-hosted Vitest passes 37 files and 199 tests; `pnpm build` passes; all 4 Playwright Electron E2E tests pass; `pnpm build:unpack` produces `dist/mac-arm64`; `git diff --check` passes; and an isolated real-Electron runtime smoke validates `app.sqlite` application ID, schema version, manifest, and table boundary. The unpacked macOS build is unsigned because no valid Developer ID Application identity is configured.

### Checkpoint 11: Writing Workspace UI

Implementation scope: expose the existing manuscript domain through narrow project-session-scoped IPC, then build the shadcn/ui writing workspace around the approved sidebar shell. The checkpoint owns brief and outline editing, section navigation and metadata, active-section BlockNote switching, counts, whole-manuscript preview, keyboard/focus behavior, and its tests. Knowledge, provider, import, search, and functional agent behavior remain disabled placeholders until their own checkpoints.

- [x] Build the active-project shell with manuscript, knowledge, agent, and settings areas.
- [x] Build the manuscript outline panel with nested sections, drag/reorder, create/delete, title editing, objectives, and status controls.
- [x] Build the manuscript brief editor with validated fields and unsaved/error state.
- [x] Build the BlockNote section editor with current section title/status context.
- [x] Preserve editor selection and active block context for agent use without persisting unnecessary high-frequency cursor events.
- [x] Display section and manuscript word/character counts.
- [x] Add next/previous section navigation and outline completion indicators.
- [x] Build a read-only whole-manuscript preview assembled from section order and bodies.
- [x] Add keyboard shortcuts and accessible focus behavior for save, section navigation, and agent panel toggling.
- [x] Add Playwright E2E for project creation through manual writing, reload, conflict handling, section reorder, and whole-manuscript preview.

Acceptance criteria: a user can create a project, define the writing brief and outline, write multiple sections, assign statuses, close the app, and reopen with identical native content and structure.

Checkpoint 11 verification: the project-session-scoped workspace IPC returns bounded content-free outline data and loads full bodies only for the active editor or explicit whole-manuscript preview. The shadcn sidebar workspace supports brief editing, nested outline create/delete/reorder, metadata/status editing, BlockNote section switching, counts, completion state, next/previous navigation, keyboard save/navigation/agent toggling, and a read-only assembled preview. Renderer-only selection context remains in memory. CAS conflicts preserve local body, brief, and metadata drafts and expose explicit canonical reload paths.

Review hardening added a workspace-lifetime final-flush subscription with per-mount UUID leases, explicit typed active-section IPC so TanStack cache hits cannot desynchronize Main, no-subscriber close refusal for active editors, metadata draft refs that survive passive-effect and outline-mutation races, current-version lookup after flush, ID-difference activation for duplicate section titles, and per-section serialized materialization publication with current-revision checks before and after rename. Verification passes `pnpm check` with only the pre-existing generated shadcn sidebar cookie warning, Node and web TypeScript, Electron-hosted Vitest (39 files and 209 tests), production build, all 6 Playwright Electron E2E tests, and `git diff --check`.

## Audit remediation

The 2026-07-16 completion audit reopened this Phase. These items are required before the affected Checkpoints can return to completed and verified:

- [x] Bound the manuscript brief `extensible` value and the workspace section collection by shape, depth/count, and serialized bytes; add adversarial contract tests.
- [x] Extend the multi-section Playwright acceptance flow to terminate and relaunch the application before verifying identical brief, outline, status, order, and native section content.

Remediation verification: manuscript brief extensible data now rejects cycles, excessive depth/keys, and oversized JSON; workspace and assembly section collections reject duplicate IDs and bounded-count/byte violations. The writing-workspace Playwright flow closes the project, terminates Electron, starts with isolated application data, reopens the project through the picker, and verifies the saved brief, objective, outline content, and final-flush native body. The adversarial contract tests and the 3-test workspace E2E flow pass.
