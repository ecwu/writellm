# Maintenance: Stable Default Window State

## Overview

- Purpose: track cross-cutting maintenance that does not belong to a numbered Phase.
- Current status: Completed.
- Implementation state: the initial application window is maximized once before first display, while later project lifecycle operations preserve user-managed window state.

- [x] Maximize each newly created application window once before its first display, remove project-lifecycle maximize/unmaximize calls, preserve subsequent user window adjustments, and cover the behavior in IPC and Electron E2E tests.

Verification: Biome check passes with the pre-existing generated shadcn sidebar cookie warning; Node and web TypeScript checks pass; Electron-hosted Vitest passes 28 files and 141 tests; `electron-vite build` passes; and all 4 Playwright Electron E2E tests pass. The lifecycle E2E verifies startup maximization, manually restores the window, and proves create, close, reopen, switch, and recent-project open do not override that user adjustment.
