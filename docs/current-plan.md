# WriteLLM Current Plan

Status: All Phase 11 checkpoints (29 through 47B) are complete and verified. Local packaging is
verified on Windows, macOS (arm64 and x64), and Linux. Checkpoint 26.9 remains paused and all
GitHub Actions workflows are disabled.
Recorded: 2026-08-13

This file describes only the active delivery state. Long-lived system rules belong in
[`architecture.md`](architecture.md) and the ADRs; detailed checkpoint evidence belongs in the
Phase files under [`implementation-todo/`](implementation-todo/); completed chronology belongs in
[`history/implementation-log.md`](history/implementation-log.md).

## Current state

Phase 11 is complete. The full post-Checkpoint-28 writing-experience roadmap — manuscript-wide
find and safe replacement (CP29/30), selection-based quick AI actions (CP31), deterministic and
grounded review with Writing Rules (CP32/45/33), writing-task identity and progress (CP34A/B),
cross-section change-set review and batch apply (CP35A/B), figure identity, asset workspace, and
image iteration (CP43A/42/43B), publication assembly plus DOCX/LaTeX/PDF/presets
(CP38/39/40/41A/41B), staged Markdown and LaTeX import (CP36/37A/37B), annotations, clone, and
project templates (CP44/46/47A/47B) — is implemented under ADRs 021–037. Detailed plans and
evidence live in [`implementation-todo/phase-11.md`](implementation-todo/phase-11.md).

Cumulative final evidence passed `check:fast`, the complete Electron-hosted gate (178 files / 904
tests) and production build, all 25 recovery fixtures from 23 sources, clean scoped Impeccable and
diff checks, and 38/38 fresh Real-Electron scenarios. The no-identity macOS arm64 package gate
verified Electron 43.1.0 / ABI 148, arm64 `better-sqlite3` and `sqlite-vec`, the ASAR/resource
inventory, 12/12 packaged smoke scenarios, and 26/26 packaged E2E scenarios, and produced the
0.2026.8.16 App, DMG, and ZIP.

Local packaging is additionally verified on Windows, macOS x64, and Linux through the added
per-target package commands (`package:windows-x64`, `package:windows-appx`, `package:macos-x64`,
`package:linux-x64`). A structured-lifecycle-logging pass over every Phase 11 module was committed
after the final verification, closing the remaining observability gaps and fixing one swallowed
asset-store race-recovery error.

Checkpoint 26.9 (hosted CI and release promotion) remains paused; its acceptance gate and
per-candidate audit are recorded in
[`implementation-todo/phase-10.md`](implementation-todo/phase-10.md#checkpoint-26-cross-platform-ci-recovery-matrix-and-release-promotion).
No hosted CI, signing, notarization, tag, or release promotion has run.

## Current authorized work

The 2026-08-13 local build-environment and packaging task is complete: the Linux/WSL toolchain is
documented, the Windows NSIS/AppX and Linux x64 targets run headlessly, and local builds are
verified on Windows, macOS (arm64 and x64), and Linux. No further product checkpoint, hosted CI,
or release action is currently authorized; the next step requires new explicit user approval.

## Completed baseline

- Checkpoint 24: Main-authoritative, deterministic whole-manuscript native and Markdown export,
  verified referenced assets, explicit Markdown loss reporting, atomic collision-safe publication,
  and path-bounded IPC.
- Checkpoint 25: four native-host package targets, fail-closed Electron ABI and architecture
  preparation, target-specific sqlite-vec resources, executable package inventory, deterministic
  artifact evidence, and source-independent packaged smoke coverage.
- Checkpoints 26.1–26.8: pinned least-privilege CI and promotion workflows, versioned recovery
  fixtures, packaged security and logging coverage, artifact governance, and fail-closed release
  verification.
- Checkpoint 26.8S: all eleven findings from the 2026-07-31 security scan were remediated and
  verified. [`ADR 011`](adrs/011-security-boundary-remediation.md) defines the accepted controls
  and residual risks.
- Checkpoints 27 and 28.x (Agent writing experience): multi-conversation concurrency, rolling
  context checkpoints and safe recovery, prompt architecture, Writing Skills, progress visibility,
  and configurable citation presentation under ADRs 012–020. Detailed evidence lives in
  [`implementation-todo.md`](implementation-todo.md#completed-agent-writing-experience-cp27-28).
- Phase 11 (Checkpoints 29–47B): the post-Checkpoint-28 writing-experience roadmap under ADRs
  021–037. See [`implementation-todo/phase-11.md`](implementation-todo/phase-11.md).

## Deferred

- Multiple simultaneously open projects or multiple primary manuscripts.
- External-edit synchronization and project-wide file watching.
- Multi-agent/subagent workflows, autonomous background writing, and long-term implicit memory.
- Generic plugins, executable Writing Skills, arbitrary filesystem/network/shell tools, and direct
  Agent writes.
- Realtime collaboration, Yjs, and cloud sync.
- Semantic manuscript indexing before measured search evidence requires it.
- DOCX and other non-LaTeX manuscript import formats.
- True image editing and provider-agnostic image plugins.
- Auto-updater, new distribution targets, hosted CI restoration, signing, notarization, and
  release promotion.
- Snap distribution, chain-of-thought display, reasoning summaries, persisted reasoning, Provider
  Pro modes, alternative vector backends, and model cost estimation.
