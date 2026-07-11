---
title: PIA-018 Legacy Generation Replacement and Deletion Manifest
task: PIA-018
adr: ADR-0012
status: Complete — implementation pending dependent tasks
created: 2026-07-11
last_updated: 2026-07-11
---

# PIA-018: Legacy Generation Replacement and Deletion Manifest

This is the required pre-cutover inventory for [ADR-0012](adr/0012-replace-interactive-generation-with-pi-agent-event-runtime.md). It records the observed legacy pipeline and the required disposition of every active route and its supporting artifact. It does not change or remove product code.

Task state, ownership, and verification evidence remain canonical in the [project task tracker](task-tracker.md).

## Scope and disposition terms

| Disposition | Meaning |
| --- | --- |
| Replace | A later PIA task supplies a Pi-native equivalent before the legacy item can be removed. |
| Retain behind Pi | The capability remains, but is callable only by a named allowlisted Pi tool or Patch bridge — not by the legacy orchestration. |
| Archive/read-only | Preserve existing rows/data for history; block new writes through the old model. |
| Delete at cutover | Remove only in PIA-016 after its migration, parity, test, smoke, evaluation, and kill-switch gates pass. |
| Superseded documentation | Keep the architectural record, but ensure current user/engineering guidance points to ADR-0012 rather than its former policy. |

## Observed active action surface

All interactive writing actions originate in `src/renderer/features/writing/WritingView.tsx` and currently call `createGenerationTask`.

| Legacy action | Current payload mode | Current target | Pi replacement | Cutover acceptance |
| --- | --- | --- | --- | --- |
| Rewrite section | `rewrite_section` | Whole focused section | `startAgentRun` with a section scope and a `propose_writing_patch` result | A Pi run produces a reviewable replace-section patch; no legacy round is created. |
| Rewrite selection | `rewrite_selection` | Selected text range in focused section | `startAgentRun` with a selection scope anchored to its parent section | Range/anchor validation still runs and the per-section run lock covers the selection. |
| Continue at cursor | `continue` | Cursor offset in focused section | `startAgentRun` with an insertion scope | The resulting patch remains reviewable and preserves the existing insertion semantics. |

`GenerationMode` also lists `append`, but no current renderer call site emits it. The Pi adapter proof in PIA-004 must nevertheless account for it until PIA-016 removes the legacy type and verifies that it has no reachable caller.

## Legacy execution route and target map

```text
WritingView
  -> createGenerationTask IPC
    -> ipcHandlers legacy orchestration
      -> retrieval planner + retrieval worker
      -> streamLlmObject
      -> llm_generation_sessions / llm_generation_rounds
      -> GenerationEvent + renderer subscriptions
      -> createPatchFromGenerationRound
      -> WritingPatch validation and author review
```

The target route is:

```text
WritingView
  -> startAgentRun IPC
    -> main-process AgentManager + Pi Agent
      -> allowlisted context and source tools
      -> redacted monotonic Pi event projection
      -> Pi-to-WritingPatch bridge
      -> existing validation and author review
```

## Main-process inventory

