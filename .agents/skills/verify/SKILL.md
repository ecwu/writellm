---
name: verify
description: Verify the Electron app and its application database at runtime.
---

Select verification from the changed boundary using the table in `AGENTS.md`. Explain the selected
scope before running it and report counts, elapsed time, retries, and platform limits afterwards.
Local logic uses `check:fast` plus focused `pnpm test <files> [-t <name>]`; interaction changes add
only the affected real Electron scenarios. Do not run every complete gate for a small feature.

- `pnpm test [files or directory] [-t name]`: only selected Electron-hosted tests; no filters
  means the complete Vitest suite. Reuse static checks that still cover the final source.
- `pnpm test:e2e [file or --grep filters]`: selected E2E against an existing matching build;
  no filters means all source E2E. Add `--visible` only for requested interactive debugging.
- `pnpm check:e2e [file or --grep filters]`: static checks, one fresh build, selected E2E.
- `pnpm check:full`: static checks, complete Electron tests, one build, complete source E2E.
- `pnpm check:package:smoke`: static checks, unpacked App, inventory, existing runtime smoke.
- `pnpm check:package`: complete package acceptance, including packaged E2E and installers made
  from the same tested App. Use for native/packaging compatibility changes; ordinary business
  changes do not require it. Signing identity discovery is disabled; no Team identity is allowed.
- `pnpm check:release`: explicit signed distribution acceptance only, preserving the release
  script's macOS signing and notarization requirements. Never use for routine development.

`build` compiles; `package` creates an App and installers; `package:unpack` creates only the App.
Package commands accept `--target=<target>` and share the same entry point locally and in CI.
These commands run no functional tests or typechecks. A successful build
is not test evidence. `critical` is a coverage subset, not a default small-change gate. Avoid
chaining overlapping composite gates; reuse final-source results and rerun only affected checks.
Stage and test-attempt reports are under `.cache/verification/`; timings do not create new
performance failure thresholds. Benchmarks are explicit (`pnpm benchmark:trace` for trace scale).

When runtime application-database evidence is relevant:

1. Build with `pnpm build`.
2. Create an isolated root: `VERIFY_ROOT=$(mktemp -d /tmp/writellm-verify-XXXXXX)`.
3. Launch the real app with `./node_modules/.bin/electron . --user-data-dir="$VERIFY_ROOT/user-data"` in the background.
4. After the window starts, inspect `$VERIFY_ROOT/user-data/app.sqlite` with the system `sqlite3` CLI. Do not launch a second Electron process to inspect SQLite; it will remain open as another GUI process.
5. Capture `PRAGMA application_id`, `PRAGMA user_version`, `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, `sqlite_schema`, and `schema_manifest`, then stop the app cleanly.

Playwright launches `electron .` with an isolated `userData` directory per fixture. The suite's Main-only folder-selection seam is enabled by `WRITELLM_E2E_PROJECT_DIALOG_PATHS`, which must be a JSON array of selections consumed in order; it is never exposed through preload. The app's Pino logs use Electron's normal logs directory rather than the isolated `userData` directory. On Linux without a display, run E2E under `xvfb-run`.
