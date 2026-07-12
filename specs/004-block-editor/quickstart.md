# Quickstart: Block editor validation

This guide validates the accepted design end to end. It is not authorization to
implement while the gates below remain open.

## Prerequisites and gates

- Bun 1.3.14 and the repository's Electron 43 toolchain.
- Accepted and implemented 001, 002 and 011 foundations.
- Accepted 003 spec/plan and its orientation storage/IPC contract.
- Accepted 004 spec/plan and ADR-001.
- Exact BlockNote 0.51.4 core/react/ariakit packages in the lockfile, with no XL
  package, unresolved peer dependency or second design-system runtime.

Use fixtures only; no provider, network, PDF parser or source-search service is
required. Citation fixtures use opaque source/chunk IDs and test relation
preservation, not source existence.

## Standard verification

```sh
bun run typecheck
bun run test
bun run build
bun run test:smoke
bun run test:ui-runtime
```

## Scenario 1: Create once from an outline item

1. Open a valid fixture project containing an unlinked outline item.
2. Choose “start writing”.
3. Verify a valid editable empty chapter opens at revision 0 and the item is
   linked atomically.
4. Repeat the action and restart the app.

Expected: the same chapter ID opens every time; no orphan/duplicate chapter is
created. Interrupt the cross-file transaction at each replacement/commit step and
verify recovery returns a safe result or `STORAGE_RECOVERY_REQUIRED`, never a
dangling link reported as success.

## Scenario 2: Edit and restructure blocks

Create every FR-013 baseline block, then edit, move, split, merge and delete
blocks. Delete the last block and continue typing.

Expected: visible text/order/format meaning is preserved, untouched chapters do
not change, stable IDs survive moves, and last-block deletion leaves a valid
editable empty document. Run 100 fixtures for each required structural operation
to cover SC-002.

## Scenario 3: Preserve or flag citations

Move a fully cited block, split before/after/through the cited range, merge blocks,
delete inside/outside the range and load malformed/missing block references.

Expected: complete provable ranges remap exactly; cut, deleted, mismatched or
ambiguous ranges become `needs-review`; zero citations silently attach to nearby
unrelated text.

## Scenario 4: Autosave, save now and leave protection

Edit during an in-flight autosave, force write/commit failure, retry, and invoke
“save now”. Attempt to leave with dirty, saving, failed and saved generations.

Expected: status distinguishes dirty/saving/saved/failed; an older successful
request never marks newer edits saved; failures retain the visible draft; leave
offers save/discard/cancel only when a generation is not persisted.

## Scenario 5: Stale internal view

Use the compiled Electron fixture to open the same chapter in two windows owned by
the primary app instance. Save in view A, then edit and save the stale base
revision in view B.

Expected: B receives `REVISION_CONFLICT` and retains its draft. “Reload saved”
loads A. “Keep current” retains B as dirty against the acknowledged latest
revision and requires a new explicit save; neither choice silently discards data.

## Scenario 6: Markdown paste and export

Preview and confirm Markdown covering the exact FR-013 baseline. Repeat with
unsupported syntax, custom blocks/props and citations. Cancel previews, cancel the
native export dialog and force conversion/write failure.

Expected: baseline content becomes editable; every semantic degradation is shown
before confirmation/export; cancel/failure leaves the chapter and saved revision
unchanged; exported Markdown is readable UTF-8; export errors are never shown as
canonical save errors.

## Failure-boundary assertions

- Contract tests assert the preload namespace and exact methods, DTO validation,
  size/tree/range ceilings, idempotency and safe error redaction.
- Repository integration tests cover atomic replacement, serialization, stale
  revisions, Git/pending recovery and malformed/unknown documents.
- Renderer tests cover BlockNote adapter operations, generation-aware save state,
  dialogs, focus return, keyboard operation, theme, forced colors and reduced
  motion using the accepted 011 patterns.
- Compiled Electron tests prove sandbox/context isolation, no paths/editor/Git/raw
  IPC leakage, actual BlockNote mount/edit/paste/export and process-boundary
  failure behavior.
