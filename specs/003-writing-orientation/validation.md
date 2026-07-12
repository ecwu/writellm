# Feature 003 validation

**Date**: 2026-07-12  
**Platform**: macOS, Bun 1.3.14, Electron 43.1.0  
**Result**: PASS

## Automated gates

| Gate | Result |
|---|---|
| `bun run typecheck` | PASS |
| `bun run test` | PASS — 76 tests, 413 assertions |
| `bun run build` | PASS |
| `bun run test:smoke` | PASS — compiled Electron startup, preload, and single-instance lifecycle |

`isomorphic-git@1.36.1` is exact-pinned in `package.json` and `bun.lock`. Its MIT license, Bun import/type compatibility, Electron main-process build, and compiled runtime startup were checked.

## Quickstart scenarios

1. **Motivation and explicit save** — PASS. Baseline/draft tests cover explicit dirty state, submitted-snapshot baseline updates, in-flight edits, retryable failures, and reopen from the canonical document.
2. **Outline editing and reorder** — PASS. The panel presents the list and fixed details together; creation defaults to `not-started`; drag and move controls share the bounded pure reorder command.
3. **Validation and repeated actions** — PASS. Parser tests reject whitespace titles, forged ownership, invalid identity unions, and durable-ID omission. One hundred paired reorder cycles retain unique identity and exact order.
4. **Failures and leave guard** — PASS. Save failure retains the mounted draft; Save/Discard/Stay orchestration blocks navigation until the selected outcome completes; in-flight edits remain dirty.
5. **Linked chapter deletion** — PASS. An authoritative linked fixture returns `LINKED_DELETE_NOT_AVAILABLE`, performs zero commit calls, and remains byte-equivalent after the attempt.
6. **Restoration and security** — PASS. Reopen derives first-item/empty selection without durable selection state. Contract checks confirm three named methods and no renderer filesystem, path, Git, raw stack, or generic IPC authority.

## Security and storage notes

- BrowserWindow retains `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
- Canonical content is main-owned at `workspace/writing-orientation.json`, revision-protected, serialized per project, and written by sibling-temp flush/close/rename.
- Successful saves use the ADR-001 application-managed Git adapter and structured trailers. Interrupted commit state remains under ignored `runtime/pending/` and loads as `STORAGE_RECOVERY_REQUIRED`.
- The first sandboxed Electron smoke attempt could not launch the GUI process; the required out-of-sandbox runtime execution passed.
