# WriteLLM Current Plan

Status: The Issue 4 simplification sequence is complete. All sub-issues are closed.
Recorded: 2026-10-15

This file owns current delivery state, acceptance gates, and platform gaps.
[Architecture](architecture.md) owns current system rules. [ADRs](adrs/) own decisions.
The [tracker](implementation-todo.md) links checkpoints. The [history log](history/implementation-log.md) owns past evidence.
Historical authorization records do not authorize new work.

## Current state

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

The quick-action floating-menu scenario remains an open baseline UI failure.
It failed on the retained first-batch App and precedes Agent execution.
[Third-batch evidence](history/implementation-log.md#2026-10-14-third-batch-simplification) records the comparison and its platform limit.
This batch does not change that floating menu or claim acceptance for its scenario.

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

No implementation work is currently authorized. The Issue 4 sequence is complete.
`docs/audits/2026-10-10-dependency-size-audit.md` remains untracked and outside commits.
Follow-up candidates from the final review appear in the [error ownership review](history/implementation-log.md#claude-review-of-batch-five).
They require new user authorization.

## Deferred

- Multiple active projects or primary manuscripts, realtime collaboration, and cloud sync.
- General external edit synchronization, directory scans, and project-wide watchers.
  ADR 070 permits one explicitly selected bibliography file only.
- Subagent product workflows, autonomous background writing, and implicit long-term memory.
- Generic plugins, executable Writing Skills, unrestricted Agent tools, and direct Agent writes.
- DOCX and other non-LaTeX import formats, true image editing, and generic image plugins.
- An updater, additional distribution targets, and signed distribution with notarization.
  [Release policy](release-policy.md) owns unsigned publication rules.
