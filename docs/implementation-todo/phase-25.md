# Phase 25: Agent Interaction Modes

Status: Checkpoint 76 is complete under ADR 068. Checkpoint 77 is explicitly paused pending
separate authorization.
Recorded: 2026-08-30

## Checkpoint 76: Ask, Plan, And Write Authority Ceilings

- [x] Add the writing-only `ask`, `plan`, and `write` interaction-mode contract, migration 0039,
  session default, and immutable run snapshot.
- [x] Advance Agent Harness Protocol and tool contracts to v13 and carry the run mode through every
  initial and continuation authorization.
- [x] Compute the exact effective tool set from outer profile, mode ceiling, and active groups;
  enforce it independently in Worker and Main.
- [x] Add the application-owned mode prompt layer without changing provider behavior or prompt
  trust ordering.
- [x] Add the sticky composer selector beside Send, mode-specific placeholders, approval disabled
  state, and configured desktop composer behavior.
- [x] Verify migration, contracts, tools, prompts, run recovery, IPC, Renderer, and Electron flows.

Acceptance criteria: new and migrated writing conversations default to Write; users may select Ask,
Plan, or Write before each ordinary run; every live run retains its immutable mode across queued
messages and model continuations; Worker and Main reject tools outside the exact ceiling; Ask and
Plan cannot produce manuscript or Review Issue mutations; Notebook remains unchanged; the compact
selector and its disabled states remain keyboard accessible and contained in the desktop composer.

## Checkpoint 77: Detailed Writing Plans And Execution Handoff

- [!] Not authorized. Do not change Writing Task schema version 1, introduce detailed plan fields,
  add target reconciliation, or implement the Plan-to-Write task handoff during Checkpoint 76.

## Scope boundary

No dependency, new worker, generic permission framework, durable Agent job, direct manuscript
write, Writing Task v2, package/release action, commit, tag, push, hosted CI, signing,
notarization, promotion, or publication is authorized.

## Local evidence

- `pnpm --config.engine-strict=false check:fast` passed with pnpm 11.17.0 after the separately
  authorized package-manager pin alignment; the override is limited to the host's Node 26 versus
  the repository's unchanged Node 24 engine range.
- `node scripts/run-tests.mjs` passed 1,180 tests with three benchmark tests skipped.
- `npm run build` passed after the canonical Electron native-target check and both typechecks.
- `npm run test:e2e` passed all 47 Electron Playwright scenarios after a focused Protocol v13
  assertion update; the suite includes Ask → Plan → Write selector behavior in the desktop composer.
- Under separate post-checkpoint authorization, the recovery fixture manifest was refreshed for
  three intentionally changed Agent test sources and `pnpm --config.engine-strict=false
  check:package` passed: 31 recovery fixtures, 12 packaged smoke scenarios, 34 packaged Electron
  scenarios, and structurally verified unsigned arm64 DMG and ZIP artifacts.
- `git diff --check` passed. Signing, notarization, release, commit, tag, and push commands were not
  run.
