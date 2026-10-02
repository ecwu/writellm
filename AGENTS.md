# WriteLLM Agent Guide

Read this file first when working in this repository.

## Required Reading

Before changing code, read:

1. `docs/architecture.md` for technology choices, process responsibilities, and required rules.
2. `docs/current-plan.md` for the current checkpoint, acceptance gate, and deferred work.
3. The architecture decision record (ADR) under `docs/adrs/` for the affected feature.
4. Any boundary-specific audit or Phase evidence linked by the current plan or relevant ADR.

Use `docs/current-plan.md` for current delivery state. Use `docs/implementation-todo.md`
to find the relevant Phase file. Completed Phase files and older audits record past work.
Read only the evidence relevant to the task. If rules conflict, follow the accepted architecture amendment or ADR that replaces the older rule.
Past authorization records describe their original task. They do not authorize new work or cancel later user authorization.

## Document Write Rules

Keep current status separate from decisions and past evidence:

- `docs/current-plan.md` is authoritative for current delivery state and platform results.
  Architecture and ADRs record decisions. Completed Phase files and audits record past evidence.
  Do not use these files as current status reports.
  Tracker checkboxes must agree with the current plan.
- Detailed checkpoint evidence (per-checkpoint checklists, `Local evidence`, authorization, and
  decision prose) lives only in the matching Phase file under `docs/implementation-todo/`. The
  tracker `docs/implementation-todo.md` keeps only a short `[x]`/`[~]`/`[!]` checklist and links.
  Do not copy detailed evidence into the tracker.
- `docs/history/implementation-log.md` records work across phases. Append new entries. Do not rewrite existing entries.
  If maintenance has no numbered Phase file, append its evidence to this log.
- Update only records affected by the task: the current plan for delivery-state changes, the
  tracker for checkpoint-state changes, and the Phase file or history log for completed
  implementation. Keep affected records consistent in the same change. Documentation-only
  corrections do not require progress entries or unrelated tracker/history edits.

## Orchestration And Delegation

The primary agent owns scope, integration, final verification, and user communication.
Follow the current session's delegation rules.
If those rules permit delegation, assign independent tasks only when this saves time or improves quality.
Name the files each worker can edit. Do not assign concurrent writes to the same file.
Workers must stay within the assignment. Workers must not commit or push.
Report the result, evidence, verification, and unresolved risks.

## Working Rules

- Follow the scope authorized by the current request and prior conversation.
  This includes requested maintenance and checkpoint changes.
  Do not ask again for authorization already given. Do not start unrequested phases.
  Make routine, reversible implementation choices within scope. Follow Decision Changes for material departures.
- Update affected delivery records under Document Write Rules. A task is complete only after
  its applicable acceptance criteria and verification steps pass.
- Keep changes small and reviewable. Do not install dependencies for future phases.
- Treat the renderer as untrusted.
  It must not receive Node.js, raw IPC, database, filesystem, or plaintext credential access.
- Use shared Zod contracts to make sure that IPC inputs and outputs match their schemas.
  Main must authorize the sender. IPC means messages between application processes.
- Store application-wide authoritative state in `app.sqlite`.
  Store authoritative project state in each project's `.writellm/project.sqlite`.
  Store only rebuildable search data in that project's `.writellm/index.sqlite`.
- Use the active `projectSessionId` to authorize every project-scoped IPC and cross-process message.
  Revoke this capability, or access permission, when the session ends. Never store absolute paths in project records.
- Keep network waits and large indexing work outside database transactions and outside the renderer.
- Durable job handlers must be idempotent (safe to run twice).
  Persist remote IDs and recovery state before continuing external workflows.
- Do not let product code depend directly on provider SDKs, sqlite-vec table layouts, or arbitrary filesystem paths.
  Use the adapters and interfaces defined in the architecture.
- Forward-only migrations require review, backup, integrity checks, and recovery coverage.
- Log feature lifecycle events through the shared observability module.
  Use fixed `subsystem`, `component`, and machine-readable `event` fields.
  Do not add feature-level `console.log` calls or separate log files.
