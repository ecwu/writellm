# WriteLLM Current Plan

Status: Phase 15 Checkpoint 66 transient Notebook Knowledge chat is complete. Phase 14 Checkpoint
65 is the current incomplete checkpoint under its existing authorization. The newest
user-authorized candidate is `v0.2026.8.21`; Checkpoint 26.9 remains paused and all GitHub Actions
workflows are disabled.
Recorded: 2026-08-23

This file records only active delivery state. Long-lived system rules live in
[`architecture.md`](architecture.md) and the ADRs; detailed checkpoint evidence lives in the
matching Phase file under [`implementation-todo/`](implementation-todo/); completed chronology
lives in [`history/implementation-log.md`](history/implementation-log.md).

## Current state

- Phase 11 is complete under ADRs 021–037. Its full Checkpoint 29–47B roadmap and acceptance
  evidence live in [`implementation-todo/phase-11.md`](implementation-todo/phase-11.md).
- Phase 12 is an evidence-driven Use And Fix phase and is complete through Checkpoint 62. CP48–56
  refine the Agent composer, run flow, tool contracts, context recovery, checks, image relocation,
  compaction, usage visibility, and plan presentation. CP57–59 add the fixed image-provider
  catalog, Preview workspace, Vertex AI source, and the large-inline-image repair. CP60–61 make
  Writing Skills observable per-run tool activity with ordinary textual `$skill-name` mentions.
  CP62 reorganizes the flat Settings workspace and adds read-only Keyboard Shortcuts and About &
  Diagnostics peers. Detailed scope and evidence live in
  [`implementation-todo/phase-12.md`](implementation-todo/phase-12.md).
- Checkpoint 62 is complete. Settings remains the existing flat application-global Command
  workspace; General is reorganized, and peer Keyboard Shortcuts and About & Diagnostics surfaces
  expose existing commands and support information without new persistence, IPC, or project
  authority.
- Checkpoint 63 is complete. Agent work now uses bounded state-specific thinking motion and a
  short review-attention beam, while Brief, Outline, Writing Rules, section, and generated-image
  proposals share one kind-specific semantic presentation dispatcher in the timeline and Writing
  Task change set. Optional presentation remains derived review data and never mutation authority.
- Checkpoint 64 is complete. It refreshes the fixed Electron 43, BlockNote,
  PDF.js, Mermaid, database/query, provider, Renderer, and verification dependencies needed to
  remove current production advisories while preserving IPC, persistence, worker, and product
  authority boundaries under ADR 056.
- Checkpoint 66 is complete. Knowledge remains an independent management and exact-search
  workspace, while Notebook adds project-session-scoped selected-source chat with bounded
  retrieval, streamed source-only answers, validated per-message citations, and no durable chat
  content under ADR 058.

Checkpoint 61 passed focused shared/Main/Renderer/Real-Electron coverage, `check:fast`, the complete
Electron-hosted gate (187 files / 1043 tests with three intentional benchmark skips), the production
build, all 25 recovery fixtures from 23 sources, the fresh 41/41 Real-Electron suite, responsive UI
inspection, scoped Impeccable, and `git diff --check`.

Checkpoint 62 passed focused Renderer and Real-Electron coverage, `check:fast`, the complete
Electron-hosted gate (188 files / 1048 tests with three intentional benchmark skips), the
production build, the fresh 41/41 Real-Electron suite, desktop/narrow visual inspection, scoped
Impeccable, and `git diff --check`.

Checkpoint 63 passed 61 focused shared/Main/Renderer tests, `check:fast`, the complete
Electron-hosted gate (189 files / 1054 tests with three intentional benchmark skips), the
production build, and the fresh 41/41 Real-Electron suite. Full-width and 640 px runtime
screenshots, dependency and reduced-motion inspection, scoped Impeccable, frozen dependency
installation, and `git diff --check` also passed.

The separately authorized Checkpoint 63 hands-on macOS arm64 package gate passed from the current
dirty worktree. It verified Electron 43.1.0 / ABI 148, arm64 native modules, ASAR/resources, all
12 packaged smoke scenarios, and 28/28 packaged E2E scenarios, then produced the no-Team-ID App,
DMG, and ZIP under `dist/macos-arm64`. No candidate, commit, tag, push, hosted CI, Apple Developer
ID signing, notarization, release, promotion, or publication ran.

Checkpoint 64 passed frozen installation; production and complete audits with zero advisories;
58 focused tests across BlockNote persistence, canonical content, Mermaid, PDF, and Google
provider coverage; `check:fast`; the complete Electron-hosted gate (192 files / 1062 passing tests
with three intentional benchmark skips) and production build; all 25 recovery fixtures from 23
sources; and the fresh 42/42 Real-Electron suite. The no-identity macOS arm64 package gate then
verified Electron 43.4.1 / ABI 148, arm64 native modules, 53,145 ASAR entries, all 12 packaged
smoke scenarios, and 29/29 packaged E2E scenarios before structurally inspecting the local DMG and
ZIP. No candidate, release gate, commit, tag, push, hosted CI, Apple Developer ID signing,
notarization, promotion, or publication ran.

