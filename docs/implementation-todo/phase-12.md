# Phase 12: Use And Fix

Status: Checkpoint 49 is complete and verified
Recorded: 2026-08-13

## Purpose

Phase 12 is an evidence-driven refinement phase after the complete Phase 11 feature roadmap. It
turns hands-on use into small, reviewable fixes and persists each material interaction decision
before implementation. It is not a pre-authorized feature backlog: one checkpoint is agreed,
implemented, and verified at a time, and later work requires fresh user direction.

## Operating Boundary

- Preserve the accepted local-first, Renderer-sandbox, proposal-review, project capability, and
  three-worker architecture.
- Prefer presentation and composition changes over new persistence or process boundaries.
- Record a new ADR before changing an accepted interaction decision; never rewrite completed ADRs
  to hide the change.
- Reuse official shadcn/ui `new-york` components and the established workspace shell.
- Keep provider, model, approval, and Writing Skill truth in their existing Main/project/app
  authorities; UI state must not become a second source of truth.
- Add no later checkpoint until concrete use evidence and explicit user approval define it.

## Checkpoint 48: Agent Composer Progressive Disclosure

Decision: accepted ADR 038.

### User outcome

The Agent composer is calmer and closer to the supplied Codex reference while continuing to state
WriteLLM's real, narrower authority. Approval policy is understandable, model plus effort is one
choice with a concise label such as `GPT 5.6 Sol xhigh`, and context/Writing Skill actions are
available from both Add and a leading slash.

### Scope

- [x] Document the Add/approval/model-effort/slash interaction and its authority limits in ADR
  038, including why ADR 016's always-visible control placement is amended.
- [x] Replace the two-row idle composer configuration with four top-level action groups: Add,
  approval, model plus effort, and Send.
- [x] Combine model and Thinking selection into one progressive popover; omit provider branding
  from the collapsed trigger but retain provider grouping where ambiguity matters.
- [x] Give approval choices accurate names and descriptions without implying arbitrary computer,
  filesystem, shell, or network access.
- [x] Apply ADR 039 after hands-on use: restore the compact `Manual`, `Section`, and `YOLO`
  approval labels, remove the shield icon, and prevent approval/model/Send overlap at narrow Agent
  panel widths.
- [x] Apply ADR 040 after hands-on use: replace the idle paper-plane-plus-text Send control with a
  primary circular upward-arrow button while preserving its accessible name and existing behavior.
- [x] Implement one shared Add/slash command catalog for context scope and Writing Skill, with
  keyboard navigation, IME-safe behavior, disabled states, and no hidden prompt mutation.
- [~] Add focused Renderer coverage, update affected Real-Electron expectations, run the smallest
  applicable static/Electron/UI/diff gates, and record exact evidence.

### Acceptance gate

The default idle composer has one visual row below the prompt and keeps Send dominant. A model with
reasoning displays the exact selected model name plus lower-case Thinking token; an unsupported
model exposes no fake effort choice. Model switching clamps through the existing Main authority.
Every approval label and description matches the current proposal policy. Add and `/` route to the
same context and Skill actions, Escape closes the slash menu, arrow/Enter selection works through
the shadcn Command primitive, and ordinary slash-containing prose is unaffected. Existing run,
queue/steer/stop, review, narrow-window, session-lock, and Details behavior remains intact.

The ADR 039 refinement additionally requires the collapsed and menu approval titles to read
`Manual`, `Section`, and `YOLO`; no approval icon is shown; descriptions remain behaviorally
accurate; and each footer control stays within its allocated box at the reported panel width.

The ADR 040 refinement requires the idle Send action to use an icon-only circular upward arrow,
retain the accessible name `Send` and all disabled states, and leave running-state Queue, Steer,
retry, and Stop controls unchanged.

This checkpoint adds no migration, IPC method, tool, model request, prompt, provider capability,
dependency, package/release work, hosted CI, commit, push, or publication action.

### Local evidence

Implementation and runtime verification are complete. Three focused Renderer files passed 13
tests. `pnpm check:electron` passed 179 test files / 915 tests with three opt-in benchmarks skipped,
then completed the production build. Fresh focused Real-Electron runs passed the grounded Agent
workflow, outdated-proposal refresh, and Thinking-level memory scenarios; they verified the
one-row composer, Add context routing, slash filtering and Enter selection, truthful approval
descriptions, model/effort summary, unsupported-effort state, and a persisted lower-case `high`
trigger label. Two bounded screenshot rounds covered the default composer plus slash, approval,
and model/effort popovers. The scoped Biome pass covered all seven changed TypeScript/E2E files,
the full 594-file Biome pass succeeded with JSON formatting disabled, the Impeccable detector
returned no findings, and `git diff --check` passed.

