# WriteLLM Current Plan

Status: Release 0.2026.10.4 passes local package acceptance. Tag publication is pending.
Recorded: 2026-10-26

This file owns current delivery state, acceptance gates, and platform gaps.
[Architecture](architecture.md) owns current system rules. [ADRs](adrs/) own decisions.
The [tracker](implementation-todo.md) links checkpoints. The [history log](history/implementation-log.md) owns past evidence.
Historical authorization records do not authorize new work.

## Current state

Release 0.2026.10.4 includes the interface-label simplification ([d050d23](https://github.com/ecwu/writellm/commit/d050d23))
and the Agent new-conversation draft fix ([802a8b9](https://github.com/ecwu/writellm/commit/802a8b9)).
Local macOS arm64 acceptance passes the full package gate with twelve packaged runtime and 45 packaged interaction scenarios.
The four-platform tag build and automatic publication remain pending.
[Release preparation evidence](history/implementation-log.md#2026-10-26-release-02026104-preparation) records the commands, artifacts, and limits.

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

The interface now removes duplicate labels, normal-state badges, and repeated descriptions across the existing desktop views.
Risk notices, permission choices, privacy disclosures, and error recovery remain visible.
[Maintenance evidence](history/implementation-log.md#2026-10-24-interface-label-simplification) records the affected views and focused acceptance.

Completed checkpoints, issues, and releases are listed in the tracker and the history log.
Checkpoint 77 (Writing Task v2 and execution handoff) remains paused. [Phase 25](implementation-todo/phase-25.md) owns its planning record.

## Acceptance and platform gaps

Runtime acceptance covers macOS arm64 only.
Windows, Linux, and macOS x64 runtime acceptance for the current source remains outstanding.
Hosted tag builds produce and inspect packages on all four platforms but do not run the application.
Releases are unsigned, and macOS builds are not notarized. [Release policy](release-policy.md) owns publication rules.
[Phase 10](implementation-todo/phase-10.md#checkpoint-26-cross-platform-ci-recovery-matrix-and-release-promotion) retains the CI matrix decisions and outcome summary.

Known open defects:

- Source E2E `project.create-conflict-preserves-data` still waits for the launcher `Closed` label removed in `d050d23`.

- `workbench.tabs-docking-restore` fails intermittently at the native-menu Knowledge toggle.
  It also fails on unmodified `7b5e287`, so it predates the Pi 1.3 update. It needs a separate fix.
- The full dependency audit retains one moderate sprintf-js advisory with no published repair.
  Both audits retain one low KaTeX advisory, because rehype-katex requires the 0.16 series.

## Current authorized work

The user authorizes configurable image sources under [ADR 093](adrs/093-configurable-image-source-instances-and-models.md):
multiple source instances, OpenAI-compatible endpoints, built-in plus manual image models, a global default with a
per-conversation override, and migration of existing image configuration.
The implementation passes local macOS arm64 source acceptance and remains uncommitted.
[Evidence](history/implementation-log.md#2026-10-30-configurable-image-source-instances) records the gates and limits.

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
