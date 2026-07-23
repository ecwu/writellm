---
name: verify
description: Verify the Electron app and its application database at runtime.
---

Use the smallest gate that covers the changed boundary:

1. `pnpm check:fast` for Biome and Node/Renderer typechecks.
2. `pnpm check:electron` for the Electron-hosted Vitest suite and production build.
3. `pnpm check:e2e` for a fresh production build followed by the real Electron Playwright suite.
4. `pnpm check:package` only for Electron, native SQLite/sqlite-vec, electron-builder, worker-entrypoint, Pino transport, packaged-resource, or release-branch changes. This gate explicitly disables Apple signing identity discovery, proves the macOS bundle has no Apple Team identity signature (an upstream ad-hoc/linker signature is allowed), and then runs packaged hybrid smoke.
5. `pnpm check:release` only when the user explicitly requests a signed distribution/release check. This opt-in gate permits configured macOS identity discovery and performs strict deep signature validation. It does not notarize while `electron-builder.yml` keeps `mac.notarize: false`.

Routine development verification must never run `check:release` or perform Apple deep signing.

When runtime application-database evidence is relevant:

1. Build with `pnpm build`.
2. Create an isolated root: `VERIFY_ROOT=$(mktemp -d /tmp/writellm-verify-XXXXXX)`.
3. Launch the real app with `./node_modules/.bin/electron . --user-data-dir="$VERIFY_ROOT/user-data"` in the background.
4. After the window starts, inspect `$VERIFY_ROOT/user-data/app.sqlite` with the system `sqlite3` CLI. Do not launch a second Electron process to inspect SQLite; it will remain open as another GUI process.
5. Capture `PRAGMA application_id`, `PRAGMA user_version`, `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, `sqlite_schema`, and `schema_manifest`, then stop the app cleanly.

Playwright launches `electron .` with an isolated `userData` directory per fixture. The suite's Main-only folder-selection seam is enabled by `WRITELLM_E2E_PROJECT_DIALOG_PATHS`, which must be a JSON array of selections consumed in order; it is never exposed through preload. The app's Pino logs use Electron's normal logs directory rather than the isolated `userData` directory. On Linux without a display, run E2E under `xvfb-run`.
