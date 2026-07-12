# Contract: Project Foundation IPC

Status: Accepted — maintainer accepted 2026-07-12.

## Contract version

`writellm.project-ipc/v1`. The contract is renderer-facing only; project paths, file
contents, raw filesystem exceptions and credentials never cross the preload boundary.

## Named methods

The preload bridge exposes exactly these methods. The method names are the shared source of
truth for `src/shared/ipc.ts`, `src/preload/preload.cts` and main `ipcMain.handle` registration.

| Method | Request | Success result | Cancellation/failure |
|---|---|---|---|
| `listRecentProjects` | none | `{ recentProjects, warning? }` | Safe warning may accompany an empty list. |
| `createProject` | `{ displayName }` | `{ status: "created", project }` | `{ status: "canceled" }` or `{ status: "error", error }`. Main opens parent-directory dialog. |
| `openProjectFromDialog` | none | `{ status: "opened", project }` | Canceled or stable error; main opens project-directory dialog. |
| `openRecentProject` | `{ recentId }` | `{ status: "opened", project }` | Missing/invalid/inaccessible error; recent record remains. |
| `relinkRecentProject` | `{ recentId }` | `{ status: "opened", project }` | Canceled or `PROJECT_ID_MISMATCH`; original record remains unchanged on mismatch. |
| `removeRecentProject` | `{ recentId }` | `{ status: "removed", recentId }` | Stable error; never deletes project files. |

There is deliberately no legacy runtime-info, workspace save, `deleteProject`, arbitrary
file method, arbitrary command method or generic IPC wrapper.

Project location is selected for each create/open/relink operation through a main-owned native
directory dialog. There is no persisted default project location setting; absolute paths remain
main-only and never become renderer request or response fields.

## Shared DTOs

### `ProjectSnapshot`

```text
{
  projectId: string,             // UUID
  displayName: string
}
```

It contains no absolute path, folder path, manifest contents, raw file data or permissions
detail.

### `RecentProjectSummary`

```text
{
  recentId: string,              // opaque UUID
  projectId: string,             // stable UUID
  displayName: string,
  lastOpenedAt: string,          // ISO timestamp
  availability: "available" | "missing" | "invalid" | "inaccessible",
  diagnosticCode: RecentDiagnosticCode | null
}
```

`recentProjects` is sorted newest first and contains no more than five records.

## Stable error codes

| Code | Meaning | Required behavior |
|---|---|---|
| `INVALID_PROJECT_NAME` | Name is not a safe current-platform leaf or the target filesystem rejects it as a name. | Do not create or publish recent. |
| `PROJECT_EXISTS` | Any entry already occupies the final sibling path. | Do not overwrite, merge or replace. |
| `PROJECT_INVALID` | Manifest or required directory is missing or malformed. | Read-only diagnostic; do not repair. |
| `PROJECT_UNSUPPORTED_VERSION` | Manifest schema version is not supported. | Read-only diagnostic; do not rewrite. |
| `PROJECT_NOT_FOUND` | Recent path no longer exists. | Retain record; offer remove/relink in UI. |
| `PROJECT_INACCESSIBLE` | Path exists but cannot be read/verified. | Retain record; show safe diagnostic. |
| `PROJECT_ID_MISMATCH` | Relink candidate projectId differs from original record. | Leave original record unchanged. |
| `RECENT_NOT_FOUND` | recentId is not present in main-owned index. | No project filesystem mutation. |
| `STORAGE_READ_FAILED` | Main could not read required JSON/index. | No success result; safe message only. |
| `STORAGE_WRITE_FAILED` | Project creation or app-owned index write failed. | No success result; preserve existing valid data. |

`canceled` is a result status, not an error code. Raw OS error strings, stack traces,
absolute paths and file contents are logged only in main according to repository policy and
are not returned to renderer.

## Idempotency and retry semantics

- 001 does not accept a renderer-supplied revision or client mutation ID; main serializes
  project-foundation writes and owns the filesystem path resolution.
- Repeating a successful open/upsert is safe; repeating `removeRecentProject` for a missing
  `recentId` returns `RECENT_NOT_FOUND` and never mutates project files.
- `openProjectFromDialog` upserts by `projectId`; opening the same project from a new location
  preserves its existing `recentId`, updates its path/time and never creates a duplicate.
- Dialog cancellation is terminal for that invocation and returns `canceled`; storage,
  validation and collision failures are terminal results for that invocation.
- There is no automatic retry, merge, or conflict resolution in 001. The renderer may offer
  a new user-invoked retry by calling the same named method again.

## Validation and ownership rules

1. Main validates every request shape, non-empty leaf-name boundary, UUID and enum before domain work;
   validation is repeated even if TypeScript types appear correct.
2. Main validates the IPC sender is an expected application window before executing a handler.
3. Renderer never supplies a filesystem path. `recentId` resolves to a main-only path from
   the recent index.
4. `openProjectFromDialog` validates the selected folder from disk before returning success.
5. `relinkRecentProject` validates the selected folder and requires its manifest `projectId`
   to equal the stored record’s projectId before updating that record.
6. `removeRecentProject` atomically rewrites only the recent index.
7. Successful open/relink performs no project-tree write: manifest bytes and timestamps,
   required directories and all unknown internal files remain unchanged.

## Main lifecycle guarantee

The six renderer methods are available only in the primary application instance. Main
acquires the single-instance lock before registering IPC, initializing recent storage or
creating a window. A secondary process registers no handlers and touches no project/recent
state; it asks the primary to restore/show/focus its existing window and exits. This lifecycle
rule does not add a seventh renderer method.

## Main/preload mapping

Each of the six named methods maps to one fixed IPC channel such as `writellm:project:create`; channels
are constants in shared code. Preload uses one explicit `ipcRenderer.invoke` wrapper per
method and `contextBridge.exposeInMainWorld('writellm', api)`. No raw `ipcRenderer` object,
channel string, callback registration or Electron object is exposed.
