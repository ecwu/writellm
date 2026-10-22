# WriteLLM Current Plan

Status: Release 0.2026.10.3 is published. The ADR 092 documentation evidence archive is pushed to `main`.
Recorded: 2026-10-22

This file owns current delivery state, acceptance gates, and platform gaps.
[Architecture](architecture.md) owns current system rules. [ADRs](adrs/) own decisions.
The [tracker](implementation-todo.md) links checkpoints. The [history log](history/implementation-log.md) owns past evidence.
Historical authorization records do not authorize new work.

## Current state

[Release 0.2026.10.3](https://github.com/ecwu/writellm/releases/tag/v0.2026.10.3) is published with four assets.
Tag `v0.2026.10.3` is fixed at `167026d`.
It includes the Issue 19 repairs ([ad0786e](https://github.com/ecwu/writellm/commit/ad0786e), [ADR 091](adrs/091-issue-19-endpoint-authority-and-compatibility.md))
and the Pi 1.3 dependency update ([0f8d964](https://github.com/ecwu/writellm/commit/0f8d964), [ADR 056](adrs/056-dependency-security-and-compatibility-refresh.md)).
Its [four-platform build](https://github.com/ecwu/writellm/actions/runs/39757488096) and [automatic publication](https://github.com/ecwu/writellm/actions/runs/39758438799) succeed on their first attempts.
Local macOS arm64 acceptance passes the full package gate with 45 packaged and 67 source interaction scenarios.
[Release evidence](history/implementation-log.md#2026-10-22-release-02026103-preparation) records the commands, artifacts, and limits.

The documentation evidence archive under [ADR 092](adrs/092-documentation-evidence-archive.md) is committed and pushed to `main`.
It summarizes long history-log entries and Phase evidence sections, with links to the full text at commit `493f02a`.
[Archive evidence](history/implementation-log.md#2026-10-22-documentation-evidence-archive) records sizes and link checks.

Completed checkpoints, issues, and releases are listed in the tracker and the history log.
Checkpoint 77 (Writing Task v2 and execution handoff) remains paused. [Phase 25](implementation-todo/phase-25.md) owns its planning record.

## Acceptance and platform gaps

Runtime acceptance covers macOS arm64 only.
Windows, Linux, and macOS x64 runtime acceptance for the current source remains outstanding.
Hosted tag builds produce and inspect packages on all four platforms but do not run the application.
Releases are unsigned, and macOS builds are not notarized. [Release policy](release-policy.md) owns publication rules.
[Phase 10](implementation-todo/phase-10.md#checkpoint-26-cross-platform-ci-recovery-matrix-and-release-promotion) retains the CI matrix decisions and outcome summary.

Known open defects:

- `workbench.tabs-docking-restore` fails intermittently at the native-menu Knowledge toggle.
  It also fails on unmodified `7b5e287`, so it predates the Pi 1.3 update. It needs a separate fix.
- The full dependency audit retains one moderate sprintf-js advisory with no published repair.
  Both audits retain one low KaTeX advisory, because rehype-katex requires the 0.16 series.

## Current authorized work

The user authorizes simplifying the documentation tree while keeping decision history.
This covers ADR 092, the history-log and Phase-file evidence summaries, the architecture condensation, and the matching guidance updates.
It also covers the one-line-per-ADR decision table in the ADR index, plus committing and pushing the result to `main`.

## Deferred

- Renderer decomposition carried from Issue 18, and general service test fixture consolidation (ADR 086).
- Separate dependency migrations under ADR 056: Electron 45, Vite 8 with plugin-react 6 and electron-vite 6, p-queue 10, BlockNote 0.56, Mermaid 12.2, KaTeX 0.19, `@types/node` 26, and Biome 2.6.
- Multiple active projects or primary manuscripts, realtime collaboration, and cloud sync.
- General external edit synchronization, directory scans, and project-wide watchers.
  ADR 070 permits one explicitly selected bibliography file only.
- Subagent product workflows, autonomous background writing, and implicit long-term memory.
- Generic plugins, executable Writing Skills, unrestricted Agent tools, and direct Agent writes.
- DOCX and other non-LaTeX import formats, true image editing, and generic image plugins.
- An updater, additional distribution targets, and signed distribution with notarization.
