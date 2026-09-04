# writellm

An Electron application with React and TypeScript

## Implementation Status

WriteLLM v2 is being built incrementally from this starter. Before making implementation changes, read:

- [`AGENTS.md`](./AGENTS.md) for repository working rules.
- [`docs/architecture.md`](./docs/architecture.md) for fixed architecture and technology decisions.
- [`docs/implementation-todo.md`](./docs/implementation-todo.md) for the ordered roadmap and current checkpoint.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [Biome](https://marketplace.visualstudio.com/items?itemName=biomejs.biome)

## Project Setup

The repository requires Node.js `24.15.0` or newer within the Node 24 major line, plus pnpm
`11.17.0`. On Debian/WSL x64, the bootstrap script installs Node and pnpm into the current user's
`~/.local`, installs the frozen dependency graph, and prepares the Electron native modules:

```bash
$ sudo apt-get update
$ sudo apt-get install -y build-essential python3 curl xvfb dbus-x11 gnome-keyring libsecret-1-0 libsecret-tools libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 libxtst6 libxrandr2 libxdamage1 libxcomposite1
$ bash scripts/bootstrap-dev.sh
```

WSL does not need a desktop GUI. Install `xvfb` and run Electron commands headlessly:

```bash
$ xvfb-run --auto-servernum pnpm test:e2e
```

Windows NSIS and AppX packages must be built from native Windows x64 because the application
bundles platform-specific native modules. In an elevated or user-scoped PowerShell session, run:

```powershell
PS> Set-ExecutionPolicy -Scope Process Bypass
PS> .\scripts\bootstrap-dev.ps1
```

### Install

```bash
$ pnpm install
```

### Development

```bash
$ pnpm dev
```

### Build and package

```bash
# Compile development output; no tests or typechecks
$ pnpm build

# Unpacked application for the current host
$ pnpm package:unpack

# Unpacked application and installers for the current host
$ pnpm package

# Explicit native target (Windows NSIS shown; run on Windows x64)
$ pnpm package --target=windows-x64
```

`build` compiles to `out/`. `package` and `package:unpack` compile, assemble, and check the
package inventory without running functional tests or typechecks. Installers reuse that exact
application through electron-builder's `--prepackaged` option. CI uses the same `package` command.
Both package commands accept `--target=windows-x64`, `windows-appx`, `macos-arm64`, `macos-x64`, or
`linux-x64`; omit it to use the current host. Add `--plan` to inspect the plan without building.

Packaging is intentionally native-host-only because `better-sqlite3` and
`sqlite-vec` are platform binaries. Linux x64 can be packaged inside WSL with `xvfb-run`; Windows
NSIS/AppX must run from Windows x64. These commands write versioned artifacts under
`dist/windows-x64`, `dist/windows-appx`, and `dist/linux-x64`.

### Verification

Choose the smallest scope that covers the change; see `AGENTS.md` for the change-to-test table.
Atomic commands do one job. Composite `check:*` gates combine prerequisites for a specific
acceptance scope; they are alternatives, not a sequence to run after every edit.

| Command | Responsibility | Builds / functional tests |
| --- | --- | --- |
| `check` / `check:write` | Biome formatting and lint, read-only / safe fixes | Neither |
| `format` / `format:check` / `lint` | Formatting only / format verification / lint only | Neither |
| `typecheck` | Main and Renderer typechecks; `:node` and `:web` select one side | Neither |
| `test [files or directory] [-t name]` | Electron-hosted Vitest; no filters means the complete Vitest suite | No build |
| `test:e2e [file] [--grep pattern]` | Silent Playwright against the existing build; no filters means all source E2E | No build |
| `check:fast` | Biome and both typechecks | Neither |
| `check:e2e [file] [--grep pattern]` | Static checks and selected real Electron scenarios | One fresh build, selected E2E |
| `check:full` | Complete source acceptance | Static, all Vitest, one build, all source E2E |
| `check:fixtures` | Recovery coverage inventory | Neither; inventory is not test execution |
| `check:package:smoke` | Native/runtime acceptance of an unpacked App | Static, one App, inventory, runtime smoke |
| `check:package` | Complete package acceptance | Adds recovery inventory, packaged E2E, and installers from that App |
| `check:release` | Explicit signed distribution acceptance | Full package gate plus signing/notarization requirements |

For a local logic change, run static checks once and filter Vitest by file, directory, or test
name. Existing tests include both isolated logic and database/process integration; they all use
the canonical Electron runtime so SQLite retains the correct ABI. Directory filters select a
subsystem without pretending that every test in that directory is a unit test.

```bash
pnpm check:fast
pnpm test src/main/project/project-manager.test.ts
pnpm test src/main/project/project-manager.test.ts -t "switch"
pnpm test src/main/project
```

Interaction changes add the affected E2E scenarios. Use the composite when a fresh build and
static checks are needed. If static checks already cover the final source, use `build` followed
by `test:e2e`. If only tests changed, reuse the matching build and rerun just `test:e2e`.

```bash
pnpm check:e2e e2e/project-lifecycle.spec.ts --grep restart
# Or, after static checks already passed:
pnpm build
pnpm test:e2e e2e/project-lifecycle.spec.ts --grep restart
```

Pass options directly after the command name. `test:e2e --visible` enables interactive debugging;
`test:e2e --suite=critical` selects the critical subset. The same options work with `check:e2e`.
Critical coverage is not a substitute for selecting the scenarios affected by a change.
No automatic changed-file dependency inference or test-result cache is introduced.

Full source and package gates are explicit acceptance choices, not prerequisites for every local
edit. Package gates accept `--target=<target>` and build their own App, so do not run `build` or
`package` immediately before them. A successful build is not test evidence.

### Maintenance and benchmarks

- `prepare:native`: ensure the Electron native target; add `--force` to rebuild it.
- `postinstall`: automatic native preparation after installation; not a manual verification gate.
- `benchmark:index`, `benchmark:index:100k`, `benchmark:manuscript-search`,
  `benchmark:manuscript-replacement`, `benchmark:trace`: explicit performance experiments.
- `sync:provider-logos`: refresh the provider logo assets.

Use `pnpm lint --write` for lint-only fixes and `pnpm check:write --unsafe` only when every
proposed behavioral change will be reviewed. These options do not need separate aliases.

### Command migration

| Removed command | Replacement |
| --- | --- |
| `check:electron [filters]` | `check:fast` once, then `test [filters]`; add `build` only when needed |
| `build:unpack` | `package:unpack` |
| `build:mac` | `package` on the native macOS host |
| `build:win`, `build:windows`, `build:windows-app`, `build:linux` | `package --target=windows-x64`, `windows-appx`, or `linux-x64` |
| `package:<target>`, `package:ci:<target>` | `package --target=<target>` |
| `test:e2e:critical`, `check:e2e:critical` | `test:e2e --suite=critical`, `check:e2e --suite=critical` |
| `test:e2e:visible` | `test:e2e --visible` |
| `rebuild:native` | `prepare:native --force` |
| `check:unsafe`, `lint:write` | `check:write --unsafe`, `lint --write` |
| `benchmark`, `benchmark:smoke` | `benchmark:index`, `benchmark:index:100k` |
| `smoke:packaged-hybrid` | `check:package:smoke` for acceptance; the internal smoke script remains available for diagnostics |

Completed history and ADR command examples retain their original spelling as historical evidence.

### Verification reports

Stage starts, completions, and 30-second progress updates appear in the terminal. JSON reports in
`.cache/verification/` contain elapsed time, scope, outcomes, and test attempts. Timing is diagnostic;
functional test timeouts remain separate. Recovery fixture checks verify the declared coverage
inventory, not execution of the named tests. Final installers retain SHA256 checksums; internal
ASAR/native inventory does not maintain separate custom hashes.

Shared timeout and retry policy lives in `scripts/test-timeouts.mjs`: local E2E uses 45 seconds,
hosted/headless E2E 90 seconds, and packaged or hosted Windows E2E 180 seconds. Hosted E2E retains
one retry and fails on flaky results. Scenario-specific waits remain alongside their scenarios.
Playwright attempt durations are measured; Vitest retry-event spans are explicitly labeled
estimates because its reporter API exposes only aggregate test duration.
