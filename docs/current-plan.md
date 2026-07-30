# WriteLLM Current Plan

Status: Checkpoint 23Q settings workspace and model availability is complete; Checkpoint 24 remains unstarted.
Recorded: 2026-07-30

## Most recently completed checkpoint

Checkpoint 23Q implements ADR 009: a responsive Cherry Studio-style global Settings workspace,
application-global Agent provider/model availability, manual Agent models, editable custom
presets, and semantic appearance accents. It preserves Main-owned credentials, explicit model
refresh, immutable active runs, per-conversation selection, and every Checkpoint 24 boundary.

The completed workspace uses the official shadcn Command/Dialog/Field/Select/Switch/AlertDialog
surfaces with category/provider/detail drill-down at narrow widths. Agent provider and model
preferences remain application-global, manual models overlay discovered models without mutating
the remote cache, and both the Renderer and Main reject disabled or unauthenticated future
selections without changing active run snapshots.

The Checkpoint 23Q Provider-identity refinement packages a validated models.dev Provider-logo
snapshot as theme-adaptive local assets, with deterministic built-in/custom matching and an
optional custom override. Settings and the Agent picker use the same Renderer-safe logo
projection. The sidebar now uses one official shadcn Popover/Command that drills sequentially from
Provider to Model, retaining the existing conversation selection and Main resolution authority.
Logo synchronization is an explicit developer command; application runtime performs no models.dev
logo request and requires no CSP expansion.

Full Biome checked 374 files; Node/Renderer typechecks, the canonical Electron Vitest suite (104
files passed with one opt-in benchmark skipped; 512 tests passed), production build, and all 17
silent Electron Playwright scenarios passed. An isolated real-app `app.sqlite` reported
application ID 1464615248, user/schema version 3, integrity `ok`, no foreign-key failures, and both
new preference tables. The documented npm/direct equivalents were used because installed pnpm
11.11.0 does not match the repository's exact 11.17.0 pin; no pnpm-wrapper pass is claimed.

Provider-identity refinement evidence (2026-07-30): the explicit models.dev synchronization
accepted 149 validated Provider logos and committed their SHA-256 manifest; no runtime URL or CSP
exception was added. Full Biome checked 382 source files, Node/Renderer typechecks and production
build passed, and canonical Electron Vitest passed 105 files/517 tests with one opt-in benchmark
skipped. All 17 Electron Playwright scenarios passed, including Settings override/restart,
Renderer-safe catalog persistence, the single Provider-to-Model popover, search, back, narrow
layout, and keyboard selection. The no-identity package gate passed its macOS signature check,
packaged hybrid/vector search, provider-failure fallback, and stale-session smoke. `git diff
--check` passed. The documented npm/direct equivalents were used because installed pnpm 11.11.0
does not match the repository's exact 11.17.0 pin; no pnpm-wrapper pass is claimed.

Post-completion Provider-logo rendering correction (2026-07-30): Vite-inlined SVG data URLs
contain quote characters, so the original unquoted CSS `url(...)` value was rejected by Chromium
and exposed the foreground square beneath the missing mask. ProviderLogo now emits a quoted,
escaped CSS URL and an explicit block glyph. Missing or unresolved assets take the Avatar's
single-initial fallback without creating a mask layer. The focused Electron workflow asserts a
non-`none` computed mask for an inlined Together logo and an initial-only fallback for an unmatched
Provider; direct visual inspection shows the intended four-dot glyph. Biome, Node/Renderer
typechecks, production build, the focused provider E2E, and `git diff --check` pass.

Post-completion Agent Settings ordering refinement (2026-07-30): enabled Agent providers now
precede disabled providers in Settings while retaining the Main catalog's order inside each group.
Search, initial selection, and post-removal fallback use the same non-mutating derived order;
switching availability keeps the current Provider detail selected. Model ordering, Main catalog
order, shared contracts, persistence, and the Agent picker remain unchanged. Full Biome checked
384 files; the focused canonical Electron unit test passed 2 tests; Node/Renderer typechecks,
production build, the focused real Electron Provider workflow, and `git diff --check` passed. The
documented npm/direct equivalents were used because installed pnpm 11.11.0 does not match the
repository's exact 11.17.0 pin; no pnpm-wrapper pass is claimed.

