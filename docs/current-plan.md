# WriteLLM Current Plan

Status: Checkpoint 19.5 remediation complete; Checkpoints 19.6/19.7 are implementation-complete and their final verification gate passed on 2026-07-17; Checkpoint 20 is not started.
Recorded: 2026-07-17

## Objective

Close the gaps found by the 2026-07-16 source-level implementation audit of
Checkpoints 1–19. The audit confirmed the functional bodies match their records
(Electron-hosted Vitest passes 65 files/292 tests) and fixed its findings into
two new checkpoints in `docs/implementation-todo.md`:

- Checkpoint 19.6 wires documented-but-unimplemented product surfaces: six
  missing `recovery-required` exits plus recovery IPC/UI, the project snapshot
  operation's production entry point, production AsyncLocalStorage correlation,
  and background/agent worker log aggregation.
- Checkpoint 19.7 fixes code-level rule violations and hardening: a swallowed
  import error, renderer-asserted revision source classes, unlogged export IPC
  failures, the scheme-only external-URL check and dev CSP allowances, the
  write-side outline depth cap, worker-envelope session capabilities, worker
  abort propagation, `import`-class revision retention, checkpoint compaction,
  and the test backfill promised by earlier remediation records.

Documentation overclaims found by the audit were already corrected in place
(`docs/architecture.md`, Phase 2/6/7/8 files). Two small fixes were already
applied: recent-project pointers are physically pruned to five on upsert, and
the three superseded one-shot worker entry files were removed.

## Ordered work

1. Checkpoint 19.6 items 19.6.1–19.6.6 are implemented and verified.
2. Checkpoint 19.7 items 19.7.1–19.7.10 are implemented and verified, including the C2 E2E/packaged backfill and the shared project-name helper correction.
3. Ask the user whether to begin Checkpoint 20; it remains unstarted.

## Acceptance gate

The final gate was verified on 2026-07-17: every 19.6/19.7 item has
source-level evidence and focused tests; no new durable job types, worker roles,
or renderer capabilities were introduced; the local Biome check passed with
the existing shadcn `document.cookie` warning; Node/web TypeScript passed;
Electron-hosted Vitest passed 70 files/322 tests; the production
`electron-vite build` passed; the full Playwright Electron suite passed 11/11;
the unpacked packaged app and hybrid smoke passed; and runtime app.sqlite
verification captured application_id 1464615248, user_version 1, and a valid
schema_manifest row. The `pnpm` wrapper itself could not run because Corepack
rejected the pnpm 11 registry signature, so this record does not claim that
`pnpm check` or `pnpm test:e2e` executed successfully; their local equivalent
commands and the canonical Electron test runner passed. The user approved this
remediation window on 2026-07-16; both checkpoints are complete and Checkpoint
20 remains deferred.

## Deferred

- Agent runtime, Agent IPC, tool bridge, and proposal application remain
  Checkpoints 20–23.
- External editing synchronization and project-wide file watching remain
  deferred until a product requirement exists.
- LanceDB and other vector backends remain deferred until representative
  sqlite-vec measurements show a need.
- Client-side MinerU page-count enforcement and model cost estimation remain
  deferred; see the Deferred list in `docs/implementation-todo.md`.