| Item | Legacy responsibility / call site | Disposition and replacement | Owning task(s) | Cutover check |
| --- | --- | --- | --- | --- |
| `src/main/ipcHandlers.ts` — `createGenerationTask`, cancel, retry, discard, adoption, and round-list handlers | Starts and owns the handwritten generation state machine; retries can call it again. | Replace the active entry point with `AgentManager`; delete legacy start/cancel/retry/discard/adopt handlers and legacy reads after the Pi IPC is available. Retain only general patch-review handlers. | PIA-006, PIA-008, PIA-009, PIA-011, PIA-016 | A repository search shows no active IPC handler can create/update an `llm_generation_*` record. |
| `src/main/ipcHandlers.ts` — `runGeneration`, `prepareAndStartGenerationTask`, `interactiveGenerationRuns`, `retrievalGenerationRuns` | Legacy AbortController maps, retrieval-to-one-shot orchestration, and round terminalization. | Delete at cutover. AgentManager owns sequential Pi tools, run budgets, timeout, cancellation, locks, and cleanup. | PIA-006, PIA-007, PIA-011, PIA-016 | No renderer request or retry reaches these functions; no equivalent parallel legacy map remains. |
| `src/main/ipcHandlers.ts` — editor prompt/request helpers | Convert the four `GenerationMode` shapes into a legacy prompt and `applyPayloadJson`. | Replace scope normalization with typed agent-run inputs and a Pi patch proposal contract. Preserve target anchoring semantics in PIA-008, not legacy serialized apply payloads. | PIA-004, PIA-006, PIA-008, PIA-016 | Selection, section, insertion, and unreachable append compatibility are exercised through the Pi adapter test suite. |
| `src/main/generationEvents.ts` | Broadcasts unredacted legacy `GenerationEvent` objects to all windows. | Delete. Replace with a bounded Pi-event projection emitter preserving Pi kind, `origin`, and monotonic sequence. | PIA-009, PIA-016 | No `generationEvent` channel or `emitGenerationEvent` import remains. |
| `src/main/generationContext.ts` — structure/project-brief context helpers | Builds article/project context used by the legacy prompt. | Retain behind the Pi context-reading facade after output/size limits and prompt-injection treatment are defined. `buildContextPrompt` is legacy prompt stitching and is deleted/replaced. | PIA-006, PIA-007, PIA-016 | Pi tools return bounded scoped context; no direct legacy prompt construction remains. |
| `src/main/generationContext.ts` — `retrieveKnowledgeForGeneration` | Runs local retrieval and emits retrieval-only trace callbacks. | Retain behind the named `source` Pi tool. Map its deadline/cancellation to a typed tool result, not a legacy retrieval trace. | PIA-007, PIA-011 | A 45-second worker timeout emits a classified tool terminal event with provenance. |
| `src/main/retrievalPlanner.ts` | Calls a one-shot LLM to generate one to three retrieval queries before generation. | Delete or replace only as an internal bounded Pi tool strategy; it must not remain a direct legacy LLM stage. Pi decides whether another search is needed. | PIA-004, PIA-007, PIA-016 | No interactive run imports `planKnowledgeRetrievalQueries`. |
| `src/main/generationPatch.ts` | Parses a completed legacy round and turns its stored output/apply payload into a `WritingPatch`. | Replace with a Pi output-to-patch bridge. Preserve patch parsing, anchoring, diff, validation, and review semantics; delete legacy round parsing and `parseGenerationApplyPayload`. | PIA-008, PIA-016 | A valid Pi proposal creates the same reviewable patch outcomes without a legacy round. |
| `src/main/llmRunner.ts` | Supplies `streamLlmObject` to the legacy one-shot generation and object generation to retrieval planning. | Retain for non-interactive consumers (project-brief suggestion and knowledge index). Remove legacy interactive imports; Pi adapter is the only interactive provider boundary. | PIA-004, PIA-006, PIA-016 | No interactive-generation code calls `streamLlmObject` or `generateLlmObject` directly. |
| `src/main/knowledgeIndex.ts` | Uses `llmRunner` for knowledge-index work, independent of interactive generation. | Retain unchanged; it is not an agent route. | None | No Pi cutover change is required. |
| `src/main/harness/patchApplier.ts`, `patchDiff.ts`, `patchProtocol.ts`, `patchScanners.ts`, `patchValidator.ts` | Existing proposal parsing, diff, validation, and explicit application boundary. | Retain behind the Pi patch bridge and author actions. Do not expose as direct agent tools. | PIA-008 | Agent tools cannot apply a patch or directly mutate a document. |
| `src/main/retrievalWorkerClient.ts` and retrieval worker services | Bounded lower-level retrieval implementation. | Retain behind `source`; preserve ADR-0011 worker reset/deadline guarantee. | PIA-007, PIA-011 | Cancellation/timeout leave no stuck worker or active Pi run. |

## IPC, preload, API, and shared-type inventory