Post-completion legacy Agent removal correction (2026-07-30): removing the migrated
`custom:legacy-agent` preset now atomically deletes both its catalog record and the retained
singleton `agent` migration source. Their encrypted credentials, model catalog, and availability
preferences cascade away, so the snapshot migration hook cannot recreate the explicitly removed
Provider. Initial upgrade migration still preserves the singleton source until removal, and no
Renderer, IPC, schema, project history, or Checkpoint 24 boundary changed. Full Biome checked 384
files; the focused canonical Electron catalog suite passed 5 tests; Node/Renderer typechecks and
canonical Electron Vitest passed 106 files/520 tests with one opt-in benchmark skipped; and `git
diff --check` passed. The documented npm/direct equivalents were used because installed pnpm
11.11.0 does not match the repository's exact 11.17.0 pin; no pnpm-wrapper pass is claimed.

Post-completion Settings-header correction (2026-07-30): the Settings close action now uses an
official shadcn Button/DialogClose composition inside each workspace header instead of the
Dialog's absolute overlay control. Agent Provider availability and close actions share one
centered layout row with separate click targets and an explicit gap; narrow Provider-list and
empty states retain an accessible close action. Full Biome checked 384 files; Node/Renderer
typechecks and the production build passed; the focused real Electron Provider workflow passed
with direct non-overlap, minimum-gap, and center-alignment assertions; and `git diff --check`
passed. The installed pnpm 11.9.0 does not match the repository's exact 11.17.0 pin, so documented
npm/local-binary equivalents were used and no pnpm-wrapper pass is claimed. Checkpoint 24 remains
unstarted.

Post-completion Agent OAuth bundle correction (2026-07-30): Pi's five Node-only OAuth
implementations are now registered statically before Electron Main exposes Provider login. The
production bundle no longer tries to resolve missing `out/main/anthropic.js`,
`github-copilot.js`, `openai-codex.js`, `radius.js`, or `xai.js` files at login time. A focused
canonical Electron test exercises the real xAI device-code flow, and the built Provider E2E proves
OpenAI Codex reaches its login-method prompt instead of immediately closing with
`ERR_MODULE_NOT_FOUND`. Exact pnpm 11.17.0 `check:fast` passed; canonical Electron Vitest passed
106 files/521 tests with one opt-in benchmark skipped; production build and all 17 Electron
Playwright scenarios passed. The no-identity package gate verified the macOS app has no Team ID
and passed packaged hybrid/vector, Provider-failure fallback, and stale-session smoke.
`git diff --check` passed. The first sandboxed package attempt could not resolve GitHub; the same
gate passed outside the restricted network sandbox. Provider credentials, IPC, system-browser
authorization, worker roles, and Checkpoint 24 remain unchanged.

Post-completion global error-notification correction (2026-07-30): transient Renderer action
failures now use one application-root shadcn Sonner toaster instead of an Alert mounted above the
editor. Error toasts stay at the bottom right for eight seconds, expose a close action and
Notifications live-region label, show at most three entries, follow the resolved application
theme, and reuse a message-derived ID so repeated failures update one entry. The toaster is a
Radix dismissable-layer branch so it remains interactive above Settings without dismissing the
modal. Persistent Settings/workspace/recovery/Agent Alerts, editor save errors, provider results,
credential warnings, and field validation remain local; Agent failures with a local error surface
no longer emit a duplicate toast. No Main, IPC, database, shared-contract, or Checkpoint 24
boundary changed. Exact pnpm 11.17.0 `check:fast` passed; canonical Electron Vitest passed 107
files/523 tests with one opt-in benchmark skipped; production build, the focused seven-scenario
project/provider workflow, all 17 Electron Playwright scenarios, and `git diff --check` passed.

## Prior completed checkpoint

Checkpoint 23P implemented ADR 008: an application-global Pi provider/preset catalog, encrypted Pi
credentials, explicit cached model discovery, per-conversation Agent model selection, and
run-snapshotted multi-protocol dispatch. Checkpoint 24 remains unstarted and requires separate user
approval.

The completed surface includes Pi built-in providers and their API-key, ambient, and OAuth flows;
bounded custom endpoint presets for the six approved transports; explicit last-successful model
catalog refresh; legacy singleton migration; idle-only model switching in the Agent sidebar; and
immutable provider/model/API labels on each run. Pi's ESM-only runtime is bundled into the Electron
Main/worker production output while native dependencies remain external.

## Next checkpoint

The Phase 10 plan was re-audited against the current source, packaging configuration, tests, ADR
006/007, and the completed verification-gate split. Checkpoint 24 now owns only the remaining
whole-manuscript export and portability-completion work: a Main-authoritative versioned native
export, deterministic Markdown with explicit loss reporting, referenced-asset packaging,
collision-safe UX, and moved/restored/no-index end-to-end evidence.

Snapshot v2 create/restore, project-history transport, conflict-safe snapshot publication,
moved-root open, and durable missing-index rebuild scheduling are completed baselines and will be
reused rather than reimplemented. Clone/Save As remains deferred because it requires a new
`projectId`.