The separately authorized Checkpoint 64 hands-on macOS arm64 App build passed from the current
dirty worktree. The unpacked-only no-identity package gate rebuilt Electron 43.4.1 / ABI 148,
verified arm64 native modules and 53,145 ASAR entries, passed all 12 packaged smoke and 29/29
packaged E2E scenarios, and produced `dist/macos-arm64/mac-arm64/WriteLLM.app` for local use. It
did not produce a DMG or ZIP and did not create a candidate, commit, tag, push, hosted CI run,
Apple Developer ID signature, notarization, release, promotion, or publication.

The separately authorized Checkpoint 62 hands-on build passed the no-identity macOS arm64 package
gate from the current dirty worktree. It verified Electron 43.1.0 / ABI 148, arm64 native modules,
ASAR/resources, 12/12 packaged smoke scenarios, and 28/28 packaged E2E scenarios, then produced an
unpacked App, DMG, and ZIP under `dist/macos-arm64`. It did not create a candidate, commit, tag,
push, hosted CI run, Apple Developer ID signature, notarization, release, promotion, or
publication.

Checkpoint 66 passed focused shared, Main, worker, Renderer, and Real-Electron coverage;
`check:fast`; the complete Electron-hosted gate (198 files / 1097 passing tests with three
intentional benchmark skips) and production build; and the fresh 44/44 Real-Electron suite with no
flaky or skipped scenario. The verification also proved natural-language selected-source
retrieval, no-evidence model-call suppression, citation preview, page-switch recovery,
project-session cleanup, and the absence of questions, answers, evidence, external response IDs,
or content-derived fingerprints from project databases and diagnostics.

The separately authorized local `0.2026.8.20` candidate advanced release metadata, created the
clean local release commit and annotated `v0.2026.8.20` tag, and passed the no-identity macOS arm64
unpacked package gate. The gate verified Electron 43.1.0 / ABI 148, arm64 native modules,
ASAR/resources, 12/12 packaged smoke scenarios, and 28/28 packaged E2E scenarios. No DMG, ZIP,
push, hosted CI, Apple Developer ID signing, notarization, GitHub Release, promotion, or
publication ran.

The separately authorized `0.2026.8.21` candidate snapshots the current baseline, including the
completed Checkpoints 62–64 and 66 plus Checkpoint 65's explicitly incomplete current state. The
no-identity macOS arm64 unpacked package gate verified Electron 43.4.1 / ABI 148, arm64 native
modules, 53,287 ASAR entries, all 26 recovery fixtures from 24 sources, 12/12 packaged smoke
scenarios, and 31/31 packaged E2E scenarios, then produced
`dist/macos-arm64/mac-arm64/WriteLLM.app`. The clean candidate commit receives the annotated
`v0.2026.8.21` tag and is pushed with `main` under the user's explicit authorization. No DMG, ZIP,
hosted CI run, Apple Developer ID signing, notarization, GitHub Release, promotion, or publication
ran.

## Current authorized work

Checkpoint 65 returns as the current incomplete checkpoint under ADR 057 after the completed
Checkpoint 66 reprioritization. Its existing Phase 14 worktree changes remain preserved; no
Checkpoint 65 implementation or completion claim is part of the Checkpoint 66 delivery.
The one-time `v0.2026.8.21` candidate commit, tag, App build, and push are complete under the user's
explicit authorization. Further candidate/release actions, hosted CI, Apple Developer ID signing,
notarization, promotion, and publication remain unauthorized.

## Paused delivery gate

Checkpoint 26.9 remains paused. Its remaining host-install and dry-run promotion evidence is
recorded in
[`implementation-todo/phase-10.md`](implementation-todo/phase-10.md#checkpoint-26-cross-platform-ci-recovery-matrix-and-release-promotion).
No hosted CI, Apple Developer ID signing, notarization, push, GitHub Release creation, release
promotion, or publication may resume without fresh explicit user approval.

## Completed baseline

- Phases 0–9 and Checkpoints 23M/23V are complete.
- Phase 10 Checkpoints 24–26.8S are complete; only Checkpoint 26.9 remains paused.
- Checkpoints 27–28.x are complete under ADRs 012–020.
- Phase 11 is complete under ADRs 021–037.
- Phase 12 is implemented and verified through Checkpoint 62 under ADRs 038–044 and 046–055.
- Phase 13 Checkpoints 63–64 are implemented and verified; Checkpoint 64 is governed by ADR 056.
- Phase 14 Checkpoint 65 is partially implemented and current incomplete under ADR 057.
- Phase 15 Checkpoint 66 is implemented and verified under ADR 058.

The compact completion index is [`implementation-todo.md`](implementation-todo.md); historical
transitions and local candidate chronology are in
[`history/implementation-log.md`](history/implementation-log.md).

## Deferred

- Multiple simultaneously open projects or multiple primary manuscripts.
- External-edit synchronization and project-wide file watching.
- Multi-agent/subagent workflows, autonomous background writing, and long-term implicit memory.
- Generic plugins, executable Writing Skills, arbitrary filesystem/network/shell tools, and
  direct Agent writes.
- Realtime collaboration, Yjs, cloud sync, and alternative vector backends.
- DOCX and other non-LaTeX manuscript import formats.
- True image editing and provider-agnostic image plugins.
- Auto-updater, additional distribution targets, hosted CI restoration, signing, notarization,
  release promotion, and publication.
