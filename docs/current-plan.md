# WriteLLM Current Plan

Status: Phase 12 Checkpoint 49 is implemented and verified. Phase 11 remains complete and
verified. Checkpoint 26.9 remains paused and all GitHub Actions workflows are disabled.
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

Phase 12 is authorized as a use-and-fix phase with one explicitly agreed checkpoint at a time.
Checkpoint 48 is implemented under accepted ADR 038: the Agent composer now centers Add, truthful
approval policy, combined model plus effort, and Send; the same existing context and Writing Skill
actions are available through Add and a leading slash; and every existing Agent, proposal,
provider, persistence, and Renderer authority boundary remains unchanged. Electron tests/build,
three focused Real-Electron flows, visual inspection, scoped/full-code static checks, Impeccable,
and diff checks passed. Formal checkpoint closure remains pending only because the ordinary static
gate reports formatting in the user-owned concurrent `.vscode/settings.json` edit, which this work
did not rewrite. Detailed evidence lives in
[`implementation-todo/phase-12.md`](implementation-todo/phase-12.md). No later Phase 12 checkpoint,
migration, new Agent capability, hosted CI, commit, push, or publication is authorized. On
2026-08-13 the user additionally authorized one local no-identity macOS arm64 unpacked App build
from the current Checkpoint 48 worktree for hands-on use. That authorization does not include a
DMG, ZIP, signing, notarization, hosted CI, release, or promotion. The authorized build is complete:
the repository gate verified Electron 43.1.0 / ABI 148, arm64 `better-sqlite3` and `sqlite-vec`,
the ASAR/resource inventory, all 12 packaged smoke scenarios, and all 26 packaged E2E scenarios
with no flaky, skipped, or failed result. It produced only the no-Team-ID unpacked
`dist/macos-arm64/mac-arm64/WriteLLM.app` bundle.

Hands-on use of that App exposed a narrow-panel collision between the long approval trigger and
the model trigger. The user accepted ADR 039 and authorized a Checkpoint 48 refinement: use the
short `Manual`, `Section`, and `YOLO` approval labels without a shield icon, and make the model
trigger yield width without overlapping Send. The Renderer/documentation fix is complete: scoped
Biome, 11 focused Renderer tests, the 179-file / 915-test Electron gate and production build, one
fresh focused Real-Electron scenario with explicit non-overlap bounds, screenshot inspection, the
Impeccable detector, and `git diff --check` passed. It did not authorize or run another package or
release action.

The user then accepted ADR 040 and authorized one further Checkpoint 48 refinement: replace the
idle paper-plane-plus-text Send control with a primary circular upward-arrow button while keeping
its accessible `Send` name and leaving Queue/Steer/Stop unchanged. The Renderer/documentation fix
is complete: scoped Biome, 11 focused Renderer tests, the final clean 179-file / 915-test Electron
gate and production build, focused Real-Electron verification of shape/icon/accessibility plus
enabled and disabled screenshots, Impeccable, and diff checks passed. It did not authorize or run
another package or release action.

On 2026-08-13 the user explicitly authorized a fresh local no-identity macOS arm64 unpacked App
build containing the completed ADR 039/040 refinements, followed by one local commit of the Phase
12 Agent composer work and the already recorded application-icon assets. Push, tag, signing,
notarization, hosted CI, release, and promotion remain unauthorized. The rebuild completed with
Electron 43.1.0 / ABI 148, verified the arm64 native and ASAR/resource inventory, passed all 12
packaged smoke and 26 packaged E2E scenarios with no flaky, skipped, or failed result, and produced
the no-Team-ID `dist/macos-arm64/mac-arm64/WriteLLM.app`. The authorized local Phase 12 commit is
complete. It excludes the unrelated concurrent `.vscode/settings.json` and `section-editor.tsx`
edits; no push, tag, signing, notarization, hosted CI, release, or promotion was performed.