| Item | Current surface | Disposition and replacement | Owning task(s) | Cutover check |
| --- | --- | --- | --- | --- |
| `src/shared/ipc.ts` — `createGenerationTask`, `cancelGenerationTask`, `adoptGenerationTask`, `discardGenerationTask`, `retryGenerationTask`, `createPatchFromGenerationRound`, `listGenerationSessions`, `listGenerationRounds`, `getGenerationRound`, `generationEvent` | Legacy renderer-to-main commands and event channel. | Delete at cutover. Replace with typed Pi run start/cancel/list/read APIs and one redacted run-event subscription. | PIA-009, PIA-016 | Shared contract has no legacy generation command/event name. |
| `src/preload/preload.cts` | Exposes all legacy generation invocations and `onGenerationEvent` through `contextBridge`. | Delete legacy bindings; expose only typed Pi projection APIs. Existing author patch-review bindings remain. | PIA-009, PIA-016 | The renderer cannot invoke raw main services or legacy routes. |
| `src/renderer/api.ts` | Typed accessor for the preload API. | Automatically changes with the shared contract; remove legacy API expectations. | PIA-009, PIA-016 | Typecheck proves no caller retains a legacy method. |
| `src/shared/types.ts` — `GenerationMode`, `GenerationOutputMode`, `GenerationRoundStatus`, `GenerationSessionRecord`, `GenerationRoundRecord`, `CreateGenerationTaskPayload`, `CreateGenerationTaskResult`, `AdoptGenerationPayload`, `CreatePatchFromGenerationRoundPayload`, `GenerationEvent` | Legacy request, state, history, and event grammar. | Delete at cutover. Replace with separate canonical Pi run, terminal diagnostic, event projection, and start-scope types. | PIA-005, PIA-006, PIA-009, PIA-016 | No renderer state derives progress from legacy statuses or `retrievalTrace`. |
| `src/shared/types.ts` — `KnowledgeRetrievalTraceEvent` | Retrieval-only trace reused as legacy generation progress. | Retain for lower-level retrieval diagnostics only; do not use it as the Pi author timeline. | PIA-007, PIA-009 | Pi tool outcomes use Pi event projections with bounded provenance. |
| `src/shared/types.ts` — `WritingPatch`, `WritingPatchRecord`, patch target/anchor/validation types | Proposal-only mutation and review contract. | Retain. Extend provenance only if PIA-005/PIA-008 needs a Pi run reference without breaking historical values. | PIA-005, PIA-008 | Apply/Save Candidate/Reject semantics and validation remain unchanged. |
| `src/shared/types.ts` — `LlmOperationRecord` metadata types | Read-only per-section assist metadata, separate from active rounds. | Retain as historical section metadata unless PIA-005's archive design migrates its provenance. Do not treat it as a live Pi run model. | PIA-005, PIA-015 | Historical metadata remains readable and no new Pi run writes the legacy shape. |

## Persistence and migration inventory

| Store or writer | Current behavior | Required archive/migration disposition | Owning task(s) | Cutover check |
| --- | --- | --- | --- | --- |
| `llm_generation_sessions` and `llm_generation_rounds` in `src/main/db/schema.ts` and `src/main/database.ts` | Persist active legacy requests, prompt text, output, retrieval traces, provider/model labels, and patch linkage. | Archive/read-only. PIA-005 plus DAT-001 must select and test a backup-safe strategy before any table removal. New Pi runs use new canonical records; do not extend these tables. | DAT-001, PIA-005, PIA-016 | Migration fixture proves legacy sessions/rounds remain listable/readable; no post-cutover write occurs. |
| Legacy database methods — `createGenerationSession`, `createGenerationRound`, `updateGenerationRound`, `deleteGenerationRound`, `getRunningRoundForSection`, `adoptGenerationRound`, `getGenerationRoundApplyPayload` | Read and mutate the active legacy state model. | Delete active writer methods at cutover. Retain only isolated read-only archive access if PIA-005's approved design requires it. | PIA-005, PIA-006, PIA-016 | No method can mutate legacy history after cutover; discarding a new run cannot delete historical records. |
| `writing_patches` and its generation session/round columns | Stores the current review artifact and links historical artifacts to legacy records. | Retain. Preserve historical foreign references; add/choose Pi provenance without overwriting historical legacy IDs. | PIA-005, PIA-008 | Existing pending and historical patches remain readable and actionable under current rules. |
| `generation_citations` and `save/listGenerationCitations` | Source provenance attached to generated content nodes; it is not the active round timeline. | Retain. Rename/refactor only if needed for clarity, with a migration preserving references. It may provide evidence input to the Pi context facade but is not an unrestricted tool. | PIA-005, PIA-007 | Citation navigation and coverage remain intact. |
| `plainjob_jobs` cleanup for type `llm-generation` in `database.ts` | Old compatibility cleanup currently deletes this obsolete queued-job type during initialization. | PIA-005 must review it with DAT-001; it must not erase records required by the approved archive/recovery policy or affect Pi records. | DAT-001, PIA-005 | Recovery test proves legacy records survive the approved migration path. |
| Section `metadata.llmOperations` and `upsertSectionLlmOperation` | Stores historical assistant-operation summaries and refreshes their staleness. | Archive/read-only for existing data. New Pi runs must use canonical agent records instead of adding this legacy metadata. | PIA-005, PIA-016 | No new Pi path writes `llmOperations`; old metadata remains readable until an approved migration changes it. |

