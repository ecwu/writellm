# Implementation Plan: Block editor

**Branch**: `004-block-editor`

**Date**: 2026-07-12

**Spec**: [spec.md](./spec.md)

**Status**: Accepted

## Acceptance record

Accepted on 2026-07-12. Review confirmed the BlockNote 0.51.4 + Ariakit direction
subject to the documented license/peer/build/runtime verification gate; the
versioned document, stable block identity, citation anchor and safe unknown-schema
strategy; and the typed IPC, revision, idempotency, redaction, conflict and
recovery contracts. The remaining offline/privacy, objective ceiling,
accessibility/cross-platform, Markdown and ADR boundaries were accepted as a
complete design package.

## Summary

Add a BlockNote-based chapter editor behind a narrow renderer adapter. Persist one
versioned BlockNote JSON snapshot per chapter through a main-owned repository;
keep block commands local, save complete validated snapshots with optimistic
revision/idempotency, and atomically link newly created chapters to 003 outline
items. Store citations as structured block/range relations that are conservatively
remapped or marked for review. Treat Markdown paste/export as explicit, previewed,
potentially lossy interchange rather than durable truth.

## Dependency and registry gate

| Dependency | Required state | Current state | Gate |
|---|---|---|---|
| 001 project foundation | Accepted/Complete | Accepted/Complete | Pass |
| 011 UI foundation / ADR-003 | Accepted/Complete | Accepted/Complete | Pass |
| 002 workspace shell | Accepted/Complete | Accepted/Complete | Pass |
| 003 writing orientation | Accepted producer contract | Accepted/Complete | Pass |
| ADR-001 content storage | Accepted | Accepted | Pass |
| ADR-003 UI foundation | Accepted | Accepted | Pass |
| 004 spec and plan | Accepted | Accepted | Pass |

All specification, dependency and ADR acceptance gates pass. Task generation may
proceed. Implementation remains subject to the package verification gate below.

## Technical Context

**Language/Version**: TypeScript 7.0.2, React 19.2.7, Electron 43.1.0,
Vite 8.1.4, Bun 1.3.14.

**Primary Dependencies**: Pin `@blocknote/core`, `@blocknote/react` and
`@blocknote/ariakit` to 0.51.4 after peer/license/build/runtime acceptance; no XL,
Mantine or additional Markdown parser package. Reuse 011 source-owned UI patterns
and semantic tokens around editor chrome.

**Storage**: Main-owned JSON repository at logical
`workspace/chapters/<chapterId>.json`; atomic multi-file/Git transaction and
recovery follow accepted ADR-001.

**Testing**: Bun unit/contract/integration tests, DOM tests, compiled Electron
smoke and UI runtime checks at IPC/editor/storage/dialog failure boundaries.

**Target Platform**: Sandboxed Electron desktop on macOS, Windows and Linux;
single author/local project, potentially multiple in-app chapter views, no live
collaboration.

**Project Type**: Desktop application with untrusted renderer and typed preload.

**Performance Goals**: Meet SC-001–SC-008; no extra millisecond SLA. Safety limits
are 2 MiB/request, 10,000 blocks, depth 32 and 10,000 citations/chapter.

