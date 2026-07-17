# Implementation History

Historical Checkpoint 1–19 verification and audit decisions remain in
`docs/implementation-todo.md` and the Phase files. This entry point records
the current transition into Checkpoint 19.5; new completion evidence belongs
here rather than extending superseded Phase designs.

## 2026-07-16

- Started Checkpoint 19.5 to converge Checkpoint 11–19 implementation with
  the accepted architecture amendment and complexity-reduction audit.
- Completed Checkpoint 19.5 convergence. The implementation now has ephemeral
  MinerU capabilities, seven durable job types, frozen Agent boundaries,
  classified revision retention, three worker roles, one atomic file writer,
  and 1536D 10k/50k/100k sqlite-vec benchmark evidence.
- Completed Checkpoint 19.5 audit remediation. Production artifact cleanup is
  durable and restart-recoverable; paused jobs migrate into the strict schema;
  direct Agent-parent revisions are retained; worker roles remain persistent;
  MinerU snapshot tests cover schema and values; and the real 1536D benchmark
  proves ten-file generation-build debounce with one persisted rebuild request.
  Electron-hosted Vitest passes 65 files/292 tests, the complete Electron E2E
  suite passes 9/9, the production build passes, Biome has only the existing
  shadcn sidebar cookie warning, and `git diff --check` passes. Checkpoint 20
  remains not started pending user approval.
- Completed a source-level implementation audit of Checkpoints 1–19 against the
  amended architecture. The functional bodies match their records. Gaps and
  rule violations are fixed into Checkpoints 19.6 (recovery exits, snapshot
  entry point, ALS correlation, worker log aggregation) and 19.7 (error
  swallowing, revision-source clamping, export logging, URL/CSP hardening,
  depth cap, worker session envelopes, abort propagation, retention, test
  backfill) in `docs/implementation-todo.md`; documentation overclaims were
  corrected in place, recent-project pointers are physically pruned to five,
  and the three superseded one-shot worker entry files were removed. Neither
  checkpoint has started; both require the user's approval, and Checkpoint 20
  remains deferred behind them.

## 2026-07-17

- Completed the approved Checkpoint 19.6/19.7 remediation and final gate. The
  C2 backfill covers the import progress/cancel/retry/delete/open/reveal flow,
  MinerU cancellation races, reverse and concurrent normalization completion,
  terminal parse failure, direct IndexClient stale/unmatched responses,
  parse/index activation races, and packaged provider-failure/stale-session
  scenarios. The current sidebar project assertion is shared by the writing
  workspace and project lifecycle E2E helpers.
- Added a post-build source-fingerprint recheck so a superseded index
  generation is never activated, and fixed the packaged smoke harness to
  create its project parent and wait for a real hybrid evidence hit instead of
  treating an earlier empty-index job as readiness.
- Final evidence: local Biome check (one existing shadcn cookie warning), Node
  and web TypeScript, Electron-hosted Vitest 70 files/322 tests, production
  `electron-vite build`, full Electron Playwright E2E 11/11, unpacked
  electron-builder packaging, packaged sqlite-vec/provider-fallback/stale-
  session smoke, and runtime app.sqlite inspection (application_id 1464615248,
  user_version 1, valid schema_manifest). The pnpm wrapper was unavailable
  because Corepack rejected the pnpm 11 registry signature; equivalent local
  commands passed. Checkpoint 20 remains not started.