- Never discard an error without handling it.
  If you catch an error, first log the original object as top-level `err` with the operation context.
  Preserve its stack and `cause`.
  Then recover explicitly, rethrow it, or return a safe error that retains the cause.
  A message such as "operation failed" without the original error is not acceptable.
- Do not leak secrets or private content when logging the original error.
  Never log credentials, authorization/cookie headers, full prompts or responses, document bodies, embedding vectors, signed URLs, SQL parameters, or private absolute paths.
  Log safe IDs, hashes, counts, relative paths, status codes, and durations.
- Use the shared AsyncLocalStorage context to correlate operations.
  Pass this context across process boundaries. Preserve `operationId`, `jobId`, and `requestId` when available.
- Remove sensitive data from Renderer errors and user-facing messages when necessary.
  The Main/worker logger must first receive the original error under the logging restrictions above.
  SQLite audit records remain authoritative. Never use logs as recovery state.
- Never add Redis, a standalone vector service, Prisma, `node-sqlite3`, a broad RPC framework, or plaintext secret storage unless the architecture decision is explicitly revised.
- Make sure that native modules work in packaged artifacts. Development tests alone are insufficient.

## Formatting And Style Checks

Use Biome for formatting and style checks. Run these commands from the repository root with pnpm:

- `pnpm check`: verify formatting and lint rules without changing files. Use the Verification Gates below to select the applicable checks.
- `pnpm check:write`: apply formatting and safe lint fixes.
- `pnpm check:write --unsafe`: apply formatting plus safe and unsafe lint fixes. Review the resulting diff carefully.
- `pnpm format`: format supported files.
- `pnpm format:check`: verify formatting only.
- `pnpm lint`: run lint rules only.
- `pnpm lint --write`: apply safe lint fixes only.

Prefer `pnpm check:write` for routine cleanup.
If you use `pnpm check:write --unsafe`, review every proposed behavior change.
`biome.json` defines Biome configuration and excluded files.

## Verification Gates

Choose tests for the affected feature or process boundary. Do not run every gate in sequence.
Before verification, state the selected scope and reason.
After verification, report counts, duration, retries, and platform limits.
Reuse results that still cover the final source. Rerun only affected checks.

| Change | Default verification |
| --- | --- |
| Documentation only | Diff, formatting, and guidance/link consistency; no application build or tests |
| UI text, styling, small Renderer change | `check:fast`; a corresponding E2E only when interaction changes |
| Local business logic | `check:fast` plus `pnpm test <files> [-t <name>]` |
| IPC, persistence, project lifecycle | Relevant integration tests plus affected real Electron scenarios |
| Shared infrastructure or cross-module feature | Expand related coverage; use complete suites when justified |
| Electron, native libraries, worker entrypoint, Pino transport, package resources | Packaged runtime verification; full package gate for packaging/native compatibility changes |
| Comprehensive release acceptance | Explicit complete acceptance with one build per invocation |

- `pnpm check:fast`: Biome and Node/Renderer typechecks.
- `pnpm test [files or directory] [-t name]`: Electron-hosted tests only. No filters means all
  Vitest tests. Prefer explicit filters for local changes. Reuse prior static checks when valid.
- `pnpm test:e2e [file or --grep filters]`: selected E2E against an existing matching build;
  no filters means all source E2E. Does not build or repeat static checks.
- `pnpm check:e2e [file or --grep filters]`: static checks, one fresh build, and silent E2E.
- `pnpm check:full`: static checks, complete Vitest, one build, and complete source E2E.
- `pnpm check:package:smoke`: static checks, one unpacked App, inventory, and packaged runtime smoke.
- `pnpm check:package`: static checks, recovery scenario inventory, one App, runtime smoke,
  complete packaged E2E, and installers made from that same App. macOS permits no Team identity;
  the upstream ad-hoc/linker signature is allowed.
- `pnpm check:release`: explicit signed distribution validation, including existing macOS
  notarization requirements. Never run it for routine development.