## Renderer inventory

| Item | Current dependency | Disposition and replacement | Owning task(s) | Cutover check |
| --- | --- | --- | --- | --- |
| `src/renderer/features/writing/WritingView.tsx` | Only active start surface; presents rewrite-all, rewrite-selection, and continue controls. | Replace API call and busy states with Pi run start/scope/lock feedback. Retain author intent controls where they fit the Pi run UX. | PIA-009, PIA-010 | Starting any displayed action creates exactly one Pi run. |
| `src/renderer/features/generation/GenerationHub.tsx` | Bottom hub reconstructs progress from `GenerationRoundRecord`, `GenerationEvent`, stream deltas, and retrieval traces. | Delete/replace with an ordered Pi event timeline showing run/turn/message/tool activity, bounded evidence, patch review, and typed terminal diagnostics. | PIA-009, PIA-010, PIA-016 | No legacy status label, trace, or `onGenerationEvent` subscription remains. |
| `src/renderer/features/inspector/Inspector.tsx` | Lists legacy sessions/rounds, polls round state, subscribes to legacy events, exposes legacy cancel/retry/discard/adopt, and renders raw output/trace. | Replace live history with canonical Pi runs and event detail. Keep patch review and author actions. Historical legacy records remain separately readable through the PIA-005 archive view, not as live runs. | PIA-005, PIA-009, PIA-010, PIA-016 | Inspector never polls or invokes active legacy round APIs. |
| `src/renderer/features/sections/SectionListView.tsx` | Displays `metadata.llmOperations` summary. | Retain historical summary while PIA-005 decides archival presentation; do not update it for new Pi runs. | PIA-005, PIA-015 | New agent history appears through canonical Pi records. |
| `src/renderer/App.tsx` | Mounts `GenerationHub` whenever a workspace is active. | Replace mount with the Pi timeline component. | PIA-010, PIA-016 | The application does not mount the legacy hub. |
| `src/renderer/styles/llm.css`, `writing.css`, `inspector.css`, `research.css`, `sections.css` | Styles legacy progress, trace, review, and historical assist affordances. | Delete legacy-only rules when their components are removed; retain/rework shared patch review and historical metadata styles. | PIA-010, PIA-016 | No unused legacy hub/trace selectors remain after visual review. |

## Tests and verification inventory

| Item | Current coverage | Disposition and replacement | Owning task(s) | Cutover check |
| --- | --- | --- | --- | --- |
| `test/main/generationContext.test.ts` | Context tree, prompt construction, retrieval-query derivation, and project brief formatting. | Retain tests for context helpers that survive behind Pi tools; delete/replace legacy prompt-stitching and query-planner expectations. | PIA-007, PIA-012, PIA-016 | Tests prove bounded Pi context/tool output and provenance instead. |
| `test/main/harness.test.ts` | Patch parsing, diff, application, validation, and stale/risk rules. | Retain; add Pi bridge cases rather than duplicating patch logic. | PIA-008, PIA-012 | Pi-origin patch receives the same validation and review behavior. |
| `test/main/retrievalWorkerClient.test.ts` | Retrieval worker deadline, cancellation, and reset behavior introduced by ADR-0011. | Retain and extend through the `source` tool integration tests. | PIA-007, PIA-011, PIA-012 | Timeout/cancellation is a classified tool result and subsequent run is healthy. |
| Existing unit, typecheck, build, and Electron smoke paths | Current regression baseline does not exercise Pi full path or no-legacy-route behavior. | Replace/add deterministic provider-free Pi adapter, migration/archive, event-order, cancellation, stale-patch, tool-policy, and no-legacy-route tests; add full Pi smoke. | PIA-004, PIA-012, PIA-013 | `bun run typecheck`, targeted tests, build, and smoke pass with no credential requirement. |

