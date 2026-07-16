# WriteLLM Agent Guide

This file is the entry point for agents working in this repository.

## Required Reading

Before changing code, read:

1. `docs/architecture.md` for fixed technology choices, process boundaries, and invariants.
2. `docs/implementation-todo.md` for the ordered roadmap and current checkpoint.
3. `docs/audits/2026-07-16-complexity-reduction-and-agent-boundary.md` while Checkpoint 19.5 is pending, or when a task touches its frozen boundaries.

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
