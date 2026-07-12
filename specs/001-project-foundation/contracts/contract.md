# Contract: Project Foundation IPC

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
| `saveProjectWorkspace` | `{ projectId, lastEditedLocation }` | `{ status: "saved", projectId, lastEditedLocation }` | Stable validation/storage error; no false success. |

There is deliberately no `deleteProject`, arbitrary file method, arbitrary command method,
or generic IPC wrapper.

## Shared DTOs

### `ProjectSnapshot`

```text
{
  projectId: string,             // UUID
  displayName: string,
  lastEditedLocation: { kind: "workspace" }
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

### `lastEditedLocation`

Version 1 accepts exactly `{ kind: "workspace" }`. This is an empty-workspace marker, not a
document path. Document/block locations require a later accepted schema and contract change.

## Stable error codes

| Code | Meaning | Required behavior |
|---|---|---|
| `INVALID_PROJECT_NAME` | Name fails normalization/portable-name rules. | Do not create or write. |
| `PROJECT_EXISTS` | Final sibling directory already exists. | Do not overwrite, merge or replace. |
| `PROJECT_INVALID` | Manifest/state/required directory is missing or malformed. | Read-only diagnostic; do not repair. |
| `PROJECT_UNSUPPORTED_VERSION` | Manifest/state schema version is not supported. | Read-only diagnostic; do not rewrite. |
| `PROJECT_NOT_FOUND` | Recent path no longer exists. | Retain record; offer remove/relink in UI. |
| `PROJECT_INACCESSIBLE` | Path exists but cannot be read/verified. | Retain record; show safe diagnostic. |
| `PROJECT_ID_MISMATCH` | Relink candidate projectId differs from original record. | Leave original record unchanged. |
| `RECENT_NOT_FOUND` | recentId is not present in main-owned index. | No project filesystem mutation. |
| `PROJECT_NOT_OPEN` | Workspace save has no matching current project path. | Do not write state. |
| `STORAGE_READ_FAILED` | Main could not read required JSON/index. | No success result; safe message only. |
| `STORAGE_WRITE_FAILED` | Atomic write/rename failed. | No success result; preserve existing valid data. |

`canceled` is a result status, not an error code. Raw OS error strings, stack traces,
absolute paths and file contents are logged only in main according to repository policy and
are not returned to renderer.

## Validation and ownership rules

1. Main validates every request shape, string length, UUID and enum before domain work;
   validation is repeated even if TypeScript types appear correct.
2. Main validates the IPC sender is an expected application window before executing a handler.
3. Renderer never supplies a filesystem path. `recentId` resolves to a main-only path from
   the recent index.
4. `openProjectFromDialog` validates the selected folder from disk before returning success.
5. `relinkRecentProject` validates the selected folder and requires its manifest `projectId`
   to equal the stored record’s projectId before updating that record.
6. `removeRecentProject` atomically rewrites only the recent index.
7. `saveProjectWorkspace` resolves the project path in main and writes only the validated
   `workspace/state.json` shape.

## Main/preload mapping

Each named method maps to one fixed IPC channel such as `writellm:project:create`; channels
are constants in shared code. Preload uses one explicit `ipcRenderer.invoke` wrapper per
method and `contextBridge.exposeInMainWorld('writellm', api)`. No raw `ipcRenderer` object,
channel string, callback registration or Electron object is exposed.
