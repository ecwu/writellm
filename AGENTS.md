# WriteLLM Agent Guide

This file is the entry point for agents working in this repository.

## Required Reading

Before changing code, read:

1. `docs/architecture.md` for fixed technology choices, process boundaries, and invariants.
2. `docs/implementation-todo.md` for the ordered roadmap and current checkpoint.

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

## Decision Changes

`docs/architecture.md` is the accepted baseline, not an informal suggestion. If implementation evidence requires a change:

1. Stop before introducing the conflicting choice.
2. Document the reason, alternatives, migration impact, and affected roadmap items.
3. Ask the user to approve the decision.
4. Update the architecture and todo documents before implementation.
