# WriteLLM Implementation Tracker

Status: Phase 19 Checkpoint 70 Notebook read-only Agent alignment is complete. Checkpoint 26.9 remains paused
and all GitHub Actions workflows are disabled.
Recorded: 2026-08-24

This is the short completion and routing index. Active delivery state lives in
[`current-plan.md`](current-plan.md); detailed plans and evidence live in the matching Phase file;
completed chronology lives in [`history/implementation-log.md`](history/implementation-log.md).

Status markers:

- `[ ]` not started
- `[~]` in progress
- `[x]` completed and verified
- `[!]` blocked or explicitly paused

## Active and paused work

- [x] Checkpoint 70: align transient Notebook with the shared Pi session runtime, selected-source
  read-only tools, and Agent model/Thinking controls under ADR 062.
- [x] Checkpoint 69: add Protocol v10 `ask_user`, Main-owned in-run waiting, exact answer IPC, and
  the inline shadcn Questionnaire experience under ADR 061.
- [x] Checkpoint 68: adopt native Block Math and converge application-owned Diagram on plain
  content, schema v5, and shared cross-system semantics under ADR 060.
- [x] Checkpoint 67: skippable first-run Agent, Embedding, Reranking, MinerU, and project-creation
  onboarding with versioned application-global progress.
- [x] Checkpoint 66: independent transient Notebook workspace with selected Knowledge sources,
  multi-turn source-only answers, validated citations, and project-session lifecycle cleanup.
- [x] Checkpoint 65: bounded native BlockNote inline mathematics with schema-v4 persistence,
  Agent semantics, prose-operation isolation, interchange, and safe publication.
- [!] Checkpoint 26.9: complete the remaining host-install and protected macOS dry-run promotion
  evidence. Work is paused, both GitHub Actions workflow definitions are disabled, and no hosted
  action may resume without fresh explicit user approval.