Formal checkpoint closure remains pending only because ordinary `pnpm check:fast` also formats the
user-owned concurrent `.vscode/settings.json` edit and reports its multiline `cSpell.words` array.
That unrelated file was intentionally preserved. TypeScript, all code formatting/lint rules, full
Electron tests/build, focused E2E, UI inspection, and diff checks passed; no package or release gate
is required for this Renderer-only checkpoint.

### Hands-on App build authorization

On 2026-08-13 the user explicitly authorized one local no-identity macOS arm64 unpacked App build
from the current Checkpoint 48 worktree. The build must use the repository package gate so the
bundle, native inventory, packaged runtime smoke, and packaged E2E are verified before handoff. It
does not authorize a DMG, ZIP, Apple identity discovery, signing, notarization, hosted CI, commit,
push, release, or promotion.

The authorized build completed at `2026-08-13T19:52:34.612Z` from the current dirty worktree at
revision `771b643b01247150f53ec1f592ff4abaa4f1acc4`. `pnpm build:unpack` verified Electron
43.1.0 / ABI 148, arm64 `better-sqlite3` 12.11.1 and `sqlite-vec` 0.1.9, 45,783 ASAR entries,
all 12 packaged smoke scenarios, and all 26 packaged E2E scenarios with zero flaky, skipped, or
failed results. The bundle reports version `0.2026.8` / build `2026.8.16`, has no Apple Team ID,
and is available at `dist/macos-arm64/mac-arm64/WriteLLM.app` (857 MB as reported by `du`). The
evidence ASAR SHA-256 is `597395e60d7aa3eec011a3b0cf43ee07b4c28ccb442a9a26f3255d345e0f93ad`.
No DMG, ZIP, signing identity discovery, notarization, hosted CI, commit, push, release, or
promotion was performed.

### ADR 039 refinement evidence

The hands-on approval shorthand and responsive-width refinement is complete. Scoped Biome passed
the two changed Agent components and affected E2E file. Two focused Renderer files passed 11
tests, and `pnpm check:electron` passed 179 test files / 915 tests with the same three opt-in
benchmarks skipped before completing the production build. A fresh focused Real-Electron Agent
workflow passed with zero flaky, skipped, or failed scenarios; it asserted `Manual`, `Section`, and
`YOLO`, one disclosure icon only, the three truthful descriptions, and non-overlapping approval,
model, and Send bounds in the default 480px panel. Screenshot inspection confirmed the compact
default row and approval menu. The Impeccable detector returned no findings and `git diff --check`
passed. No second App package, release, hosted CI, commit, or push was run.

### ADR 040 refinement evidence

The circular idle Send refinement is complete. Scoped Biome passed the changed Agent component
and E2E file, and the two focused Renderer files passed 11 tests. The first full Electron run
reported one unrelated 5-second timeout in the existing manuscript-export malformed-read-back
case while 914 tests passed; that exact case passed alone in 428 ms, and the complete rerun then
passed 179 test files / 915 tests with three opt-in benchmarks skipped before completing the
production build. Two fresh focused Real-Electron passes completed the grounded Agent workflow
with zero flaky, skipped, or failed scenarios. Runtime assertions verified the `Send` accessible
name and title, circular class, Lucide upward-arrow icon, empty visible label, enabled state, and
the existing non-overlap bounds. Screenshot inspection covered both disabled and enabled button
states in the default 480px panel. The Impeccable detector returned no findings and the final diff
check passed. Queue, Steer, retry, and Stop were unchanged; no second App package, release, hosted
CI, commit, or push was run.

### Final hands-on rebuild and commit authorization

On 2026-08-13 the user explicitly authorized a fresh no-identity macOS arm64 unpacked App build
containing the ADR 039/040 refinements, followed by one local commit of the Phase 12 Agent composer
work and the already recorded application-icon assets. The unrelated concurrent
`.vscode/settings.json` and `section-editor.tsx` edits remain outside that commit. Push, tag,
signing, notarization, hosted CI, release, and promotion remain unauthorized.

