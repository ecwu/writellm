# WriteLLM Agent Guide

This file is the entry point for agents working in this repository.

## Required Reading

Before changing code, read:

1. `docs/architecture.md` for fixed technology choices, process boundaries, and invariants.
2. `docs/current-plan.md` for the current checkpoint, acceptance gate, and deferred work.
3. The ADR under `docs/adrs/` that covers the current boundary or decision.
4. Any boundary-specific audit or Phase evidence linked by the current plan or relevant ADR.

`docs/implementation-todo.md`, `docs/implementation-todo/`, and older audit
records are historical evidence. Read only the Phase material relevant to the
current checkpoint; newer architecture amendments and ADRs are authoritative
when historical text conflicts with them.

## Document Write Rules

Keep the mutable/immutable split strict so documents never drift from the state they claim:

- `docs/current-plan.md` is authoritative for current delivery state and platform results.
  Architecture, ADRs, completed Phase files, and audits record decisions or historical evidence;
  do not turn them into live status reports. Tracker checkboxes summarize checkpoint state and
  must agree with the current plan.
- Detailed checkpoint evidence (per-checkpoint checklists, `Local evidence`, authorization, and
  decision prose) lives only in the matching Phase file under `docs/implementation-todo/`. The
  tracker `docs/implementation-todo.md` keeps only a short `[x]`/`[~]`/`[!]` checklist plus routing
  links; do not copy evidence back into it.
- `docs/history/implementation-log.md` is the append-only cross-phase chronology. Maintenance that
  has no numbered Phase home is appended there rather than kept in a standalone file.
- Update only records affected by the task: the current plan for delivery-state changes, the
  tracker for checkpoint-state changes, and the Phase evidence or history log for completed
  implementation. Keep affected records consistent in the same change. Documentation-only
  corrections do not require progress entries or unrelated tracker/history edits.

## Orchestration And Delegation

The primary agent owns scope, integration, final verification, and user communication.
When permitted by the current session's delegation rules, delegate bounded,
independently executable work only when it saves time or improves quality.
Assign explicit file ownership for writes and avoid concurrent edits to shared
state. Return a compact summary with evidence, verification, and unresolved risks.
Workers must stay within the authorized scope and must not commit or push.
Repository guidance does not override the harness's delegation restrictions.

## Working Rules

- Work within the scope authorized by the current user request and prior conversation,
  including explicitly requested maintenance or checkpoint changes. Do not ask again for
  authorization already given, or expand into unrequested phases. Resolve routine reversible
  implementation choices within that scope; follow Decision Changes for material departures.
- Update affected delivery records under Document Write Rules. A task is complete only after
  its applicable acceptance criteria and verification steps pass.
- Keep changes small and reviewable. Do not install dependencies for future phases.
- Treat the renderer as untrusted. It must not receive Node.js, raw IPC, database, filesystem, or plaintext credential access.
- Validate IPC inputs and outputs with shared Zod contracts and authorize the sender in the main process.
- Keep application-global authority in `app.sqlite`, project authority in each project's `.writellm/project.sqlite`, and only rebuildable search data in that project's `.writellm/index.sqlite`.
- Treat the active `projectSessionId` as a revocable capability on every project-scoped IPC and cross-process message; never store absolute paths in project records.
- Keep network waits and large indexing work outside database transactions and outside the renderer.
- Durable job handlers must be idempotent. Persist remote IDs and recovery state before continuing external workflows.
- Do not let product code depend directly on provider SDKs, sqlite-vec table layouts, or arbitrary filesystem paths. Use the adapters and interfaces defined in the architecture.
- Forward-only migrations require review, backup, integrity checks, and recovery coverage.
- Every implemented feature must emit structured lifecycle logs at useful boundaries through the shared observability module. Use fixed `subsystem`, `component`, and machine-readable `event` fields; do not introduce feature-level `console.log` calls or independent log files.
- Never swallow errors. When catching an error, log the original error object as top-level `err` before it can be transformed or discarded, together with the operation context. Preserve its stack and `cause`; then recover explicitly, or rethrow/return a safe error that retains the cause. A message such as "operation failed" without the original error is not acceptable.
- Logging the original error does not permit leaking secrets or private content. Never log credentials, authorization/cookie headers, full prompts or responses, document bodies, embedding vectors, signed URLs, SQL parameters, or private absolute paths. Log safe IDs, hashes, counts, relative paths, status codes, and durations instead.
- Use the shared AsyncLocalStorage correlation context and propagate it explicitly across process boundaries. Preserve `operationId`, `jobId`, and `requestId` when available.
- Renderer-safe errors and user-facing messages may be sanitized, but the main/worker logger must first receive the diagnostic original. Audit records in SQLite remain authoritative; logs must never be used as recovery state.
- Never add Redis, a standalone vector service, Prisma, `node-sqlite3`, a broad RPC framework, or plaintext secret storage unless the architecture decision is explicitly revised.
- Verify native modules in packaged artifacts, not only in development mode.

