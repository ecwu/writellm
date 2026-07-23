# WriteLLM Agent Guide

This file is the entry point for agents working in this repository.

## Required Reading

Before changing code, read:

1. `docs/architecture.md` for fixed technology choices, process boundaries, and invariants.
2. `docs/current-plan.md` for the current checkpoint, acceptance gate, and deferred work.
3. The ADR under `docs/adrs/` that covers the current boundary or decision.
4. `docs/audits/2026-07-16-complexity-reduction-and-agent-boundary.md` when a task touches its frozen boundaries, and the Checkpoint 19.6/19.7 task lists in `docs/implementation-todo.md` while that remediation window is pending.

`docs/implementation-todo.md`, `docs/implementation-todo/`, and older audit
records are historical evidence. Read only the Phase material relevant to the
current checkpoint; newer architecture amendments and ADRs are authoritative
when historical text conflicts with them.

The Phase files under `docs/implementation-todo/` contain historical implementation evidence. Read only the Phase material related to the current checkpoint. If a Phase file conflicts with the architecture amendment or the CP19.5 audit, the newer amendment is authoritative and the older passage is historical.

## Orchestration And Delegation

The main Claude thread is the only orchestrator. It owns requirement interpretation, task decomposition, worker selection, result integration, final verification, and user communication. Do not create or delegate to a general-purpose worker.

Spawn a fixed-role subagent only when all of these conditions hold:

- the work is expected to take more than roughly 10 minutes;
- the assignment is independently executable;
- the result can be returned as a compact summary;
- the work does not share mutable state with another active worker.

Multiple files alone are not a reason to delegate. Prefer sequential execution unless parallelism is expected to reduce latency without introducing shared-state conflicts. Use these advisory concurrency limits and never exceed eight active workers:

- small task: 0 workers;
- normal coding task: 1-2 workers;
- large refactor: 3-4 workers;
- unusually broad research: 5-8 workers.

Choose workers by capability: research, architecture, implementation, review, testing, documentation, refactoring, or security. Every worker handoff must include `Summary`, `Evidence / files`, `Verification`, and `Unresolved risks`. Workers may not delegate further, commit or push, expand the approved checkpoint, or perform unrelated cleanup.

## Working Rules

- Implement only the currently agreed checkpoint. Do not continue into later phases without explicit user approval.
- Update `docs/implementation-todo.md` when a task starts or finishes. A task is complete only after its acceptance criteria and verification steps pass.
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

- `pnpm check`: verify formatting and lint rules without changing files. Run this before considering a change complete.
- `pnpm check:write`: apply formatting and safe lint fixes.
- `pnpm check:unsafe`: apply formatting plus safe and unsafe lint fixes. Review the resulting diff carefully.
- `pnpm format`: format supported files.
- `pnpm format:check`: verify formatting only.
- `pnpm lint`: run lint rules only.
- `pnpm lint:write`: apply safe lint fixes only.

Prefer `pnpm check:write` for routine cleanup. Do not use `pnpm check:unsafe` without reviewing every behavioral change it proposes. Biome configuration and excluded generated or local files are defined in `biome.json`.

## Verification Gates

Use the smallest gate that covers the changed boundary:

- `pnpm check:fast`: Biome plus Node/Renderer typechecks.
- `pnpm check:electron`: the Electron-hosted Vitest suite plus a production build.
- `pnpm check:e2e`: a fresh production build plus the silent Electron Playwright suite.
- `pnpm check:package`: a no-identity unpacked build plus packaged hybrid smoke. It explicitly
  disables Apple signing-identity discovery and, on macOS, fails if the resulting application has
  an Apple Team identity signature. An upstream ad-hoc/linker signature without a Team ID is
  allowed because it does not run the project's deep signing pass.
- `pnpm check:release`: an opt-in signed macOS unpacked build plus strict deep signature validation
  and packaged hybrid smoke. Run it only when the user explicitly requests release/distribution
  verification. It does not notarize while `electron-builder.yml` keeps notarization disabled.

Routine development verification must not run `check:release`. Ordinary product changes do not
need `check:package`; require it for Electron major, native SQLite/sqlite-vec, electron-builder,
worker entrypoint, Pino transport, packaged resource, or release-branch changes.

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

Run the full test suite from the repository root with:

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
pnpm run rebuild:native
```

Do not rebuild `better-sqlite3` for system Node merely to make direct Vitest
invocation pass; that can replace the Electron-compatible binary and make the
canonical suite fail. If a Node-only benchmark is required, use a separate
dependency environment or explicitly rebuild for Node and restore the
Electron dependencies before running the application test suite. Record the
runtime, ABI, command, test counts, and failure class in the verification
report.

## Electron E2E

Build immediately before the Electron Playwright suite so `out/` matches the
current source:

```sh
pnpm build
pnpm test:e2e
```

The default E2E wrapper is silent and should remain the normal agent path.
Use `pnpm test:e2e:visible` only for explicitly requested interactive
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

- Use the official shadcn/ui `new-york` preset and its generated components as the renderer design system. Do not create a parallel visual system or hand-write replacements for components available from shadcn/ui.
- Use official components for buttons, cards, menus, dropdown menus, commands, dialogs, forms, inputs, badges, sidebars, and similar primitives. Compose them with standard Tailwind layout utilities; do not add product-specific CSS unless an interaction or platform constraint cannot be expressed by the preset and utilities.
- Do not use `Card` as a general-purpose layout or spacing tool unless the task explicitly requests it. Prefer content-oriented screens and containers composed with flex layouts, and define responsive breakpoints deliberately for different screen sizes.
- Keep a global shadcn `Menubar` at the top of every application state. Project creation, opening, switching, saving, settings, and diagnostics entry points belong there when available.
- Settings are a global command surface that can be opened from anywhere, implemented with the shadcn `Command` component rather than a standalone settings page.
- Base the active-project workspace on the official shadcn `sidebar-09` block: a collapsible icon rail plus contextual secondary sidebar and a `SidebarInset` content region.
- Extend the established shell and official component language for future screens. Do not introduce bespoke gradients, decorative hero layouts, arbitrary radii, custom shadows, or one-off control styling.
- Preserve responsive and keyboard-accessible behavior from the official components. Any unavailable future action must be visibly disabled or labeled as unavailable rather than simulated.

## Decision Changes

`docs/architecture.md` is the accepted baseline, not an informal suggestion. If implementation evidence requires a change:

1. Stop before introducing the conflicting choice.
2. Document the reason, alternatives, migration impact, and affected roadmap items.
3. Ask the user to approve the decision.
4. Update the architecture and todo documents before implementation.