The final rebuild completed at `2026-08-13T20:25:44.828Z` from the current dirty worktree at
revision `771b643b01247150f53ec1f592ff4abaa4f1acc4`. `pnpm build:unpack` verified Electron
43.1.0 / ABI 148, arm64 `better-sqlite3` 12.11.1 and `sqlite-vec` 0.1.9, 45,783 ASAR entries, all
12 packaged smoke scenarios, and all 26 packaged E2E scenarios with zero flaky, skipped, or failed
results. The final bundle reports version `0.2026.8` / build `2026.8.16`, has no Apple Team ID,
and is available at `dist/macos-arm64/mac-arm64/WriteLLM.app` (865 MB as reported by `du`). The
final evidence ASAR SHA-256 is
`71d4df714ffe8ff279f9c79aa6cf22bcfc7b856591a3a050b8f0408e40cdfd1a`. No DMG, ZIP, signing
identity discovery, notarization, hosted CI, push, release, or promotion was performed.

The authorized local Phase 12 commit was then created with the scoped Agent composer, ADR/Phase
documentation, affected tests, and already recorded application-icon assets. The unrelated
concurrent `.vscode/settings.json` and `section-editor.tsx` edits remain uncommitted. No push, tag,
signing, notarization, hosted CI, release, or promotion was performed.

## Checkpoint 49: Agent Pending Follow-up Queue

Decision: accepted ADR 041; implementation authorized.

### User outcome

While an Agent run is active, ordinary Enter queues the draft into an addressable waiting list
above the composer. Authors can inspect multiple pending messages, delete one without affecting the
others, or promote any one to Steer. The footer uses one terminal position: Stop when the draft is
empty and the circular ArrowUp queue action when it is not.

### Scope

- [x] Record ADR 041 and amend the architecture before changing the accepted running-composer and
  queue boundary.
- [x] Add a bounded Main-owned pending queue, a worker mirror with one Pi Follow-up head, correlated
  delete/promote commands, and a persist-before-provider consumption barrier.
- [x] Project pending items through the activity snapshot and add capability-bound Preload IPC for
  per-item Steer and Delete.
- [x] Replace the running Queue disclosure with the Stop-or-Send action and a three-row-height,
  internally scrolling pending list above the composer.
- [x] Add focused contract, service, worker, Renderer, and Real-Electron coverage; run the
  applicable static, Electron, UI, and diff gates; record exact evidence.

### Acceptance gate

One active run accepts no more than 20 pending Follow-ups or 1 MiB of aggregate UTF-8 content.
Multiple items retain FIFO order; deleting the head, middle, or tail affects only that item;
Steering any item removes it from Follow-up order and injects it at the next available Steering
position. The worker never starts the corresponding provider call before Main durably appends the
consumed user message. Deleted and run-cancelled items never enter conversation history and their
pre-authorized model requests become aborted.

The running footer shows Stop for an empty draft and ArrowUp for a non-empty draft. Enter queues,
Cmd/Ctrl+Enter steers directly, and Shift+Enter inserts a newline. Queue success clears the draft;
failure preserves it. The pending list restores after panel or conversation switching, remains
usable at the narrowest supported Agent width, and disappears without leaving space when empty.
Stop, review pause, run failure, project close, worker termination, and relaunch clear the
request-scoped queue. No migration, dependency, worker role, background job, package, release,
hosted CI, push, or publication work is authorized.

### Local evidence

- `pnpm check:fast` passed the all-file Biome gate plus Node and Renderer typechecks.
- Focused contract, Main, IPC, model-client, worker, and Renderer runs passed; the final focused
  runtime rerun reported 3 files / 72 tests after model-request capability revocation was added.
- `pnpm check:electron` passed 179 test files / 922 tests with 3 opt-in benchmarks skipped, then
  completed the production Electron/Vite build. The expected non-fatal macOS
  `task_name_for_pid` diagnostics did not interrupt Vitest.
- The freshly built focused Real-Electron scenario passed 1/1. It queued two visible messages,
  deleted one, promoted the other, verified the promoted content reached the next provider request,
  and verified the deleted content did not. The same scenario passed in both preceding all-scenario
  attempts.
- Two full fresh E2E attempts reached 36/38 and 37/38. The only repeated failure, reproduced alone,
  is the pre-existing Writing Skill picker popover remaining open and intercepting the Agent details
  Close click; one independent mobile-sidebar fixture failed only on the first attempt and passed on
  the second. Neither path exercises pending messages or the changed runtime protocol.
- An original-resolution Agent-panel screenshot with two queued rows showed no overlap; the list,
  Steer/Delete actions, composer controls, and circular Stop remained contained. The Impeccable
  detector reported `[]`, and `git diff --check` passed.
- No database migration, dependency, package/release gate, App artifact, commit, push, tag, signing,
  notarization, hosted CI, publication, or promotion action ran.