Checkpoint 25 is realigned around reproducible target-native packaging and removal of source-tree
fallbacks from the existing package gate. Checkpoint 26 remains the cross-platform CI and protected
release-promotion checkpoint; the repository currently has no GitHub Actions workflow. The full
updated scope and gates are recorded in
[`docs/implementation-todo/phase-10.md`](implementation-todo/phase-10.md).

## Completed maintenance

The Outline editor workspace refinement is complete. The former current-section Sheet is now a
responsive large Dialog with a complete accessible tree, a desktop inspector and narrow-screen
drill-in flow, manual metadata/status editing, explicit hierarchy controls, guarded
creation/deletion, serial outline-version writes, and draft-preserving metadata conflict
recovery. Selecting a tree row no longer changes the manuscript editor until Open in editor is
used; the sidebar is read-only, and current-section import/export actions now live beside the
editor title. The existing IPC contracts, persistence model, renderer authority, and Checkpoint
24 boundary are unchanged.

Exact pnpm 11.17.0 `check:fast` passed; canonical Electron Vitest passed 108 files and 535 tests
with one opt-in benchmark file/test skipped; the production build and all 18 Electron Playwright
scenarios passed; and `git diff --check` passed.

Large-Knowledge project loading completed under ADR 010. The authoritative project database and
manuscript remain the blocking open gate, while the rebuildable index now initializes behind
explicit background readiness with clean-shutdown fast reopen and bounded generation/orphan
cleanup. The Knowledge workspace uses a lightweight lifecycle/count summary and loads full
normalized artifacts only for the selected source.

On an isolated SQLite-online-backup copy of the reported 29-source, 1.0 GiB, 19-generation
project, Manuscript became visible in 260 ms while conservative background index validation
completed in 22,348 ms. After clean close, Manuscript became visible in 201 ms and index
initialization completed in 171 ms. Cleanup retained one active plus three inactive generations
and one vector root table; `integrity_check` passed. Exact pnpm 11.17.0 `check:fast`, canonical
Electron Vitest (107 files/531 tests, one opt-in benchmark skipped), production build, all 17
Electron Playwright scenarios, and the no-identity packaged hybrid/vector, Provider-fallback, and
stale-session smoke passed. The original project was not modified, no `VACUUM` was run, and
Checkpoint 24 remains unstarted.

## Prior completed checkpoint

Checkpoint 23V added application-managed, project-local Git history. ADR 007 fixes an exact-pinned
`isomorphic-git` boundary, a bare `.writellm/history.git` repository with one linear `main`
history, user-created checkpoints, exact current-state comparison, crash-safe restore, and
Snapshot v2 transport of the repository. Autosave revisions remain independent and never create
commits. New projects receive an initial checkpoint; existing projects opt in. History damage does
not block project opening or editing.

The final gate passed exact pnpm 11.17.0 `check:fast`, canonical Electron Vitest (103 files and 504
tests, with the opt-in benchmark skipped), production build, all 17 Electron E2E scenarios, the
no-identity package gate and packaged hybrid smoke, and `git diff --check`. The opt-in
Electron-runtime benchmark completed 100 checkpoints with one unchanged 1 MiB knowledge file and
a growing database without GC: cumulative elapsed time was 237/1,001/1,954 ms and repository size
was 12,117/55,447/111,855 bytes at 10/50/100 checkpoints.

## Previous completed checkpoint

Checkpoint 23M added project-local BlockNote images, source-backed Mermaid and display-math blocks,
manual asset upload, and one bounded Gemini `generate_image` Agent tool. ADR 006 preserves the
proposal/revision, renderer sandbox, provider credential, worker-role, and request-scoped network
boundaries while extending the editor content schema, provider registry, and Agent tool contract.
Whole-manuscript export and the remaining Checkpoint 24 portability work stay unstarted.

## Completed scope

Phase 9 is complete. WriteLLM now has project-local durable Agent sessions, request-scoped runs, ordered events, four bounded read tools, three typed proposal tools, stale-safe approval/application, section-revision undo, and a production writing panel. The renderer receives only validated preload APIs and session-authorized replay/live events; ephemeral deltas never replace durable terminal truth, and current proposal state comes from `mutation_proposals`.

The panel supports session selection, streaming, generic activity without chain-of-thought, stop, retry/continue as new immutable runs, steering/follow-up, selection/section/project context snapshots, provider/model and usage/retry state, grouped expandable bounded tool activity, citation attachments, standalone proposal diffs, and approve/reject/undo. Accepted section edits carry model request, Agent run, tool call, proposal, revision, and cited-source lineage.

