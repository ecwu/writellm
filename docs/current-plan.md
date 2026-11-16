# WriteLLM Current Plan

Status: Release 0.2026.11.1 passes local package acceptance. Tag publication is pending.
Recorded: 2026-11-08

This file owns current delivery state, acceptance gates, and platform gaps.
[Architecture](architecture.md) owns current system rules. [ADRs](adrs/) own decisions.
The [tracker](implementation-todo.md) links checkpoints. The [history log](history/implementation-log.md) owns past evidence.
Historical authorization records do not authorize new work.

## Current state

The maintenance branch `codex/untangle-code-knots` holds the refactors, dependency update, and OpenAI sign-in fix for review.

OpenAI sign-in supplies Pi 1.5 with a stable ID from `app.sqlite`.
The source and packaged macOS arm64 apps pass the sign-in scenario with a simulated ChatGPT response.
[Sign-in evidence](history/implementation-log.md#2026-11-07-openai-chatgpt-sign-in) records the local gates.
[Rebuild evidence](history/implementation-log.md#2026-11-08-local-macos-app-rebuild) records the app bundle update in `dist`.

Dependency maintenance on the same branch updates Pi to 1.5 and completes the ADR 056 deferred migrations: Electron 45, electron-vite 6 with Vite 8, KaTeX 0.18 with BlockNote 0.57 and Mermaid 12.3, p-queue 10, Playwright 1.65, `@google/genai` 3, and Biome 2.6.
Credentials use Electron's asynchronous `safeStorage`. The native-menu layout toggle no longer drops commands while controls republish.
The full package gate passes with 47 packaged scenarios and installers. All 69 source scenarios also pass with zero retries.
[Dependency evidence](history/implementation-log.md#2026-11-07-pi-15-electron-45-and-dependency-migrations) records versions, gates, and the two diagnosed failures.

Local maintenance on `codex/untangle-code-knots` resolves three code knots from baseline `707eb15`.
Tool errors have an independent owner, model completion shares explicit policies, and two forwarding wrappers are removed.
Each item passes focused Electron tests, static analysis, and a production build.
Three selected interaction scenarios pass, including a final rerun of the grounded Agent workflow.
[Maintenance evidence](history/implementation-log.md#2026-11-07-code-knot-maintenance) records counts, durations, and two rolled-back attempts.
Package acceptance below applies to the release baseline.

The continuation on the same branch resolves four more knots in Agent session reads, startup recovery, mutation evidence, and project capture.
Each item passes focused Electron tests, static analysis, and a build. Eight interaction scenarios pass on macOS arm64.
[Continuation evidence](history/implementation-log.md#2026-11-07-code-knot-continuation) records the gate counts and platform limits.

The queue pass shares Steer and Follow-up setup and enforces Follow-up capacity when submissions overlap.
Both changes pass focused tests, static analysis, a build, and the Electron queue scenario.
[Queue evidence](history/implementation-log.md#2026-11-07-agent-message-queue) records the gate results.

The ownership pass shares proposal writes, manuscript reads, and trace header filtering. It also removes five unused forwarding exports.
Each change passes focused tests, static analysis, and a build. Six selected Electron scenarios pass on macOS arm64.
[Ownership evidence](history/implementation-log.md#2026-11-07-code-ownership-maintenance) records the gate results.

The lifecycle pass shares close steps and project open logic. Import staging cleanup now runs under the project write lock.
Managed file and tree deletion share path validation. Seven selected Electron scenarios pass on macOS arm64.
[Lifecycle evidence](history/implementation-log.md#2026-11-07-project-lifecycle-ownership) records the gates and one rollback.

The next queue pass shares delivery failure cleanup for Steer and Follow-up. Delete and Promote also share pending request cleanup.
Both changes pass focused tests, static analysis, a build, and the Electron queue scenario on macOS arm64.
[Queue delivery evidence](history/implementation-log.md#2026-11-07-agent-queue-delivery-and-retirement) records the gates and one rollback.

Knowledge Mapping reads each selected raw artifact once per request. Mapping, normalization, and publication recovery share a manifest reader.
The index worker also uses the shared file reader. All three changes pass focused tests, static analysis, a build, and selected Electron scenarios.
[Artifact reader evidence](history/implementation-log.md#2026-11-07-knowledge-artifact-readers) records the results on macOS arm64.

Main and the index worker share a streaming normalized block verifier and a manifest reader.
Parsed image reads use the active normalization run or the highest published version of a historical revision.
[Normalized reader evidence](history/implementation-log.md#2026-11-07-normalized-knowledge-readers) records the three local gates.

The index service owns rebuild requests and stores their delay in the durable queue.
Main and the index worker share source fingerprint rules. The worker uses one chunk fingerprint rule for build and reopen.
[Index scheduling evidence](history/implementation-log.md#2026-11-07-index-scheduling-and-fingerprints) records all three gates.

Embedding build and retrieval share one contract policy and verify the configured provider before execution.
The index service removes its unused standalone publish handler and inspection method.
[Embedding maintenance evidence](history/implementation-log.md#2026-11-07-embedding-contract-and-index-cleanup) records the gates and one rollback.

Manual embedding refresh checks all active embedding jobs at enqueue time.
Text and vector builds share the current-source check before activation and read their payloads through the durable job schemas.
[Refresh maintenance evidence](history/implementation-log.md#2026-11-07-embedding-refresh-admission-and-activation) records the three gates.

Embedding refresh setup clears its cache in the worker transaction that creates the generation.
Retries preserve saved vectors and check their source binding. New manual jobs save their source and provider target.
[Embedding retry evidence](history/implementation-log.md#2026-11-07-embedding-refresh-recovery) records the local and packaged gates.

The vector worker verifies chunk identity before writing and before switching active generations.
A restarted embedding job can write its saved chunk IDs again. Obsolete or mismatched candidates leave the active vectors available.
[Vector write evidence](history/implementation-log.md#2026-11-07-vector-write-and-activation-integrity) records the three gates and one rollback.

The index worker owns vector cleanup and applies retention at activation.
Vector queries and previews require an active source index. The worker protocol removes its unused deletion command.
[Vector retention evidence](history/implementation-log.md#2026-11-07-vector-retention-and-reads) records source and packaged verification.

The index worker ranks and loads search candidates from one text generation. Main retries once if the generation changes.
[Search evidence](history/implementation-log.md#2026-11-07-search-candidate-snapshots) records source and packaged verification.

Agent queue delivery shares model request setup and history writes in Main. The worker shares dispatch for direct and promoted Steer.
[Queue continuation evidence](history/implementation-log.md#2026-11-07-agent-queue-persistence-and-steer-dispatch) records both local gates.

Queue cleanup and run settlement share pending request aborts. Steer checks the original runtime before delivery, and closed handles reject late queue commands.
[Queue lifetime evidence](history/implementation-log.md#2026-11-07-agent-queue-lifetime) records the three local gates and one rollback.

Agent settlement releases queued images across review and overflow recovery. Overflow closes queue admission before cleanup, and Stop ends authorization waits in the worker.
[Queue cleanup evidence](history/implementation-log.md#2026-11-07-agent-queue-cleanup-and-cancellation) records the source and packaged gates.

Writing Agent and Notebook share continuation setup and wait for pending saves before settlement.
The worker supervisor acts only on current requests. The Agent client applies that rule to queue commands and authorizations.
[Continuation evidence](history/implementation-log.md#2026-11-07-tool-continuation-lifetime) records the three local gates.

Notebook registers turn completion before publication, shares default-model loading, and lets Stop, Clear, and Close cancel turn preparation.
[Notebook startup evidence](history/implementation-log.md#2026-11-07-notebook-startup-and-cancellation) records the local gates.

Notebook orders source refreshes and preserves chat context during index outages. Each turn captures its sources and history at admission.
[Notebook source evidence](history/implementation-log.md#2026-11-07-notebook-source-reconciliation-and-turn-history) records the local gates.

Notebook updates sources at capacity and adds the visible marker only when it fits. Streaming and snapshots share a UTF-8 text budget.
Stop settles the turn independently of snapshot delivery.
[Notebook capacity evidence](history/implementation-log.md#2026-11-07-notebook-capacity-and-stop-cleanup) records the local gates.

Full-text and vector search match literal decoded headings before ranking limits. Direct candidate loads use the same SQL filters.
[Search filter evidence](history/implementation-log.md#2026-11-07-search-heading-filters) records source and packaged verification.

Main authorizes a Follow-up after its history write. Direct submission and promotion share cleanup when delivery fails.
[Queue authorization evidence](history/implementation-log.md#2026-11-07-agent-queue-authorization-and-delivery-cleanup) records both local gates.

Direct Steer, promotion, and Follow-up consumption share the delivery checks in Main.
Run cleanup retries a failed abort after queue admission rejects a saved request.
[Queue delivery and admission evidence](history/implementation-log.md#2026-11-07-agent-queue-delivery-and-admission) records both local gates and one rollback.

Agent run cleanup waits for queue request saves and retries a failed abort once.
[Queue settlement evidence](history/implementation-log.md#2026-11-07-agent-queue-settlement) records both local gates.

Ranked search reads source summaries. Citation expansion and Mapping share a decoder for source locations.
[Index provenance evidence](history/implementation-log.md#2026-11-07-index-source-provenance) records both local gates.

Mapping limits rows in SQLite and uses sorted block ranges to select content and measure coverage.
[Mapping limit evidence](history/implementation-log.md#2026-11-07-mapping-row-limits-and-block-lookups) records both local gates.

The chunker renders each searchable block once per group. It shares the separator and image-caption matching rules with Mapping.
[Chunk grouping evidence](history/implementation-log.md#2026-11-07-chunk-grouping-and-mapping-rules) records three local gates.

Index segments store the sources that contribute text. The chunker shares the asset limit with search, and older index generations rebuild on open.
[Segment provenance evidence](history/implementation-log.md#2026-11-07-segment-provenance-and-asset-limits) records both local gates.

The index worker reads source rows one at a time and hashes chunk entries in order. The stored digest format stays the same.
[Startup fingerprint evidence](history/implementation-log.md#2026-11-07-startup-fingerprint-allocation) records both local gates.

The index worker returns the generation ID for readiness. Main rechecks the current sources and restores readiness after a successful rebuild.
[Index readiness evidence](history/implementation-log.md#2026-11-07-index-readiness-probes-and-recovery) records local and packaged gates.

Index requests share one worker startup and recovery attempt. Main queues a rebuild when a replacement worker opens without the current generation.
[Runtime recovery evidence](history/implementation-log.md#2026-11-07-index-worker-runtime-recovery) records both local gates.

Index shutdown waits for recovery file removal. Concurrent close calls share one shutdown, and the client rejects new work when close starts.
[Index shutdown evidence](history/implementation-log.md#2026-11-07-index-shutdown-and-recovery-cleanup) records both local gates.

The Index worker owns derived database creation and readiness. Snapshot archives retain their rebuild metadata and exclude the derived database.
[Index ownership evidence](history/implementation-log.md#2026-11-07-derived-index-ownership) records all three local gates.

Failed project open and normal close share ordered cleanup. A failed drain or worker stop keeps the database and lock available for retry.
[Project cleanup evidence](history/implementation-log.md#2026-11-07-project-open-and-close-cleanup) records all three local gates.

Project lock release resumes unfinished filesystem steps. Stale-lock recovery uses the inspected owner file.
[Project lock evidence](history/implementation-log.md#2026-11-07-project-lock-release-and-owner-validation) records both local gates.

Failed checkpoint restore and restart share journal replay. Replay checks project identity before moving a directory.
[Checkpoint recovery evidence](history/implementation-log.md#2026-11-07-checkpoint-restore-recovery) records both local gates.

Checkpoint journal replay takes the project write locks before it moves directories.
[Replay lock evidence](history/implementation-log.md#2026-11-07-checkpoint-journal-replay-locks) records the local gates.

Checkpoint restore keeps the original and candidate write locks through the directory swap and reopen.
[Swap lock evidence](history/implementation-log.md#2026-11-07-checkpoint-restore-lock-handoff) records the local gates and one rollback.

The launcher shows project diagnostics after an open, create, or close failure that requires recovery.
It can rebuild a missing manifest in the original folder or in a verified copy, then open the project.
[Recovery evidence](history/implementation-log.md#2026-11-07-launcher-project-diagnostics) records the local tests and packaged Apple Silicon scenarios.
[In-place repair evidence](history/implementation-log.md#2026-11-07-in-place-manifest-repair) records the same-lock reopen and history preservation.

Close, export, snapshot, and manuscript mutations share one editor save exchange.
Editor session cleanup clears the active section and cancels pending requests.
[Editor save evidence](history/implementation-log.md#2026-11-07-editor-save-requests-and-session-cleanup) records both local gates.

Editor saves, replacement, and Undo share one revision writer. Find and Knowledge requests share cancellation and session checks.
[Manuscript workflow evidence](history/implementation-log.md#2026-11-07-manuscript-revision-writes-and-request-lifetime) records both local gates.

Publication preview and export derive citations from the manuscript they already captured.
[Publication capture evidence](history/implementation-log.md#2026-11-07-publication-citation-capture) records both local gates.

Section Markdown export uses the same manuscript capture for revision validation and conversion.
[Section export evidence](history/implementation-log.md#2026-11-07-section-markdown-export) records the local gates.

Import planning and applying share one read of the manuscript and revision metadata per step.
Revision saves and whole-manuscript exports share the scan for image references.
[Import and image evidence](history/implementation-log.md#2026-11-07-import-metadata-and-image-references) records both local gates.

Agent mutations and Find and Replace share the editor reload and unlock path.
Main sends each Agent mutation notification once per window, even with multiple subscriptions.
[Editor refresh evidence](history/implementation-log.md#2026-11-07-editor-refresh-and-agent-notification-delivery) records both local gates.

The workspace refreshes after Agent changes through the Main notification. The Agent panel no longer requests a second refresh.
The editor, Agent panel, and Citation coverage use one Preload subscription method for Agent mutations.
[Agent refresh evidence](history/implementation-log.md#2026-11-07-agent-refresh-ownership) records both local gates.

Agent session refreshes share the session list reader. The first user message starts one refresh after writing guidance is ready.
Proposal approval shares one initial payload read and one result notification.
[Agent session and approval evidence](history/implementation-log.md#2026-11-07-agent-session-reads-and-proposal-approval) records both local gates.

Editor save requests use the current revision from the selected section.
The workbench uses the section load route. The unused editor-open IPC route is removed.
[Editor section evidence](history/implementation-log.md#2026-11-07-editor-section-selection-and-save-requests) records both local gates.

Editor saves use the revision writer's result to report whether content changed.
Identical save retries and project-open repair share file validation and repair.
[Editor save evidence](history/implementation-log.md#2026-11-07-editor-save-result-and-file-repair) records both local gates.

Only explicit editor activation sets the active section in Main. The workbench updates the tab once after editor activation.
[Section navigation evidence](history/implementation-log.md#2026-11-07-section-loading-and-navigation) records both local gates.

New section files use the revision ID returned by creation. Outline actions share the refresh after a failed write.
[Outline update evidence](history/implementation-log.md#2026-11-07-section-creation-and-outline-recovery) records both local gates.

The writing workspace delegates final-save requests and section title drafts to separate hooks.
[Workspace save evidence](history/implementation-log.md#2026-11-07-writing-workspace-save-coordination) records both local gates and one rollback.

Section switches, Agent scrolling, and Find result reveals share one navigation hook.
[Navigation evidence](history/implementation-log.md#2026-11-07-writing-workspace-navigation) records the local gates.

Release 0.2026.11.1 includes the state-transition guards for parsing, normalization, imports, attachments,
change-set batches, and the project lifecycle, the shared Agent workflow state derivation, and the replacement review race fix
([c934f26](https://github.com/ecwu/writellm/commit/c934f26) through [9fae0cd](https://github.com/ecwu/writellm/commit/9fae0cd)).
Local macOS arm64 acceptance passes the complete Vitest suite and the full package gate with twelve packaged runtime and 45 packaged interaction scenarios.
The four-platform tag build and automatic publication remain pending.
[Release preparation evidence](history/implementation-log.md#2026-11-06-release-02026111-preparation) records the commands, artifacts, and limits.

[Release 0.2026.10.5](https://github.com/ecwu/writellm/releases/tag/v0.2026.10.5) is published with four assets.
Tag `v0.2026.10.5` is fixed at `7cdfcfc`. It includes configurable image source instances and models
([b085618](https://github.com/ecwu/writellm/commit/b085618), [ADR 093](adrs/093-configurable-image-source-instances-and-models.md)).
Its [four-platform build](https://github.com/ecwu/writellm/actions/runs/41139328676) and [automatic publication](https://github.com/ecwu/writellm/actions/runs/41140703627) succeed on their first attempts.
Local macOS arm64 acceptance passes the full package gate with twelve packaged runtime and 45 packaged interaction scenarios.
[Release preparation evidence](history/implementation-log.md#2026-10-30-release-02026105-preparation) records the commands, artifacts, and limits.

[Release 0.2026.10.4](https://github.com/ecwu/writellm/releases/tag/v0.2026.10.4) is published with four assets.
Tag `v0.2026.10.4` is fixed at `29a9660`. It includes the interface-label simplification
([d050d23](https://github.com/ecwu/writellm/commit/d050d23)) and the Agent new-conversation draft fix
([802a8b9](https://github.com/ecwu/writellm/commit/802a8b9)).

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


- The production audit reports no advisories. The full audit retains one moderate minimatch advisory inside electron-builder's `@electron/universal`.
  Its repair requires minimatch 11, which electron-builder does not declare.

## Current authorized work

The user authorizes updating Pi to 1.5 with the compatible dependencies, then the coupled migrations and failing-test repairs. They are implemented and verified locally.

Approved maintenance: inspect code knots, create an HTML wiring map, and refactor on a new local branch.
Each item requires tests and a build. A failed item must be rolled back.
The continuation uses the same branch and gates for session, mutation, and project services.

The user authorizes pushing the maintenance, dependency update, and sign-in fix to `codex/untangle-code-knots` for review.

Approved scope: build release 0.2026.11.1 and, when local acceptance passes, commit it and create tag `v0.2026.11.1`.
Pushing the tag starts the four-platform build and automatic publication, and awaits the user's confirmation.

## Deferred

- Renderer decomposition carried from Issue 18, and general service test fixture consolidation (ADR 086).
- Dependency follow-ups from the 2026-11-07 migrations under [ADR 056](adrs/056-dependency-security-and-compatibility-refresh.md#2026-11-07-pi-15-electron-45-vite-8-and-katex-018-amendment). Each waits on the stated trigger:
  - KaTeX 0.19: when `@blocknote/math-block` and Mermaid both accept it. Their ranges are ^0.18.9 and ^0.18.
    0.19 reports missing glyphs through `strict`, so the exporters' `strict: 'ignore'` behaviour needs a check.
  - `@types/node` 26: when an Electron release bundles Node 26. Electron 45 bundles Node 24.22, and the types must match it.
  - The exact `katex` override in `pnpm-workspace.yaml`: remove it when `rehype-katex` declares KaTeX 0.18 or later. 7.0.1 declares ^0.16.
  - The minimatch advisory in electron-builder's `@electron/universal`: repair it when electron-builder accepts minimatch 11 or later.
  - The BlockNote popover patch: drop it when upstream `GenericPopover` stops reapplying an unchanged reference. Re-port it on every BlockNote update.
  - Biome 2.6: decide whether to enable its Markdown and YAML formatters, which would reformat about 44 documentation and YAML files.
    Review the two `useDomNodeTextContent` warnings in `e2e/workbench.spec.ts` and `scripts/smoke-packaged-hybrid.mjs`; `textContent` changes what `innerText` returns.
  - PDF math: the PDF export renders KaTeX HTML output but embeds no KaTeX stylesheet. Check printed math and decide between MathML output and an embedded stylesheet.
  - Agent tool preflight: Pi 1.5 validates with pi-schema, while WriteLLM's rejection diagnostic still uses TypeBox.
    When only pi-schema rejects an argument, the model receives the generic blocked-before-dispatch message. Consider building the diagnostic from pi-schema's errors.
  - Local development Node: this host runs Node 26.13.0, outside the `>=24.21.0 <25` engine range. Electron-hosted tests are unaffected; install Node 24 before relying on system-Node scripts.
- Multiple active projects or primary manuscripts, realtime collaboration, and cloud sync.
- General external edit synchronization, directory scans, and project-wide watchers.
  ADR 070 permits one explicitly selected bibliography file only.
- Subagent product workflows, autonomous background writing, and implicit long-term memory.
- Generic plugins, executable Writing Skills, unrestricted Agent tools, and direct Agent writes.
- DOCX and other non-LaTeX import formats, true image editing, and generic image plugins.
- An updater, additional distribution targets, and signed distribution with notarization.