## Documentation inventory

| Item | Disposition | Owning task(s) | Cutover check |
| --- | --- | --- | --- |
| `docs/adr/0012-replace-interactive-generation-with-pi-agent-event-runtime.md` | Retain as governing decision; update only its implementation roll-up when the decision-level state changes. | PIA-018 through PIA-016 | Completion conditions are checked against this manifest. |
| `docs/project-prd.md`, `docs/pi-agent-harness-prd.md`, `docs/task-tracker.md`, `docs/adr/README.md` | Retain as canonical planning/index documents. Update task evidence/status only in the tracker; update current behavior wording after verified cutover. | PIA-018, PIA-015, PIA-016 | Current documentation describes Pi as the sole runtime only after cutover proof. |
| `docs/adr/0003-preserve-human-reviewed-writingpatch-boundary.md`, `0008-persist-agent-audit-traces-in-dedicated-tables.md`, `0011-bound-generation-retrieval-worker-lifecycles.md` | Retain as still-binding constraints. | PIA-005, PIA-007, PIA-008, PIA-011 | Documentation continues to describe the review boundary, archival records, and tool deadline correctly. |
| `docs/adr/0001-use-pi-agent-core-as-controlled-writing-runtime.md`, `0006-select-supported-electron-pi-runtime-path.md`, `0007-gate-agent-mode-with-a-local-feature-flag.md` | Superseded documentation. Preserve history but remove any user/engineering guidance that suggests an optional Pi mode, legacy fallback, or old rollback policy. | PIA-015 | Only ADR-0012's `generation.enabled` kill-switch policy appears in current guidance. |
| `docs/adr/0005-select-pi-model-adapter-strategy.md` | Retain; PIA-004 updates it with the selected adapter proof for every action shape. | PIA-004, PIA-015 | It records no legacy fallback for unsupported providers. |

## Required release-gate evidence to discharge this manifest

PIA-016 may mark an item as discharged only when all relevant gates have passed:

1. PIA-004 proves a supported Pi adapter or preflight failure for every legacy action shape; no action selects the legacy runtime.
2. DAT-001 and PIA-005 approve and test backup-safe legacy record preservation before schema/table removal.
3. PIA-006 through PIA-011 provide the sole main-process runtime, scoped tools, patch bridge, IPC projection, UI, lifecycle controls, and kill switch.
4. PIA-012 proves no legacy active route, with provider-free deterministic coverage for event order, cancellation, timeout, archive/migration, and stale patch handling.
5. PIA-013 smoke-tests the Pi path with a classified retrieval failure and no direct document mutation.
6. PIA-014 records parity/usefulness and closes blocking gaps.
7. PIA-015 updates stable documentation, then PIA-016 deletes the legacy active route and rehearses the `generation.enabled` kill switch without fallback.

## PIA-018 verification

- [x] Main-process orchestration, provider, context, retrieval, patch, event, and worker dependencies are inventoried.
- [x] IPC channel, preload exposure, renderer API, and shared type surfaces are inventoried.
- [x] Legacy database writers, tables, historical metadata, patch references, and archive constraints are inventoried.
- [x] Renderer start, hub, inspector, section summary, application mount, and style surfaces are inventoried.
- [x] Existing tests and every generation-related planning/ADR documentation reference are inventoried.
- [x] Every item has a replacement, retained-tool rationale, archive/read-only action, or cutover deletion condition.
- [x] No product code was removed or modified by PIA-018.
