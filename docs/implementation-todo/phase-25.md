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

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-25.md#local-evidence).