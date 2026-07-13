# WriteLLM v2 repository guidance

This branch is a greenfield rebuild. The `legacy/v1-freeze` Git tag preserves
the prior product; do not copy its product code, persistence model, IPC
contract, UI components, tests, or dependencies into v2.

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
