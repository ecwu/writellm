---
name: verify
description: Verify the Electron app and its application database at runtime.
---

1. Build with `pnpm build`.
2. Create an isolated root: `VERIFY_ROOT=$(mktemp -d /tmp/writellm-verify-XXXXXX)`.
3. Launch the real app with `./node_modules/.bin/electron . --user-data-dir="$VERIFY_ROOT/user-data"` in the background.
4. After the window starts, inspect `$VERIFY_ROOT/user-data/app.sqlite` with the system `sqlite3` CLI. Do not launch a second Electron process to inspect SQLite; it will remain open as another GUI process.
5. Capture `PRAGMA application_id`, `PRAGMA user_version`, `sqlite_schema`, and `schema_manifest`, then stop the app cleanly.
6. Run the built-app Electron E2E suite with `pnpm test:e2e`. Playwright launches `electron .` with an isolated `userData` directory per fixture. The suite's Main-only folder-selection seam is enabled by `WRITELLM_E2E_PROJECT_DIALOG_PATHS`, which must be a JSON array of selections consumed in order; it is never exposed through preload. Run E2E only after `pnpm build` so `out/` matches the source.

The app's Pino logs use Electron's normal logs directory rather than the isolated `userData` directory. On Linux without a display, run the E2E command under `xvfb-run`.