Authoritative detail:
[`implementation-todo/phase-10.md`](implementation-todo/phase-10.md#checkpoint-26-cross-platform-ci-recovery-matrix-and-release-promotion).

Checkpoint 63 detail: [`implementation-todo/phase-13.md`](implementation-todo/phase-13.md).

Checkpoint 65 detail: [`implementation-todo/phase-14.md`](implementation-todo/phase-14.md).

Checkpoint 66 detail: [`implementation-todo/phase-15.md`](implementation-todo/phase-15.md).

Checkpoint 67 detail: [`implementation-todo/phase-16.md`](implementation-todo/phase-16.md).

Checkpoint 68 detail: [`implementation-todo/phase-17.md`](implementation-todo/phase-17.md).

Checkpoint 69 detail: [`implementation-todo/phase-18.md`](implementation-todo/phase-18.md).

Checkpoint 70 detail: [`implementation-todo/phase-19.md`](implementation-todo/phase-19.md).

## Phase 19: Notebook Read-Only Agent Alignment

- [x] Checkpoint 70: reuse the Pi session runtime with selected-source-only Knowledge tools and
  transient model/Thinking selection.

Authoritative detail: [`implementation-todo/phase-19.md`](implementation-todo/phase-19.md).

## Phase 18: Agent User Clarification

- [x] Checkpoint 69: keep the original Agent run waiting for one bounded clarification tool call,
  authorize an exact answer, and resume the same Pi loop.

Authoritative detail: [`implementation-todo/phase-18.md`](implementation-todo/phase-18.md).

## Phase 17: Native Block Math And Diagram Experience Convergence

- [x] Checkpoint 68: register BlockNote native `mathBlock`, retain an application-owned
  plain-content `diagram`, and align schema-v5 persistence, Agent, interchange, and publication
  semantics under ADR 060.

Authoritative detail: [`implementation-todo/phase-17.md`](implementation-todo/phase-17.md).

## Phase 16: First-Run Onboarding

- [x] Checkpoint 67: add a responsive optional first-run flow that reuses the existing provider
  workspaces and Main-owned project creation boundary under ADR 059.

Authoritative detail: [`implementation-todo/phase-16.md`](implementation-todo/phase-16.md).

## Phase 15: Transient Notebook Knowledge Chat

- [x] Checkpoint 66: add a dedicated Notebook workspace and Main-owned, non-persistent Knowledge
  question-answering service under ADR 058 without changing the Knowledge management surface.

Authoritative detail: [`implementation-todo/phase-15.md`](implementation-todo/phase-15.md).

## Phase 14: Native Inline Mathematics

- [x] Checkpoint 65: introduce bounded native inline Math end to end without admitting native
  display Math, Diagram, collaboration, or BlockNote-owned persistence.

Authoritative detail: [`implementation-todo/phase-14.md`](implementation-todo/phase-14.md).

## Phase 13: Agent Review Experience

- [x] Checkpoint 63: bounded Agent status motion and semantic Proposal presentation while
  preserving typed mutation and approval authority.
- [x] Checkpoint 64: dependency security and compatibility refresh with production-audit,
  persisted-BlockNote, Electron/native, and packaged-runtime verification.

Authoritative detail: [`implementation-todo/phase-13.md`](implementation-todo/phase-13.md).

## Phase 12: Use And Fix

- [x] Checkpoint 48: Agent composer progressive disclosure, including ADR 039 approval shorthand
  and ADR 040 circular Send refinements.
- [x] Checkpoint 49: bounded Main-owned pending Follow-up queue under ADR 041.
- [x] Checkpoint 50: complete Agent tool-contract and recovery hardening under ADR 042.
- [x] ADR 043/044 refinements: Write Auto/YOLO semantics and live proposal-time approval reads.
- [x] Checkpoint 51: Pi active tool-loop context recovery under ADR 046.
- [x] Checkpoint 52: Knowledge citation coverage checks under ADR 047.
- [x] Checkpoint 53: safe existing-image cross-section relocation under ADR 048.
- [x] Checkpoint 54: harness-style writing context compaction under ADR 049.
- [x] Checkpoint 55: run-matched Agent context-usage indicator under ADR 050.
- [x] Checkpoint 56: bottom-docked Agent plan progress capsule.
- [x] Checkpoint 57: fixed Gemini/OpenAI/xAI image catalog under ADR 051.
- [x] Checkpoint 58: independent whole-manuscript Markdown Preview workspace.
- [x] Checkpoint 59: Vertex AI Nano Banana source and large-inline-image repair under ADR 052.
- [x] Checkpoint 60: observable per-run dynamic Writing Skills under ADR 054, superseding ADR 053's
  session-selection interaction.
- [x] Checkpoint 61: ordinary textual `$skill-name` mentions with Main-authorized visible loading
  under ADR 055.
- [x] Checkpoint 62: flat Settings reorganization and missing read-only support surfaces; no new
  ADR is required.

Authoritative detail: [`implementation-todo/phase-12.md`](implementation-todo/phase-12.md).

## Completed delivery milestones

- [x] Local no-identity candidate `v0.2026.8.23` for the completed Checkpoint 69 baseline; the
  annotated tag and verified unpacked macOS arm64 App remain local with no push or release.
- [x] Local no-identity candidate `v0.2026.8.22` for the completed Checkpoints 67–68 baseline;
  structurally verified macOS arm64 App, DMG, and ZIP with no push, Developer ID signing,
  notarization, or release.
- [x] Checkpoint 64 hands-on no-Team-ID macOS arm64 App build from the current dirty worktree; no
  DMG, ZIP, candidate, commit, tag, push, or release was created.
- [x] Checkpoint 63 hands-on no-Team-ID macOS arm64 App, DMG, and ZIP build from the current dirty
  worktree; no candidate, commit, tag, push, or release was created.
- [x] Checkpoint 62 hands-on no-identity macOS arm64 App build from the current dirty worktree; no
  candidate, commit, tag, or release was created.
- [x] Local no-identity candidate `v0.2026.8.17` for the completed Phase 11 baseline.
- [x] Local no-identity candidate `v0.2026.8.18` for CP58/59 and the large-image repair.
- [x] Local no-identity candidate `v0.2026.8.19` for CP60.
- [x] Local no-identity candidate `v0.2026.8.20` for CP61.
- [x] No-identity candidate `v0.2026.8.21` for the current CP62–66 snapshot; CP65 remains explicitly
  incomplete, and `main` plus the annotated tag are pushed under separate user authorization.

Exact verification and artifact boundaries are recorded in
[`history/implementation-log.md`](history/implementation-log.md).

## Completed baseline

- [x] Phases 0–9 and Checkpoints 23M/23V.
- [x] Phase 10 Checkpoints 24–26.8S; Checkpoint 26.9 is the sole paused remainder.
- [x] Checkpoints 27–28.x and related maintenance under ADRs 012–020. Detailed evidence:
  [`implementation-todo/phase-agent-writing.md`](implementation-todo/phase-agent-writing.md).
- [x] Phase 11 Checkpoints 29–47B under ADRs 021–037.
- [x] Phase 12 Checkpoints 48–62 under ADRs 038–044 and 046–055.
- [x] Phase 13 Checkpoints 63–64; Checkpoint 64 is governed by ADR 056.
- [x] Phase 14 Checkpoint 65 under ADR 057.
- [x] Phase 15 Checkpoint 66 under ADR 058.
- [x] Phase 16 Checkpoint 67 under ADR 059.
- [x] Phase 17 Checkpoint 68 under ADR 060.
- [x] Phase 18 Checkpoint 69 under ADR 061.
- [x] Phase 19 Checkpoint 70 under ADR 062.

## Plan and evidence routing

- [Phase 0](implementation-todo/phase-0.md)
- [Phase 1](implementation-todo/phase-1.md)
- [Phase 2](implementation-todo/phase-2.md)
- [Phase 3](implementation-todo/phase-3.md)
- [Phase 4](implementation-todo/phase-4.md)
- [Phase 5](implementation-todo/phase-5.md)
- [Phase 6](implementation-todo/phase-6.md)
- [Phase 7](implementation-todo/phase-7.md)
- [Phase 8](implementation-todo/phase-8.md)
- [Phase 9](implementation-todo/phase-9.md)
- [Phase 10](implementation-todo/phase-10.md)
- [Checkpoints 27–28](implementation-todo/phase-agent-writing.md)
- [Phase 11](implementation-todo/phase-11.md)
- [Phase 12](implementation-todo/phase-12.md)
- [Phase 13](implementation-todo/phase-13.md)
- [Phase 14](implementation-todo/phase-14.md)
- [Phase 15](implementation-todo/phase-15.md)
- [Phase 16](implementation-todo/phase-16.md)
- [Phase 17](implementation-todo/phase-17.md)
- [Phase 18](implementation-todo/phase-18.md)
- [Phase 19](implementation-todo/phase-19.md)
- [Implementation history](history/implementation-log.md)