Context handling uses a deterministic token estimate with CJK/adversarial coverage and a non-throwing whole-turn transform. When real historical pressure would omit a complete turn, Main can create at most one bounded raw-event summary per session through `ModelExecutionService`; the recorded `compaction_summary` is ordinary context data, while the full event history remains authoritative. Provider reasoning controls and multi-level compaction remain deferred.

## Acceptance evidence

Checkpoint 23M passed its final gate on 2026-07-22:

- Content schema v2, migration 0022, v1 compatibility readers, project-local asset publication and
  revision references, capability-bound preview, rich Markdown conversion, Mermaid/KaTeX blocks,
  the Gemini image role/gateway, and Agent Tool Contract v3 are implemented and covered.
- Local Biome checked 347 files with only the existing generated shadcn `document.cookie` warning;
  Node and Renderer typechecks and the production build passed.
- The canonical Electron-hosted Vitest suite passed 99 files and 470 tests, including project
  migration/integrity, image signature/dimension/hash/cleanup, capability revocation, Mermaid/KaTeX
  safety, Gemini response/cancel/timeout validation, and generated-image proposal conflict reuse.
- All 14 built-app Electron Playwright scenarios passed. The new scenario covers manual image
  upload, Mermaid and block LaTeX render/save/reopen, relative-asset Markdown export, and asset
  display after project reopen.
- The signed macOS arm64 unpacked application passed strict deep signature validation. Packaged
  hybrid smoke passed native search, provider-failure fallback, and stale-session scenarios.
- `git diff --check` passed. The installed Biome binary and documented npm/direct test equivalents
  were used because the local pnpm wrapper could not verify its registry signature offline.

Post-completion image-preview correction (2026-07-23): a Vite development run exposed two
BlockNote integration conditions hidden by the production-protocol E2E. The native image renderer
calls `resolveFileUrl` while a newly inserted block still has an empty URL, and an HTTP development
origin does not include `writellm://bundle` in CSP `'self'`. Empty placeholders now resolve without
issuing a capability, arbitrary non-project sources remain rejected, and the renderer CSP
explicitly admits the session-bound application preview source. Focused Biome, Node/Renderer
typechecks, the production build, canonical Electron Vitest (101 files/474 tests), all 14 Electron
Playwright scenarios including image upload/reopen, isolated real-app SQLite
identity/integrity/schema verification, and `git diff --check` passed. The generated-image
application regression also asserts that Gemini proposals persist the exact
`writellm-asset:<assetId>` logical URL and therefore share this corrected renderer path.

Post-completion Gemini diagnostics correction (2026-07-23): runtime logs proved that four
`generate_image` calls reached Gemini Interactions and received HTTP 400 in 95–180 ms regardless of
prompt length or requested size. That maintenance preserved bounded machine diagnostics such as
`API_KEY_INVALID` or `INVALID_ARGUMENT` while excluding response messages and private content, but
its request-shape conclusion was later superseded by the Interactions correction below. Agent tool
results still classify non-retryable image-provider rejection as `unavailable / ask_user` instead
of the incorrect `internal / Agent read tool failed`.

Official Gemini SDK transport maintenance completed (2026-07-23): after subsequent real requests
still received HTTP 400, the user approved replacing the handwritten request transport with
exact-pinned `@google/genai@2.12.0`. The default request now matches Google's minimal
`interactions.create({ model, input })` example; non-default aspect ratio/size uses the SDK's typed
format with top-level PNG MIME instead of the old nested field. Legacy `/v1beta` provider
URLs are normalized for the SDK, SDK retries are disabled, `output_image` is validated, and the
existing outer cancellation/timeout boundary remains authoritative. ADR 006 keeps the SDK inside
the existing background-worker gateway and preserves every Agent, credential, proposal, and asset
boundary. Canonical Electron Vitest passed 101 files/477 tests; Node/Renderer typechecks,
production build, full Biome (only the existing shadcn warning), isolated runtime SQLite checks,
all 14 Electron Playwright scenarios, and `git diff --check` passed.

Verification-environment maintenance completed (2026-07-23): the repository pnpm pin now matches
the installed 11.11.0 CLI, preventing pnpm's automatic version switch from silently waiting on
blocked registry access before every command. The canonical Electron Vitest runner forwards
focused file/name arguments, and `AGENTS.md` records direct-tool fallbacks plus the exact macOS
Codex sandbox signatures that require Electron Playwright to run outside the sandbox after a fresh
build. The Gemini image deadline now settles independently of SDK transport abort propagation
while continuing to pass the cancellation signal into the exact-pinned SDK. The final gate passed
pnpm 11.11.0 startup, full-repository Biome with only the existing generated shadcn warning,
Node/Renderer typechecks and production build, canonical Electron Vitest (101 files/477 tests),
all 14 Electron Playwright scenarios outside the sandbox, isolated real-app SQLite
identity/integrity/schema verification, and `git diff --check`.