`pnpm build` prepares native modules and compiles without typechecking or testing. `pnpm package`
creates an App and installers; `pnpm package:unpack` creates only the App. Both accept
`--target=<target>` (default: current host), check the package inventory, and run no functional tests.
CI uses the same package command. A successful build is not test evidence.
`critical` selects a coverage subset. Do not use it by default for small changes.
Choose a combined gate or focused tests. Do not automatically run `check:fast`, `check:e2e`, and `check:package` in sequence.
Avoid repeated builds. Reports live under `.cache/verification/`.
Timing statistics help diagnose performance. They do not change test timeouts.
Run benchmarks only when the task requires them.
The command catalog and removed-alias migration table are in `README.md`. Do not resurrect
historical aliases from completed Phase files, ADRs, or audit evidence.

Use the exact pnpm version in `package.json#packageManager`.
Before printing output, pnpm 11 tries to download and switch to that version.
This also applies to `pnpm --version`.
If network access is blocked, a version mismatch can leave pnpm silent.
Do not repeatedly retry a silent command. Diagnose it once with:

```sh
pnpm --pm-on-fail=ignore --version
```

Compare the result with `package.json#packageManager`.
Change the pin only during approved environment maintenance when the installed pnpm is the accepted project version.
Do not change the pin to match an arbitrary local installation.
If pnpm still cannot start, run the installed tool directly:

```sh
./node_modules/.bin/biome check .
```

Record the fallback and do not claim that the pnpm wrapper passed.

Inside a workspace-only filesystem sandbox, `pnpm list` can fail with
`[ERR_SQLITE_ERROR] unable to open database file` because pnpm tries to open
its store index under the user's pnpm home. This is an environment diagnostic,
not evidence that the dependency is missing. Confirm an already-installed
package version without touching the store index:

```sh
node -p "JSON.parse(require('fs').readFileSync('node_modules/<package>/package.json','utf8')).version"
```

Only rerun `pnpm list` outside the sandbox when its dependency-tree output is
actually required.

## Testing And Native Runtime

When complete Electron test coverage is warranted, run from the repository root with:

```sh
pnpm test
```

The repository disables pnpm 11's automatic `verify-deps-before-run` install.
A forced Electron rebuild changes a native package binary.
With automatic installation enabled, later scripts try to reinstall `node_modules`.
That installation fails without a TTY or registry access.
After changing `package.json` or `pnpm-lock.yaml`, run an explicit frozen install.
Do not enable automatic installation before scripts.

The required test runner is `scripts/run-tests.mjs`. It launches the bundled
Electron runtime with `ELECTRON_RUN_AS_NODE=1` and then runs Vitest. Use this
runtime for tests that import `better-sqlite3` or other native modules. Do not
run `vitest run`, `pnpm exec vitest run`, or a SQLite benchmark directly with
the system Node runtime unless the native dependency has deliberately been
rebuilt for that exact Node ABI.

If Corepack or pnpm cannot start, it is valid to bypass only the package
manager wrapper and run the required test runner directly:

```sh
node scripts/run-tests.mjs
```

`npm test` is equivalent because the `test` script points to the same runner.
This direct Node command is not, by itself, a request for elevated sandbox
access. Request escalation only when the command produces a concrete
sandbox-related error such as `EACCES`, `EPERM`, a denied path outside the
workspace, or a blocked network/GUI operation. A non-zero Vitest exit caused
by assertion failures, migration errors, or Electron's non-fatal diagnostic
warnings is a test/code result, not evidence of sandbox blocking.

The test runner forwards additional Vitest arguments. Use a focused
target before rerunning the full suite:

```sh
pnpm test src/path/to/example.test.ts
pnpm test src/path/to/example.test.ts -t "specific test name"
```

Electron's macOS `task_name_for_pid: (os/kern) failure (5)` diagnostic is
non-fatal when Vitest continues and reports its normal test summary. Do not
classify that line alone as a test failure or rerun reason.

Before diagnosing a native-module failure, compare the ABI of the runtime
that will execute the test with the ABI of the installed addon:

```sh
node -p "process.versions.modules"
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron -p "process.versions.modules"
```

The system Node and Electron ABIs are allowed to differ. For this repository,
the full suite targets Electron, so an Electron-compatible `better-sqlite3`
binary is the expected state. Restore that state with the existing dependency
installer when necessary:

```sh
./node_modules/.bin/electron-builder install-app-deps
```

With Electron 43 and `better-sqlite3` 12, `install-app-deps` can report
success while retaining a prebuilt binary for the system Node ABI. If the ABI
check still fails after that command, force the repository's
Electron-targeted rebuild and rerun the ABI check:

```sh
pnpm prepare:native --force
```

Do not rebuild `better-sqlite3` for system Node merely to make direct Vitest
invocation pass; that can replace the Electron-compatible binary and make the
Electron-hosted suite fail. If a Node-only benchmark is required, use a separate
dependency environment or explicitly rebuild for Node and restore the
Electron dependencies before running the application test suite. Record the
runtime, ABI, command, test counts, and failure class in the verification
report.

## Electron E2E

Reuse `out/` when it matches the source, dependencies, configuration, and resources
under test. Build once if output is missing or affected inputs changed, then run
`pnpm test:e2e` with the selected file or grep filters. A composite verification
gate that already built matching output satisfies this prerequisite; do not
prepend another build. Preserve filters on reruns. Packaged verification still
uses the matching packaged App required by Verification Gates.

Use the silent E2E wrapper for normal agent verification.
Use `pnpm test:e2e --visible` only for explicitly requested interactive
debugging.

In the Codex macOS sandbox, Electron Playwright requires authority to launch
and control Electron child processes and to listen on loopback debugging and
fixture ports. Run `pnpm test:e2e` outside the sandbox with approval. The
signatures `listen EPERM: operation not permitted 127.0.0.1`,
`electron.launch: Process failed to launch`, or a cleanup `kill EPERM` are
sandbox failures. Do not debug application code or let all scenarios repeat
inside the sandbox after one of these signatures; rerun the same built suite
outside the sandbox. Treat assertions, timeouts after a successful launch,
and application log errors as test/product results instead.

## UI Design Requirements

WriteLLM targets normal desktop windows. Do not introduce mobile layouts, special narrow-window
breakpoints, or narrow-window-specific verification. The configured desktop Agent sidebar must
remain usable: its controls must not overlap, and its resize handle must continue to work.

- Use the official shadcn/ui `new-york` preset and its generated components.
  Do not create a separate visual system. Do not hand-write replacements for available shadcn/ui components.
- Use official components for buttons, cards, menus, dropdown menus, commands, dialogs, forms, inputs, badges, sidebars, and similar primitives.
  Compose them with standard Tailwind layout utilities.
  Add product-specific CSS only when the preset and utilities cannot express an interaction or platform requirement.
- Use `Card` for general layout or spacing only when the task explicitly requests it.
  Prefer flex containers for desktop content layout.
- Keep a global command surface in every application state: the native application menu on macOS
  (ADR 084), and the shadcn `Menubar` on Windows and Linux. Project creation, opening, switching, saving, settings, and diagnostics entry points belong there when available.
- Make Settings available from anywhere through the shadcn `Command` component.
  Do not implement a standalone settings page.
- Follow ADR 083 for the active-project shell.
  Keep the shadcn activity rail, controls, one Dockview content tab group, and independently dockable tool groups.
  Keep contextual sidebars inside their content or tool surface. Do not restore the fixed sidebar-09 composition.
- Use the existing shell and official components for future screens.
  Do not add custom gradients, decorative hero layouts, arbitrary radii, custom shadows, or one-off control styling.
- Preserve keyboard-accessible behavior from the official components. Any unavailable future action must be visibly disabled or labeled as unavailable rather than simulated.

## Decision Changes

`docs/architecture.md` is the accepted baseline. For a material departure:

1. Check the current request and prior conversation for authorization. An already
   approved decision change does not require repeat approval.
2. Document the reason, alternatives, migration impact, and affected roadmap items.
3. If the departure is not authorized, defer only that choice, complete independent
   authorized work, and ask for approval with the concrete proposal and evidence.
4. Once authorized, update the affected architecture and planning records before
   implementing the departure. Preserve security, data-integrity, migration, and
   accessibility guarantees; routine implementation choices within them need no
   separate architecture approval.