**Constraints**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox:
true`; renderer receives no path, filesystem, Git, Electron or generic IPC. No
unknown block/citation/Markdown meaning is silently dropped or rebound.

**Scale/Scope**: One chapter snapshot per save; one serialized project content
queue; single-chapter Markdown import/export only.

There are no unresolved Technical Context clarifications. Package acceptance and
dependency/ADR status are explicit gates, not hidden implementation choices.

## Constitution Check — pre-research

| Principle | Result | Evidence / condition |
|---|---|---|
| I. Secure Desktop Boundary | Pass by design | BlockNote/editor stays in renderer; main owns project, path, validation, storage, dialog and Git. |
| II. Typed, Minimal IPC | Pass by design | One separate named namespace; create/open, load, save and bounded preview/export only; no generic channel or editor object. |
| III. Specification-Driven, Minimal Evolution | Pass | 003 and 004 spec/plan plus ADR-001 and ADR-003 are accepted. JSON files/full snapshots are the smallest design satisfying requirements. |
| IV. Verification at Failure Boundary | Pass by design | DOM tests cover adapter UX; repository tests cover writes; compiled Electron covers preload/runtime/dialog/security. |

**Gate conclusion**: No constitutional exception is proposed. All design and
acceptance gates pass; implementation must still satisfy the explicit package
verification prerequisite.

## Phase 0: Research result

[research.md](./research.md) resolves editor format, exact package family/version,
UI adapter, license boundary, Markdown parser/dialect, physical storage,
003↔004 transaction, revision/idempotency and citation anchoring. Key outcomes:

1. BlockNote JSON is the only canonical editor content.
2. BlockNote 0.51.4 core/react/ariakit is the pinned candidate; acceptance requires
   a clean Bun lock, React/Electron build and compiled runtime proof.
3. Markdown uses only BlockNote's fixed CommonMark/GFM-derived baseline and always
   crosses a product-owned warning/preview boundary.
4. Chapter creation and 003 `chapterRef` update form one main-owned transaction.
5. Snapshot saves use exact base revision and idempotent mutation ID; conflicts
   never use last-writer-wins.

## Phase 1: Design and contracts

### Data model

[data-model.md](./data-model.md) defines the `ChapterDocument` wrapper, native
block snapshot invariants, structured citation anchor, renderer-only draft/save
state, conversion previews, transition rules and validation ceilings.

The orientation item's title remains authoritative; chapter load may project it,
but chapter persistence does not create a second editable title.

### IPC, storage and editor contracts

[contracts/contract.md](./contracts/contract.md) defines:

- a distinct `window.writellmChapters` namespace;
- idempotent create-or-open by outline item with orientation revision;
- chapter load and full-snapshot save;
- renderer-local Markdown paste preview plus bounded export preview/dialog;
- stable error/redaction, revision/conflict and storage/recovery semantics;
- a renderer adapter that owns BlockNote commands but no persistence authority.

Creation/linking is a shared durable boundary with 003 and is frozen by the
accepted 003 and 004 contracts plus ADR-001. Linked deletion remains out of scope:
003 continues to reject it safely, and 004 does not add a deletion transaction.

### Validation guide

[quickstart.md](./quickstart.md) covers create-once, all required block operations,
citation transforms, generation-aware autosave, cross-view conflicts, Markdown
warning/cancel/failure, persistence/restart and compiled Electron security checks.

## Project Structure

```text
src/
├── shared/
│   └── chapters.ts                         # DTOs, results, frozen block schema
├── main/project/
│   ├── chapter-repository.ts               # load/save/revision/atomic transaction
│   ├── chapter-validation.ts               # wrapper/block/citation validation
│   └── markdown-export.ts                  # bounded conversion + native export
├── preload/preload.cts                     # named chapter wrappers only
└── renderer/features/editor/
    ├── adapter/blocknote-adapter.ts        # BlockNote ↔ bounded snapshots
    ├── adapter/citation-transform.ts       # provable remap / needs-review
    ├── chapter-draft-state.ts              # generations/autosave/conflict
    └── components/ChapterEditor.tsx        # editor + accepted 011 patterns

test/
├── unit/editor/                            # schema, commands, citations, Markdown
├── contract/chapters/                      # IPC surface, validation, redaction
├── integration/project/                    # transaction/revision/recovery
├── integration/editor/                     # create/save/reopen/conflict
└── runtime/editor/                         # compiled Electron/editor/dialog/security
```

New UI primitives are not assumed. If editor chrome exposes a genuine 011 gap,
004 must submit the accepted `FoundationExtensionRequest` before adding shared UI.

## Implementation sequence

### 1. Freeze dependencies and shared contract

- Verify exact BlockNote packages/license/peers with Bun, typecheck/build and a
  sandboxed compiled Electron mount.
- Freeze the schema-derived snapshot union, citation DTOs, errors, method names,
  ceilings and 003↔004 shared transaction.
- Add contract tests before handlers or feature UI.

### 2. Build repository and transaction boundary

- Implement validation, create-or-open, load, snapshot save, revisions,
  idempotency and ADR-001 atomic replacement/Git/recovery.
- Keep chapter title projected from orientation and verify duplicate requests,
  stale saves, malformed documents and interrupted transactions.

### 3. Build BlockNote adapter and draft state

- Mount the selected schema and map create/edit/move/split/merge/delete to local
  transactions and bounded snapshots.
- Implement citation transform rules, valid empty chapter and generation-aware
  autosave/save-now/leave/conflict state.
- Compose with 011 patterns, typeset editor preset, keyboard/focus/theme/accessibility.

### 4. Add Markdown interchange and runtime verification

- Implement explicit Markdown paste preview/confirmation and export preview,
  warnings, cancel and distinct failure states.
- Verify all SC fixtures, recovery paths and no cross-boundary leakage in compiled
  Electron under the production sandbox settings.

## Constitution Check — post-design

| Principle | Result | Design evidence / remaining gate |
|---|---|---|
| I. Secure Desktop Boundary | Pass | All privileged work is main-owned; renderer adapter is capability-free. Runtime tests verify actual sandbox behavior. |
| II. Typed, Minimal IPC | Pass | Full snapshots avoid chatty command IPC; exact namespace/DTO/error surface is documented and testable. |
| III. Specification-Driven, Minimal Evolution | Pass | Accepted 003/004 spec and plans plus ADR-001 and ADR-003 cover the durable and UI boundaries. |
| IV. Verification at Failure Boundary | Pass | Each behavior is assigned to pure, repository, DOM or compiled Electron verification at its failure boundary. |

**Post-design gate**: Phase 1 design is accepted with zero `NEEDS CLARIFICATION`.
FR-011 is verified with two primary-instance-owned compiled Electron test windows
sharing the same main repository; 004 adds no user-facing multi-window manager.
Task generation may proceed; package verification remains the first implementation
prerequisite.

## Complexity Tracking

No Constitution violation or exception. The WriteLLM wrapper, citation collection,
editor adapter and Markdown adapter each own a distinct required boundary; none is
a second block truth. JSON-per-chapter is chosen over SQLite, full snapshots over
patch protocol and renderer-local commands over main command IPC to minimize the
system.