Verification-gate split completed (2026-07-23): `check:fast`, `check:electron`, `check:e2e`,
`check:package`, and `check:release` now expose the audit's intended verification layers. Routine
development never enters the release gate. The package gate sets
`CSC_IDENTITY_AUTO_DISCOVERY=false`, accepts only an unsigned or no-Team-ID ad-hoc/linker macOS
signature, and retains packaged native/runtime smoke; the opt-in release gate alone permits a
configured Apple identity and runs strict deep signature validation. Notarization remains
disabled. Full Biome and Node/Renderer typechecks passed, and the real no-identity package
gate confirmed electron-builder skipped macOS application signing before packaged native search,
provider-failure fallback, and stale-session smoke passed.

Fixed Gemini configuration maintenance completed (2026-07-23): after the official SDK transport
still returned HTTP 400, the user requested removal of the image provider's editable endpoint.
The renderer now exposes only an encrypted API-key input and a four-model Select; shared/Main
validation rejects every other model and endpoint while normalizing the legacy official `/v1beta`
value. The worker constructs `GoogleGenAI` with only the request credential, generation sends only
`model` and `input`, and the connection probe uses the official SDK `models.get`. Full Biome passed
351 files with only the existing generated shadcn warning; Node/Renderer typechecks, production
build, canonical Electron Vitest (101 files/480 tests), all 14 built Electron Playwright scenarios,
isolated runtime SQLite identity/integrity/schema verification, and `git diff --check` passed.
Agent authority and Checkpoint 24 remain unchanged.

Gemini Interactions image-contract correction completed with one outstanding live gate
(2026-07-23): the implementation exact-pins `@google/genai@2.13.0`, always sends the documented
`response_format: { type: "image", mime_type: "image/jpeg", ... }` (the Interactions API rejects
`image/png` with HTTP 400; only `image/jpeg` is supported), omits only `auto`
`aspect_ratio`, and records requested versus effective size when Flash Lite or 2.5 Image normalize
2K to 1K. PNG and JPEG are accepted only after Main validates their matching magic and dimensions,
then atomically published under `manuscript/assets/` and referenced through
`writellm-asset:<assetId>`. Current Gemini configuration no longer contains `baseUrl`; readers
strip the legacy official marker so the next save removes it. The SDK's default server-side
`store=true` remains unchanged, and the original SDK error is retained as a local cause before only
safe status/code fields cross the worker boundary. The focused contract suite, full Biome,
Node/Renderer build, canonical Electron Vitest (101 files/485 tests), all 14 Electron Playwright
scenarios outside the sandbox, unpacked signed application build, and isolated runtime SQLite
identity/integrity/schema checks passed. The one authorized real 1:1/1K request reached Gemini but
ended in the safe auxiliary-provider failure path before an asset was published; no second billable
request was made, so successful live asset/block publication remains unclaimed.

Checkpoint 23 passed its final gate on 2026-07-21:

- Local Biome checked 312 files with only the existing generated shadcn `document.cookie` warning.
- Node and renderer TypeScript passed.
- The canonical Electron-hosted Vitest suite passed 91 files and 402 tests.
- The production build emitted the Agent worker; the signed macOS arm64 unpacked application passed strict signature inspection.
- Electron Playwright passed all 12 scenarios. The new full workflow covers project/brief/outline/section creation, PDF import, MinerU normalization, indexing, real Pi search and proposal tool calls against loopback providers, citations, preview, approval, editor reload, full lineage, panel/project reopen, undo, streamed cancellation, and durable interrupted-state replay.
- Packaged hybrid smoke passed native search, provider-failure fallback, and stale-session scenarios. The packaged asar contains `out/main/agent-worker.js`; arm64 `better_sqlite3.node` and `vec0.dylib` are present and run under Electron ABI 148.
- An isolated real application launch produced `app.sqlite` with application ID 1464615248, user/schema version 1, `integrity_check=ok`, no foreign-key failures, and a valid schema manifest row.
- `git diff --check` passed.

Post-completion field correction (2026-07-21): a DeepSeek V4 Flash run exposed two Checkpoint 23 integration defects. Runtime logs showed that the approved Brief proposal was durably applied but the renderer kept its cached workspace, while `propose_outline_patch` failed with `stale_base` because the Agent context did not expose the authoritative outline version. The correction now includes `outlineVersion` in the bounded writing context, directs proposal tools to use the returned Brief/Outline versions and refresh once on conflict, maps stale proposal bases to a retryable `conflict` instead of a generic internal failure, and refreshes the manuscript workspace after approve/undo. The canonical Electron Vitest suite passed 91 files/403 tests; production build and Node/web typecheck passed; local Biome passed 312 files with the existing generated shadcn cookie warning; and all 12 Electron Playwright scenarios passed. The expanded Agent E2E verifies the version in the provider request and immediate Brief/Outline UI refresh after approval.

