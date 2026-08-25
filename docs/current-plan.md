# WriteLLM Current Plan

Status: Phase 20 Checkpoint 71 Agent compaction and tool-loop recovery is complete under ADR 063. The
newest user-authorized local candidate is `v0.2026.8.25`; Checkpoint 26.9 remains paused and all
GitHub Actions workflows are disabled.
Recorded: 2026-08-25

This file records only active delivery state. Long-lived system rules live in
[`architecture.md`](architecture.md) and the ADRs; detailed checkpoint evidence lives in the
matching Phase file under [`implementation-todo/`](implementation-todo/); completed chronology
lives in [`history/implementation-log.md`](history/implementation-log.md).

## Current state

- Checkpoint 71 is complete. It replaces the fixed compaction event ceiling with bounded
  complete-run scanning, adds tool-loop finalization and continuation recovery, and preserves raw
  event authority without a migration.
- Checkpoint 70 is complete. It moves transient Notebook turns onto the shared Pi session runtime,
  adds selected-source-only Knowledge tool authority, and reuses Agent model/Thinking controls without
  persisting chat content or granting writing authority.
- Checkpoint 69 is complete. It adds a bounded Protocol v10 `ask_user` tool whose original Pi
  run waits for an exact user answer, plus a project-session-scoped answer IPC and an inline
  shadcn Questionnaire interaction. It adds no database table, event type, durable job, generic
  permission surface, or cross-restart active-run recovery.
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
- Checkpoint 65 is complete. BlockNote native inline Math now coexists with application-owned
  display Math and Mermaid through schema-v4 persistence, bounded atomic editing, Agent context,
  prose-operation isolation, import/export, and safe publication under ADR 057.
- Checkpoint 66 is complete. Knowledge remains an independent management and exact-search
  workspace, while Notebook adds project-session-scoped selected-source chat with bounded
  retrieval, streamed source-only answers, validated per-message citations, and no durable chat
  content under ADR 058.
- Checkpoint 67 is complete. A true first launch now opens a responsive, fully optional Welcome →
  Agent → Embedding → Reranking → MinerU → Create Project flow beneath the global Menubar. The
  versioned application-global step resumes after interruption, completed or upgraded installs do
  not reopen it, and provider configuration plus project creation continue through their existing
  authority boundaries under ADR 059.
- Checkpoint 68 is complete. It replaces application-owned display Math with BlockNote native
  `mathBlock`, moves the application-owned Mermaid block to a plain-content `diagram` contract,
  advances active section content to schema v5, and preserves application-owned Diagram metadata,
  safety, Agent, interchange, and publication semantics under ADR 060.
- Checkpoint 69 is complete. It adds exact Protocol v10 clarification contracts, Main-owned
  indefinite in-run waiting and answer authority, bounded compaction, trusted user-decision
  delivery, and an accessible inline shadcn Questionnaire without new durable schema or Renderer
  authority.

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

Checkpoint 65 passed frozen installation and zero-advisory production/full audits; 112 focused
contract, migration, editor, interchange, publication, Agent, and safety tests; `check:fast`; the
complete Electron-hosted gate (198 files / 1097 passing tests with three intentional benchmark
skips) and production build; all 26 recovery fixtures from 24 sources; and the complete 44/44
Real-Electron manifest on the fresh build. The default parallel E2E runner exposed two unrelated
one-off resource/startup races in different legacy scenarios; both passed immediately in focused
runs, and the unchanged full manifest passed serially with no flaky, skipped, or failed scenario.
No package/release action, hosted CI, commit, tag, push, signing, notarization, promotion, or
publication ran.

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

Checkpoint 67 passed 17 focused repository, IPC, and Renderer tests; `check:fast`; the complete
Electron-hosted gate (199 passing files / 1102 passing tests with three intentional benchmark
skips) and production build; and the fresh 45/45 Real-Electron manifest with no flaky, skipped, or
failed scenario. The dedicated scenario proved first-launch entry, optional provider steps,
interrupted-step resume, real project creation through the native folder boundary, completion
persistence, and restart suppression. Wide and 620 px runtime inspection, zero-overflow checks,
scoped Impeccable, and `git diff --check` also passed.

Checkpoint 68 passed frozen installation and zero-advisory production/full audits; focused
schema, migration, editor, Agent, interchange, publication, and safety coverage; `check`,
`check:fast`, the complete Electron-hosted gate (200 passing files / 1107 passing tests with three
intentional benchmark skips) and production build; all 27 recovery fixtures from 25 protected
sources; and the fresh 45/45 Real-Electron manifest with no flaky, skipped, or failed scenario.
Runtime verification covered native Inline/Block Math, application-owned plain-content Diagram,
source safety and recovery, metadata, dynamic theme rendering, sanitized isolated SVG, 620 px
layout, persistence, reopen, Agent contract v9, and Markdown export. No package/release action,
hosted CI, commit, tag, push, signing, notarization, promotion, or publication ran.