The 2026-08-13 application-icon redesign and Dock-contrast refinement are complete. The dark
textured artwork was replaced with a medium slate/cornflower-blue, warm-white, and cobalt
folded-paper mark; the macOS ICNS, Windows ICO, packaging PNG, and Linux runtime PNG were
regenerated from the same master. The routine macOS arm64 package gate verified the exact packaged
ICNS bytes, all 12 packaged smoke scenarios, and all 26 packaged E2E scenarios. The latest contrast
refinement produced an unpacked App only; no DMG, ZIP, signing, notarization, hosted CI, push,
release, or promotion was performed for it.

The 2026-08-13 local build-environment and packaging task is complete: the Linux/WSL toolchain is
documented, the Windows NSIS/AppX and Linux x64 targets run headlessly, and local builds are
verified on Windows, macOS (arm64 and x64), and Linux. No further product checkpoint, hosted CI,
or release action is currently authorized; the next step requires new explicit user approval.

Checkpoint 49 is complete under accepted ADR 041. The permanent running Queue/Steer footer has
become a bounded Main-authoritative multi-message waiting list with per-item Steer/Delete and one
Stop-or-Send terminal action. The worker mirrors the queue while placing only its head in Pi, and
an awaited consumption barrier persists the exact user message before the provider call. Pending
content remains request-scoped and clears with the run. `check:fast`, 179 Electron-hosted test
files / 922 tests plus the production build, the focused Real-Electron queue/provider-order
scenario, screenshot inspection, Impeccable, and diff checks passed. The pre-existing Writing Skill
picker popover interception exposed during its full E2E runs was subsequently fixed and is covered
by the final Checkpoint 50 full and packaged suites. No migration, dependency, worker role, durable
job, hosted CI, push, or publication work ran.
Detailed scope and evidence live in
[`implementation-todo/phase-12.md`](implementation-todo/phase-12.md#checkpoint-49-agent-pending-follow-up-queue).

On 2026-08-13 the user accepted ADR 042 and authorized Checkpoint 50 after hands-on Agent logs
showed repeated proposal preparation failures and asked that the review cover every model-visible
tool rather than only section editing. ADR 042 and the Phase 12 plan now define a provider-neutral
Pi-style contract, recovery, schema-compatibility, and presentation hardening for all 20 registered tools, with
targeted repairs for the evidenced section, outline, image, and Writing Skill failures plus the
approval-continuation scope gap. Checkpoint 49 was first closed and independently committed as
`45cb477`. Checkpoint 50 is complete: focused contract/unit coverage, `check:fast`, 179
Electron-hosted files / 931 tests with three skips plus production build, 39/39 unpacked E2E, and
27/27 packaged E2E all passed. The deterministic Brief-and-outline regression recorded zero
preflight failures and no unauthorized section mutation. At the user's direction, a live Gemini
request is not part of CP50 verification. The worktree still preserves the unrelated local settings
and section editor changes; CP50 remains uncommitted pending separate authorization.

On 2026-08-14 the user accepted ADR 043 and authorized one further refinement after hands-on use
showed the automatic approval modes still paused on routine edits. `manual` is unchanged; the
middle mode is presented as Write Auto and now applies every section, outline, and image proposal
without block or character limits while Brief and Writing Rules changes still pause; `yolo` keeps
its name and applies every proposal kind including Brief/Writing Rules changes. The persisted mode
values, CHECK constraints, run snapshots, and IPC contracts are unchanged, so no migration was
required. Focused policy and session tests passed. No commit, push, hosted CI, package, or release
action was authorized.

The same day the user accepted ADR 044 and authorized decoupling the approval mode from run state.
`setApprovalMode` no longer refuses changes during an active run or a pending review, and the
proposal auto-approve/review decision reads the session's current mode at proposal time instead of
the run-start snapshot; `agent_runs.approval_mode` remains as audit history only. The Renderer
approval picker stays enabled during runs and review pauses. Focused session and policy tests
passed, including mid-run and review-time mode changes. No migration, commit, push, hosted CI,
package, or release action was authorized.

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
- Phase 12 Checkpoint 48 decision: ADR 038 fixes the quieter Agent composer hierarchy without
  changing Agent authority, persistence, provider behavior, or run snapshots.

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