Post-completion presentation refinement (2026-07-21): Agent `search_knowledge`/`read_citations` cards now show validated knowledge-source titles and one-based pages instead of opaque citation hashes, while keeping citation IDs as metadata and backward-compatible fallbacks. Persisted and streaming assistant messages render GFM Markdown through the existing React Markdown stack with raw HTML removed, remote images suppressed, and links restricted to the application external-URL allowlist. Canonical Electron Vitest passed 92 files/407 tests; production build, Node/web typecheck, 12/12 Electron Playwright, a focused Agent E2E rerun, isolated runtime database verification, local Biome with only the existing generated shadcn warning, and `git diff --check` passed.

Post-completion response-card refinement (2026-07-21): completed assistant messages no longer repeat provider and model badges already shown in the active-run header. Per-response usage, retry, and interruption metadata remains visible. Production build, Node/web typecheck, focused Biome, `git diff --check`, and the built Electron Agent E2E passed.

Post-completion Side Chat refinement (2026-07-21): the Writing Workspace now hosts Agent chat as a responsive right-side `ResizablePanel` instead of a Sheet. Desktop widths are adjustable within the requested bounds, narrow layouts replace the manuscript while open, and each reopen starts at a session list before entering a conversation. The message timeline uses the official shadcn MessageScroller, Message, Bubble, Attachment, Marker, Resizable, and shimmer compositions; consecutive non-proposal tools project into one expandable activity group, while proposals remain standalone. Canonical Electron Vitest passed 92 files/409 tests; production build, Node/web typecheck, Biome on 320 files with only the existing generated shadcn warning, all 12 Electron Playwright scenarios, isolated runtime database verification, and `git diff --check` passed.

Post-completion field correction (2026-07-21): runtime event evidence from two DeepSeek V4 Flash runs showed repeated UUID-repair messages without any intervening outline tool execution, followed by an aborted run. The model-facing outline schema had incorrectly required the model to generate internal `createSection` UUIDs. It now accepts bounded local references and uses Pi's pre-validation `prepareArguments` hook to allocate application-owned UUIDs and rewrite all same-patch references before the worker-to-Main UUID contract is checked. The canonical Electron Vitest suite passed 92 files/407 tests; production build, Node/web typecheck, Biome on 314 files (with only the existing generated shadcn warning), all 12 Electron Playwright scenarios, isolated app-database verification, and `git diff --check` passed. The Agent E2E now proves a non-UUID local create reference succeeds through the real Pi loop.

Post-completion timeout/stop correction (2026-07-22): removed the Agent-wide request timeout and made `ProviderConfig.timeoutMs` an independent deadline for each logical provider call, including automatic retries. Tool continuations create a fresh deadline, while a linked per-run cancellation signal stops provider streams, retries, authorization waits, and in-flight tool handlers. Main drains the dedicated tool bridge before terminalizing a stopped run, preserves already-committed proposals, and classifies `provider_timeout`, `user_stopped`, `project_closed`, and generic interruption separately. Renderer timelines derive live/frozen run and tool durations from existing timestamps, show stopped tools as stopped rather than running, and label provider timeouts explicitly. Added worker, Main bridge/service, and renderer view-model coverage; canonical Electron Vitest passed 92 files/416 tests, Node/web typecheck passed, and Biome passed 320 files with only the existing generated shadcn cookie warning.

Post-completion presentation correction (2026-07-22): bounded long Outline rows and all Agent timeline leaves so hover actions, Markdown/code/tables, tool JSON, citation attachments, status metadata, and proposal content cannot expand their parent panels. The Agent trigger now lives at the far right of the global menubar and remains available through the existing keyboard shortcut. Proposal previews use exactly pinned `react-diff-viewer-continued` 4.4.0 with a highlighted unified vertical view by default, an explicit split-view switch, dark-theme styling, bounded scrolling, and truncation disclosure. Production build and Node/web typecheck passed; canonical Electron Vitest passed 92 files/416 tests; local Biome checked 321 files with only the existing generated shadcn cookie warning; `git diff --check` passed; the focused Agent workflow and all four Writing Workspace scenarios passed, including explicit panel/outline overflow assertions; the complete Electron E2E run passed 11/12 with one unrelated MinerU normalized-body timing failure that passed immediately in focused rerun. The `pnpm check` wrapper hung before producing output, so the local Biome binary was used and no final `pnpm check` pass is claimed.

