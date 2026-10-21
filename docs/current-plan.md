# WriteLLM Current Plan

Status: Issue 18 engineering maintenance and Issue 2 compatible dependency maintenance pass local macOS arm64 acceptance. Release 0.2026.10.2 is published.
Recorded: 2026-10-21

This file owns current delivery state, acceptance gates, and platform gaps.
[Architecture](architecture.md) owns current system rules. [ADRs](adrs/) own decisions.
The [tracker](implementation-todo.md) links checkpoints. The [history log](history/implementation-log.md) owns past evidence.
Historical authorization records do not authorize new work.

## Current state

Issue 18 maintenance improves error reporting, shared helpers, IPC declarations, section writes, service ownership, and repository hygiene.
[ADR 086](adrs/086-issue-18-engineering-quality.md) defines the maintenance boundaries.
The verified source includes the earlier dependency and DOCX maintenance.
The complete Electron suite passes 1,893 tests, with three optional benchmarks skipped.
The final logo correction passes five focused tests, including three new resolver regressions.
The final package gate passes all ten stages in 260.8 seconds with one App build.
It covers twelve runtime scenarios and all 45 packaged interaction scenarios.
The remaining 22 source-only scenarios pass, for 67 distinct interaction scenarios without automatic retries or skips.
The provider Settings scenario also passes against the packaged App.
The local App, DMG, and ZIP retain version 0.2026.10.2 and correspond to the verified combined runtime source.
[Issue 18 evidence](history/implementation-log.md#2026-10-21-issue-18-engineering-quality) records fixes, retained boundaries, prior failures, and verification.
Further ownership-based decomposition and general service test fixture consolidation remain deferred, non-blocking maintenance under ADR 086.

Issue 2 compatible maintenance updates 24 direct dependencies and repairs three transitive dependency advisories.
The final Electron suite passes 1,848 tests, with three optional benchmarks skipped.
Local macOS arm64 acceptance passes twelve packaged runtime scenarios and all 67 interaction scenarios.
The ten-stage package gate takes 278.2 seconds, with one App build and zero retries or skipped interaction scenarios.
The local App, DMG, and ZIP contain the verified maintenance changes and retain version 0.2026.10.2.
[Dependency maintenance evidence](history/implementation-log.md#2026-10-15-compatible-dependency-maintenance) records changes, failures, final results, and platform limits.

[Release 0.2026.10.2](https://github.com/ecwu/writellm/releases/tag/v0.2026.10.2) is published with four assets.
Its [four-platform build](https://github.com/ecwu/writellm/actions/runs/38716401683) completes successfully on its first attempt.
Tag `v0.2026.10.2` remains fixed at `d985a6a`.
[Release preparation evidence](history/implementation-log.md#2026-10-15-release-02026102-preparation) records the earlier immutable release artifacts.

The test-suite audit passes the complete local gate on macOS arm64.
All 67 source E2E scenarios and 1,845 Electron-hosted tests pass, with zero retries.
It fixes the quick-action menu, an outline lost-update race, and a streamed-answer duplicate.
It also restores accessible conversation status and adds behavior tests for previously untested modules.
[Test audit evidence](history/implementation-log.md#2026-10-15-test-suite-audit) records each change.

The two IPC logging follow-ups from the error ownership review are resolved.
Expected `ProjectSessionError` rejections now log at warn, with the original error.
Failure redaction no longer blanks UUIDs or request strings shorter than four characters.
[IPC logging evidence](history/implementation-log.md#2026-10-15-ipc-logging-follow-ups) records the change and verification.

The fourth simplification batch passes local acceptance and Claude review.
Issues 12, 13, and 14 are committed separately, pushed to `main`, and closed.
The starting source for this batch is `a04dc35`.
[Fourth-batch evidence](history/implementation-log.md#2026-10-14-fourth-batch-simplification) records implementation and review results.

Issue 15 consolidates current architecture rules and removes completed delivery narratives from this file.
Each removed evidence block retains its existing source or receives an appended history entry.
Issue 17 classifies error handling by process, logging owner, and recovery behavior.
Claude review accepts both issues. They are committed, pushed to `main`, and closed.
With them, every Issue 4 sub-issue is closed, and Issue 4 is closed.

Phase 33 Checkpoint 84 passes local acceptance under ADRs 078 and 079.
[Phase 33](implementation-todo/phase-33.md) contains comment implementation and acceptance evidence.
Checkpoint 77 remains paused. This batch does not start Writing Task v2 or its execution handoff.
[Phase 25](implementation-todo/phase-25.md) owns that checkpoint's planning evidence.
Completed checkpoints and feature delivery records remain in the tracker and their linked Phase files.

## Acceptance and platform gaps

Current simplification runtime evidence covers macOS arm64.
Windows, Linux, and macOS x64 runtime acceptance for subsequent simplification changes remains outstanding.
Past hosted builds do not establish runtime acceptance for the current source.
[Phase 10](implementation-todo/phase-10.md#checkpoint-26-cross-platform-ci-recovery-matrix-and-release-promotion) retains candidate platform results and CI failure boundaries.
[Release history](history/implementation-log.md#2026-10-02-release-02026101-preparation) retains the published 0.2026.10.1 artifact evidence.

The quick-action floating-menu failure is resolved by the test-suite audit.
Its scenario passes ten repeated runs and the complete E2E suite.

Issue 15 uses document diff, source traceability, formatting, and link consistency only.
Issue 17 uses affected Electron tests, packaged logging and Worker checks, and selected real Electron recovery scenarios.
Each verification report records counts, duration, retries, and platform limits.
Issue 15 passes document diff, source traceability, and guidance/link checks.
Issue 17 passes 384 distinct Electron tests across 43 files and fifteen selected packaged E2E scenarios.
The final macOS arm64 App passes six package smoke stages and all twelve runtime checks in 77.9s.
Earlier fixture failures and manual reruns remain in the evidence. Final accepted results record zero automatic retries or skips.
[Document evidence](history/implementation-log.md#2026-10-14-document-consolidation) lists removed blocks and retained sources.
[Error ownership evidence](history/implementation-log.md#2026-10-14-error-handling-ownership) lists every original site, feature batch, and verification report.

## Current authorized work

The authorized Issue 18 maintenance passes local acceptance for the combined source.
The changes retain existing security, data integrity, and provider capability boundaries.
The user authorizes committing and pushing the combined maintenance and updating and closing Issue 18.

The user authorizes all safe dependency updates after the 2026-10-15 Issue 2 review.
The compatible batch covers 24 direct dependencies and three transitive security repairs under ADR 056.
Frozen installation, both dependency audits, the complete Electron suite, and local packaged acceptance are complete.
The full audit retains one moderate sprintf-js advisory and one low KaTeX advisory.
The production audit retains only the low KaTeX advisory.
Vite 8, Pi 1.2, p-queue 10, BlockNote 0.56, Mermaid 12.2, and KaTeX remain separate migrations.

The requested local App build and release workflow trigger are complete.
The earlier four-platform tag build and automatic publication are complete.
The Issue 4 sequence is complete.
The error ownership review follow-ups are resolved. No follow-up candidate remains open.

## Deferred

- Multiple active projects or primary manuscripts, realtime collaboration, and cloud sync.
- General external edit synchronization, directory scans, and project-wide watchers.
  ADR 070 permits one explicitly selected bibliography file only.
- Subagent product workflows, autonomous background writing, and implicit long-term memory.
- Generic plugins, executable Writing Skills, unrestricted Agent tools, and direct Agent writes.
- DOCX and other non-LaTeX import formats, true image editing, and generic image plugins.
- An updater, additional distribution targets, and signed distribution with notarization.
  [Release policy](release-policy.md) owns unsigned publication rules.
