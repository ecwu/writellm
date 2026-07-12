# Quickstart: validate writing orientation

## Prerequisites

- 003 spec, plan, storage contract and 002 leave-guard extension are accepted；004 is not an implementation prerequisite for 003.
- 001, 011 and 002 implementations are available.
- Dependencies are installed from the existing lockfile.

## Automated gate

```bash
bun run typecheck
bun run test
bun run build
bun run test:smoke
```

Expected: all commands pass; contract tests confirm only the three named orientation methods; storage fixtures never touch a real user project; successful saves create the ADR-001 structured content commit while Git capabilities remain absent from renderer.

## Scenario 1 — motivation and explicit save

1. Open a project and its writing-orientation panel.
2. Fill problem, target readers and desired outcome.
3. Confirm the UI is dirty and no disk snapshot changes before Save or the save shortcut.
4. Save, close, and reopen the project.

Expected: saved state is explicit only after canonical replacement and the ADR-001 structured Git commit complete, and the latest successful values return. Clearing all fields and saving returns a valid “not filled” state, not an error.

## Scenario 2 — outline editing and reorder

1. Create three items; confirm each defaults to `not-started`.
2. Select the middle item and edit title, summary and status in the fixed details region.
3. Reorder once by drag and once with move up/down controls.
4. Save and reopen.

Expected: list and details remain simultaneously visible; both reorder paths produce the same array semantics; order, content and status persist. Keyboard-only operation is complete.

## Scenario 3 — validation and repeated actions

1. Try to save a whitespace-only title.
2. Trigger create, reorder and save twice with the same mutation IDs.
3. Run the integration fixture for 100 repetitions.

Expected: invalid title identifies the field; no duplicate entity, revision increment or unexpected order appears.

## Scenario 4 — failures and leave guard

1. Inject a storage write failure after editing.
2. Attempt to leave and choose Stay, then Save with failure, then Discard in separate runs.
3. Edit while an injected delayed save is in flight.

Expected: visible input survives failure; retry is available; failed Save does not leave; Discard restores baseline; edits made during save remain dirty after the submitted snapshot succeeds.

## Scenario 5 — linked chapter deletion boundary

1. Load a fixture whose authoritative outline item has a non-null opaque `chapterRef`.
2. Attempt to delete it through the 003 UI and IPC.
3. Repeat with a stale renderer draft and with a duplicate mutation.

Expected: every current-version attempt returns `LINKED_DELETE_NOT_AVAILABLE`, stale revision remains a conflict, and no orientation or chapter fixture changes. 004 must replace this behavior only through an accepted atomic extension.

## Scenario 6 — restoration and security

1. Select a non-first item, close the app, and reopen the project.
2. Repeat with an empty outline.
3. Inspect the compiled preload surface and error DTOs.

Expected: saved content returns, selection does not persist, and the UI starts at the first item or the outline empty state; renderer receives no absolute path, filesystem/Git/Electron object, raw stack or generic IPC.

See [data-model.md](./data-model.md), [IPC contract](./contracts/writing-orientation-ipc.md), and [storage contract](./contracts/writing-orientation-storage.md) for exact rules.