Post-completion silent E2E maintenance (2026-07-22): the Main process now supports an explicit silent window presentation for Playwright and packaged hybrid smoke. Silent BrowserWindows remain hidden and unfocused, disable renderer background throttling, skip macOS Dock activation and default maximization, and ignore second-instance focus requests; normal launches remain interactive. The default E2E wrapper is silent, while `test:e2e:visible` is available for interactive debugging. The fixture asserts the hidden/unfocused/non-throttled invariant at every launch. Biome, Node/web typecheck, production build, Electron-hosted Vitest (92 files/420 tests), complete silent Electron Playwright (12/12), packaged hybrid smoke, and `git diff --check` passed. The visible command was list-checked without launching a desktop window.

Follow-up Sidebar header correction (2026-07-22): a narrow-window field screenshot showed that the first presentation pass had bounded Outline rows but not the contextual Sidebar header's intrinsic width. The composed secondary Sidebar, project/status row, and Brief/Outline grid now all opt into shrinking; the two buttons stay within their grid tracks and truncate only their labels when necessary. The production build and Node/web typecheck passed, and the complete Writing Workspace Electron scenario passed with the app resized to 900 px and direct assertions that the header has no horizontal overflow and `Edit outline` remains inside the Sidebar boundary.

Post-completion Outline row refinement (2026-07-22): hidden add/delete controls no longer reserve
flex width. Each Outline section button now fills the available row and shows its word count at rest;
hover or keyboard focus-visible replaces the count with the two overlaid actions. Focused Biome and
an independent production Renderer build passed in the active worktree. Because unrelated Agent
context/approval-policy work is currently mid-edit, the complete Node/web typecheck, production
build, and focused real Electron Writing Workspace scenario were run in a clean HEAD snapshot
carrying only this refinement; all passed, including explicit row-boundary, count, and hover-action
assertions.

Post-completion section-deletion correction (2026-07-22): an applied section proposal protected its accepted revision through `mutation_proposals.applied_revision_id`, so a later outline hard-delete correctly failed instead of cascading away immutable Agent lineage. ADR 002 and migration 0018 now make deletion an internal tombstone: every active outline/editor/Agent query excludes `deleted_at`, active position indexes ignore tombstones, IDs cannot be reused, materialization registrations are removed, and all section revisions plus proposal/model lineage remain durable. Manual and Agent deletion share the same leaf/last-section rules; deleting the active editor target flushes before approval and falls back after refresh; prior section undo reports the tombstoned target as not undoable. Local Biome checked 324 files with only the existing generated shadcn cookie warning; Node/web typecheck and production build passed; canonical Electron Vitest passed 92 files/423 tests; all 12 silent Electron Playwright scenarios passed; isolated real-app `app.sqlite` verification passed; and an online backup of the reported schema-17 project accepted migration 0018 plus the previously blocked protected-deletion transition with two revisions and both applied proposal links intact and no foreign-key failures. The `pnpm test`/`pnpm build` wrappers hung before output, so the documented direct test runner and npm build equivalent were used.

Post-completion stale section-proposal correction (2026-07-22): pending section proposals now show
`Outdated` as soon as their base revision differs from workspace truth. Approving an outdated
proposal performs an operation-aware three-way analysis inside the same immediate transaction:
non-conflicting work becomes a new pending proposal and requires a second approval, conflicting
work terminates inline with a safe reason, and reliably satisfied field updates terminate without a
revision. Migration 0019 adds the linear replacement chain and terminal states; pending bases are
protected from body pruning, the renderer projects only the latest leaf, and only final application
publishes `sectionChanged`. Local Biome (329 files, with only the existing generated shadcn cookie
warning), Node/web typecheck, canonical Electron Vitest (94 files/435 tests), production build, all
13 built-app Electron Playwright scenarios, migration backup/foreign-key coverage, isolated
app-database integrity verification, and `git diff --check` passed. The offline `pnpm` wrapper could
not verify its registry signature, so the installed Biome binary, documented direct test runner,
and npm build equivalent were used. Checkpoint 24 remains unstarted.

Focused evidence also covers lease-before-replay ordering, sequence cursor bounds/de-duplication, renderer-delivery isolation, project capability revocation, authoritative proposal state, all three start scopes, usage aggregation, CJK token estimation, oversized-current-turn safety, one-summary-only compaction, preserved raw events, and recorded compaction model requests.

