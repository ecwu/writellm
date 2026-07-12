# WriteLLM v2 repository guidance

This branch is a greenfield rebuild. The `legacy/v1-freeze` Git tag preserves
the prior product; do not copy its product code, persistence model, IPC
contract, UI components, tests, or dependencies into v2.

## Document scope

This file defines repository-wide guardrails and commands. It does not define
product requirements or feature-specific implementation details.

For product work, use the active feature's documents under `specs/<feature>/`:
`spec.md` defines user value, scope, and acceptance; `plan.md` defines the
implementation design; and accepted ADRs define decisions that cross durable,
system, or process boundaries.

## Specification registry

Before clarifying, planning, creating tasks for, or implementing a feature,
read [`specs/README.md`](specs/README.md) and check the target feature's
dependencies, spec status, plan status, ADR gate, tasks, and implementation
status.

The registry is an index, not a replacement for the source documents. The
target feature's `spec.md`, `plan.md`, and accepted ADRs remain authoritative.
When one of those statuses changes, update both its source of truth and the
registry in the same change.

## Implementation gate

Do not implement a product feature until its active `spec.md` and `plan.md` are
accepted, and every required cross-boundary ADR is accepted or explicitly
recorded as not required. Unresolved decisions must remain in design/review;
they must not be silently converted into implementation choices.

## Commands

- `bun run dev` — start the renderer dev server.
- `bun run dev:electron` — start Electron against the dev server.
- `bun run build` — compile Electron/preload and build the renderer.
- `bun run typecheck` — check renderer/shared and Electron/preload TypeScript.
- `bun run test` — run unit tests.
- `bun run test:smoke` — build and validate the compiled Electron foundation.

## Security baseline

- Keep `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
- Expose only named, typed IPC methods from preload; never expose generic IPC.
- Validate all future renderer-originated input in the main process.