## Formatting And Style Checks

Biome is the repository's single formatter and style checker. Run commands from the repository root with pnpm:

- `pnpm check`: verify formatting and lint rules without changing files. Use the Verification Gates below to select the applicable checks.
- `pnpm check:write`: apply formatting and safe lint fixes.
- `pnpm check:write --unsafe`: apply formatting plus safe and unsafe lint fixes. Review the resulting diff carefully.
- `pnpm format`: format supported files.
- `pnpm format:check`: verify formatting only.
- `pnpm lint`: run lint rules only.
- `pnpm lint --write`: apply safe lint fixes only.

Prefer `pnpm check:write` for routine cleanup. Do not use `pnpm check:write --unsafe` without reviewing every behavioral change it proposes. Biome configuration and excluded generated or local files are defined in `biome.json`.

## Verification Gates

Choose tests by the changed boundary, not by running every gate in sequence. Before verification,
state the selected scope and reason; afterwards report counts, duration, retries, and any remaining
platform limits. Reuse results that still cover the final source; rerun only affected checks.

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
- `pnpm test [files or directory] [-t name]`: Electron-hosted tests only; no filters means all
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
CI uses the same package command. A successful
build is not test evidence. `critical` is a coverage subset, not the default for small changes.
Do not chain `check:fast`, `check:e2e`, and `check:package` reflexively: select a composite gate
or focused tests and avoid repeated builds. Reports live under `.cache/verification/`; timing
statistics are diagnostic, separate from test hard timeouts. Benchmarks remain explicit.
The command catalog and removed-alias migration table are in `README.md`. Do not resurrect
historical aliases from completed Phase files, ADRs, or audit evidence.

The repository's exact `packageManager` version must match the locally
installed pnpm used by agents. pnpm 11 tries to download and switch to the
manifest version before it prints any command output, including for
`pnpm --version`; in a network-restricted sandbox, a version mismatch can
therefore look like an indefinite silent hang. Do not keep retrying a silent
pnpm command. Diagnose it once with:

```sh
pnpm --pm-on-fail=ignore --version
```

Compare that result with `package.json#packageManager`. Align the repository
pin only during an approved environment-maintenance task when the installed
pnpm is the accepted project version; do not rewrite it merely to suit an
arbitrary local installation. If pnpm itself still cannot start, run the
installed tool directly:

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
The forced Electron native rebuild intentionally changes a package binary and
otherwise makes every later script try to reinstall `node_modules` (and fail
without a TTY or registry access). Run an explicit frozen install after
changing `package.json` or `pnpm-lock.yaml`; do not re-enable the implicit
pre-script install.

The canonical runner is `scripts/run-tests.mjs`. It launches the bundled
Electron runtime with `ELECTRON_RUN_AS_NODE=1` and then runs Vitest. Use this
runtime for tests that import `better-sqlite3` or other native modules. Do not
run `vitest run`, `pnpm exec vitest run`, or a SQLite benchmark directly with
the system Node runtime unless the native dependency has deliberately been
rebuilt for that exact Node ABI.

If Corepack or pnpm cannot start, it is valid to bypass only the package
manager wrapper and run the repository's canonical runner directly:

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

The canonical runner forwards additional Vitest arguments. Use a focused
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
canonical suite fail. If a Node-only benchmark is required, use a separate
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

The default E2E wrapper is silent and should remain the normal agent path.
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

- Use the official shadcn/ui `new-york` preset and its generated components as the renderer design system. Do not create a parallel visual system or hand-write replacements for components available from shadcn/ui.
- Use official components for buttons, cards, menus, dropdown menus, commands, dialogs, forms, inputs, badges, sidebars, and similar primitives. Compose them with standard Tailwind layout utilities; do not add product-specific CSS unless an interaction or platform constraint cannot be expressed by the preset and utilities.
- Do not use `Card` as a general-purpose layout or spacing tool unless the task explicitly requests it. Prefer content-oriented screens and containers composed with flex layouts for the configured desktop surfaces.
- Keep a global shadcn `Menubar` at the top of every application state. Project creation, opening, switching, saving, settings, and diagnostics entry points belong there when available.
- Settings are a global command surface that can be opened from anywhere, implemented with the shadcn `Command` component rather than a standalone settings page.
- Base the active-project workspace on the official shadcn `sidebar-09` block: a collapsible icon rail plus contextual secondary sidebar and a `SidebarInset` content region.
- Extend the established shell and official component language for future screens. Do not introduce bespoke gradients, decorative hero layouts, arbitrary radii, custom shadows, or one-off control styling.
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