Post-completion run-state correction (2026-07-22): terminal Agent events now immediately freeze the
renderer run state, and stale list responses or a fast terminal event racing the `startRun` IPC
response cannot restore `running`. Stop is idempotent after durable completion; stale steer/follow-
up failures reconcile against Main truth instead of leaving the composer wedged. Local Biome
checked 339 files with only the existing generated shadcn cookie warning; Node/Renderer typechecks,
production build, canonical Electron Vitest (96 files/448 tests), all 13 built-app Electron
Playwright scenarios, isolated app-database integrity/schema verification, and `git diff --check`
passed.

Post-completion section body correction (2026-07-22): the bounded Agent system prompt now makes
section titles explicit outline metadata rendered outside the BlockNote body. Section writing and
patching must begin with body content rather than an opening heading that repeats or restates the
target title, while genuine lower-level subheadings remain allowed. The canonical Electron-hosted
Vitest suite passed 96 files/448 tests; Biome checked 339 files with only the existing generated
shadcn cookie warning; and `git diff --check` passed. The `pnpm check` wrapper hung without output,
so the installed Biome binary was used and no `pnpm check` pass is claimed.

## Checkpoint 23 baseline before Harness v2

The earlier Checkpoint 23 baseline added model-aware Agent context budgeting and utilization, plus application-
default/session-specific `manual`, `section_auto`, and `yolo` proposal approval policies. It keeps
the then-frozen seven-tool surface and existing persistence tables. Its approval-waiter behavior is
historical and superseded by ADR 005. Checkpoint 24 and all Phase 10 work remain unstarted.

Completion evidence (2026-07-22): migration 0020, bounded models.dev resolution and cache fallback,
run-snapshotted limits and approval modes, the complete approval matrix, cancellable mutation
barriers, authoritative workspace refresh, Brief draft conflict protection, and the latest-call
context meter are implemented. Biome checked 339 files with only the existing generated shadcn
`document.cookie` warning; Node and Renderer typechecks and the production build passed; the
canonical Electron-hosted Vitest suite passed 96 files/447 tests; all 13 built-app Electron
Playwright scenarios passed; the signed macOS arm64 unpacked build and packaged hybrid smoke passed
native search, provider-failure fallback, and stale-session scenarios; isolated real-app
`app.sqlite` integrity/schema verification passed; and `git diff --check` passed. The documented
direct test runner and npm build equivalent were used because the local pnpm wrapper did not start
reliably in this environment.

## Completed Harness v2 window

The user approved Checkpoints 23H.1 through 23H.3 before Checkpoint 24. ADR 005 supersedes the
initial seven-tool list and approval-waiter semantics while preserving the closed domain-tool
surface, Main/worker trust boundary, five Agent persistence tables, typed proposals, and revision
checks. The window delivers structured tool results, complete attempt auditing, request-scoped
writing snapshots, non-blocking proposal review, Main-owned outline/block normalization,
effect-based approval, manuscript search, change inspection, and deterministic draft checks.

The Checkpoint 23H acceptance gate passed on 2026-07-22. The final implementation uses eleven
bounded domain tools, request-scoped writing snapshots, Tool Result schema v2, non-blocking
proposal review, trusted approval decisions, Main-owned SectionRef/block-hash normalization,
effect-based approval, expanded-evidence proposal provenance, stable deterministic draft checks,
and proposal ID mappings. Checkpoint 24 and all Phase 10 implementation remain unstarted and
require separate user approval.

Acceptance evidence: local Biome checked the worktree with only the existing generated shadcn
`document.cookie` warning; Node and Renderer typechecks and the production build passed; the
canonical Electron-hosted Vitest suite passed 96 files/449 tests; all 13 built-app Electron
Playwright scenarios passed, including v2 read-citations/submit, proposal pause, approval and a
fresh approval-continuation run; migration 0021 and compatibility readers passed the project
database suite; a signed macOS arm64 unpacked application passed strict deep signature validation;
packaged hybrid native search, provider-failure fallback, and stale-session smoke passed; the asar
contains `out/main/agent-worker.js`, with arm64 `better_sqlite3.node` and `vec0.dylib`; an isolated
real application produced `app.sqlite` with application ID 1464615248, user/schema version 1,
`integrity_check=ok`, no foreign-key failures, and a valid schema manifest row; and
`git diff --check` passed. The installed Biome binary and documented npm/direct test equivalents
were used because the local pnpm wrapper could not verify its registry signature offline.

## Deferred

- Provider reasoning controls, chain-of-thought display, additional Agent tools/tables, multiple agents/sub-agents, long-term memory, multi-level summaries, Pi harness JSONL storage, and per-project Agent worker processes.
- External editing synchronization, project-wide file watching, alternative vector backends, client-side MinerU page-count enforcement, and model cost estimation remain deferred as recorded in `docs/implementation-todo.md`.