Checkpoint 69 passed exact frozen dependency installation; 168 focused shared, Worker, Main, IPC,
Renderer, and Questionnaire tests plus the explicit two-test prompt-budget baseline; scoped
Impeccable with no findings; `check:fast`; the complete Electron-hosted gate (200 passing files /
1118 passing tests with three intentional benchmark skips) and production build; and the fresh
46/46 Real-Electron manifest with no flaky, skipped, or failed scenario. The dedicated E2E proved
multi-step option and custom answers, same-run continuation, conversation attention, read-only
history after restart, and Stop interruption. No package/release action, hosted CI, commit, tag,
push, signing, notarization, promotion, or publication ran.

Checkpoint 70 passed 44 focused shared-contract, Worker, Main, IPC, prompt, and Notebook service
tests; `check:fast`; the complete Electron-hosted gate (200 passing files / 1123 passing tests with
three intentional benchmark skips) and production build; and the fresh 46/46 Real-Electron
manifest with no flaky, skipped, or failed scenario. Verification covered strict writing and
Notebook tool profiles, Worker/Main double authorization, multiple tool continuations, frozen
selected-source scope, citation registration and twelve-citation capping, transient model/Thinking
selection, source-epoch history cleanup, metadata-only requests without external response IDs, and
the real `search_knowledge` → `read_citations` → cited-answer flow without `temperature`. No
migration, dependency, package/release action, hosted CI, commit, tag, push, signing, notarization,
promotion, or publication ran.

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

The separately authorized local `0.2026.8.22` candidate snapshots the completed Checkpoints 67–68
on top of the existing baseline. Its no-identity macOS arm64 package gate verified Electron 43.4.1
/ ABI 148, arm64 native modules, 53,287 ASAR entries, all 27 recovery fixtures from 25 sources, all
12 packaged smoke scenarios, and 32/32 packaged E2E scenarios. It produced the unpacked App plus
the structurally verified `WriteLLM-0.2026.8.22-arm64.dmg` and
`WriteLLM-0.2026.8.22-arm64.zip` from the clean annotated `v0.2026.8.22` source commit. No push,
hosted CI run, Apple Developer ID signing, notarization, GitHub Release, promotion, or publication
ran.

The separately authorized local `0.2026.8.23` candidate snapshots the completed Checkpoint 69 on
top of the existing baseline. Its no-identity macOS arm64 unpacked package gate verified Electron
43.4.1 / ABI 148, arm64 native modules, 53,287 ASAR entries, all 27 recovery fixtures from 25
sources, all 12 packaged smoke scenarios, and 33/33 packaged E2E scenarios with no flaky, skipped,
or failed scenario. It produced `dist/macos-arm64/mac-arm64/WriteLLM.app` from the clean annotated
`v0.2026.8.23` source commit `ecfca0b`. No DMG, ZIP, push, hosted CI run, Apple Developer ID
signing, notarization, GitHub Release, promotion, or publication ran.

The separately authorized local `0.2026.8.24` candidate snapshots the completed Checkpoint 70 on
top of the existing baseline. Its no-identity macOS arm64 unpacked package gate verified Electron
43.4.1 / ABI 148, arm64 native modules, 53,287 ASAR entries, all 27 recovery fixtures from 25
sources, all 12 packaged smoke scenarios, and 33/33 packaged E2E scenarios with no flaky, skipped,
or failed scenario. It produced `dist/macos-arm64/mac-arm64/WriteLLM.app` from the clean annotated
`v0.2026.8.24` source commit `bc6227a`. No DMG, ZIP, hosted CI run, Apple Developer ID signing,
notarization, GitHub Release, promotion, or publication ran.

The separately authorized local `0.2026.8.25` candidate snapshots the completed Checkpoint 71 on
top of the existing baseline. Its no-identity macOS arm64 unpacked package gate verified Electron
43.4.1 / ABI 148, arm64 native modules, 53,287 ASAR entries, all 27 recovery fixtures from 25
sources, all 12 packaged smoke scenarios, and 33/33 packaged E2E scenarios with no flaky, skipped,
or failed scenario. It produced `dist/macos-arm64/mac-arm64/WriteLLM.app` from the clean annotated
`v0.2026.8.25` source commit `456e837`. No DMG, ZIP, hosted CI run, Apple Developer ID signing,
notarization, GitHub Release, promotion, or publication ran.

## Current authorized work

Checkpoint 71 Agent compaction and tool-loop recovery is complete under ADR 063. No follow-on
implementation or release work is authorized by that checkpoint.
BlockNote native Diagram, BlockNote XL publication,
ODT/email export, other new IPC or Agent tools, signing, notarization, and release work remain
outside the accepted checkpoint.

The `v0.2026.8.25` candidate commit, annotated tag, and no-identity macOS arm64 App build are
complete. Push of `main` plus the tag is the remaining authorized action. DMG/ZIP creation, hosted
CI, Apple Developer ID signing, notarization, GitHub Release, promotion, and publication remain
unauthorized.

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
- Phase 14 Checkpoint 65 is implemented and verified under ADR 057.
- Phase 15 Checkpoint 66 is implemented and verified under ADR 058.
- Phase 16 Checkpoint 67 is implemented and verified under ADR 059.
- Phase 17 Checkpoint 68 is implemented and verified under ADR 060.
- Phase 18 Checkpoint 69 is implemented and verified under ADR 061.
- Phase 19 Checkpoint 70 is implemented and verified under ADR 062.
- Phase 20 Checkpoint 71 is implemented and verified under ADR 063.

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
