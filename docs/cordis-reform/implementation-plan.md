# Cordis Agent Replacement Plan

Status: proposed; no implementation stage is authorized by this document  
Date: 2026-08-14  
Architecture: [Cordis Agent target architecture](target-architecture.md)  
Decision: [ADR 045](../adrs/045-isolated-cordis-agent-replacement.md)

## 1. Delivery strategy

The reform is delivered as an isolated-engine replacement, not an in-place refactor:

```text
Pi remains working
  -> establish Cordis substrate
  -> expose an independent Cordis engine
  -> implement complete Cordis capability
  -> make Cordis the default
  -> prove deletion readiness
  -> delete Pi
```

Each stage is separately authorized and reviewable. Finishing one stage does not authorize the
next. During the dual-engine period, rollback changes the default engine; it never converts a
session.

The plan uses reform stages `R0`–`R9` instead of assigning Phase/checkpoint numbers before the
architecture is accepted. Once accepted, the current tracker can map one approved stage at a time to
the next available checkpoint.

Each stage has a Chinese detail document under [`stages/`](stages/README.md):

| Stage | Detail document |
| --- | --- |
| R0 | [stages/r0.md](stages/r0.md) |
| R1 | [stages/r1.md](stages/r1.md) |
| R2 | [stages/r2.md](stages/r2.md) |
| R3 | [stages/r3.md](stages/r3.md) |
| R4 | [stages/r4.md](stages/r4.md) |
| R5 | [stages/r5.md](stages/r5.md) |
| R6 | [stages/r6.md](stages/r6.md) |
| R7 | [stages/r7.md](stages/r7.md) |
| R8 | [stages/r8.md](stages/r8.md) |
| R9 | [stages/r9.md](stages/r9.md) |

## 2. Global rules

Every implementation stage must obey these rules:

1. Pi and Cordis Harness code do not import each other.
2. Cordis code never imports `@earendil-works/pi-agent-core` or `@earendil-works/pi-ai`.
3. No Pi session or event is copied into Cordis storage.
4. No command or event is translated between engine protocols.
5. No session can change engine.
6. Main product authority is shared only through engine-neutral typed services.
7. There is no dual write to legacy and Cordis session stores.
8. Renderer access remains behind preload Zod IPC and a live `projectSessionId` capability.
9. No generic filesystem, shell, SQL, network, credential, or dynamic-code tool is added.
10. Network waits and worker waits remain outside SQLite transactions.
11. Every plugin owns all listeners, timers, child plugins, ports, and in-flight work through
    reversible effects.
12. Every durable handler is idempotent and records recovery state before external continuation.
13. Every feature emits structured lifecycle logs through shared observability.
14. Every migration has backup, integrity, forward-only, and recovery coverage.
15. Packaged verification is mandatory when a stage changes Cordis, Electron utility-process entry,
    project migrations, or packaged resources.
16. A reload never mutates an in-flight request generation; failed candidates preserve the last-good
    composition and expose a diagnostic.
17. Request trace is non-authoritative and metadata-only; disabling, dropping, or clearing it never
    changes Agent execution or recovery.
18. Run concurrency and cost ceilings are engine-neutral platform limits, not per-engine budgets.

## 3. Required architecture tests from the first implementation commit

The repository must gain automated import-boundary checks before feature code grows:

```text
Cordis roots -> may import shared Cordis contracts and engine-neutral platform only
Legacy roots -> may import legacy contracts and engine-neutral platform only
Engine shell -> may import opaque Renderer entries and tagged summaries only
Product platform -> may not import either Harness runtime
```

The check fails on:

- Cordis-to-legacy or legacy-to-Cordis relative imports;
- Cordis imports of either Pi dependency;
- product platform imports of loop/session/prompt/tool runtime modules;
- Cordis SQL that names Pi session/event tables;
- legacy SQL that names Cordis session/event tables;
- a shared transcript, run-state, queue-state, or compaction-state type.

## 4. Stage R0 — accept and freeze the architecture

### Scope

- Review and accept or amend ADR 045.
- Accept the target architecture and this staged plan.
- Map R1 to one newly authorized project checkpoint.
- Record explicit non-goals: no session conversion, arbitrary package loading, marketplace, dynamic
  code, shell, generic FS, plan mode, or subagents.
- Record the deferred extension stages (goals, structured user questions) as separately authorized
  post-parity work that R1-R9 reserves seams for but does not implement.
- Decide whether destructive Pi-table removal requires a separate final user confirmation; the
  recommended answer is yes.

### Exit gate

- ADR 045 is accepted.
- `docs/architecture.md`, `docs/current-plan.md`, the new checkpoint tracker entry, and history
  routing are updated consistently.
- No product code or dependency has changed yet.

## 5. Stage R1 — Cordis substrate and conformance

### Objective

Introduce the exact Cordis framework and trusted composition substrate, then prove lifecycle,
transactional reload, diagnostics, and trace contracts without exposing an Agent conversation UI or
touching the Pi runtime.

### Work

- Add exact `@deepseek-ai/cordis@4.0.1`, Loader `1.0.2`, Include `1.0.6`, Group `1.0.1`, HMR `1.0.16`,
  and lockfile entries.
- Add a trusted built-in plugin catalog, closed config schemas, composition revision, and Loader boot
  coordinator; config cannot name arbitrary modules.
- Implement candidate/settle/commit, last-good rollback, serialized/coalesced refresh, exact-file
  watching, shutdown drain, and activation audit.
- Add a minimal file-backed prompt contribution fixture proving successful content refresh and
  invalid-edit rollback without a model call.
- Create a minimal Main test Context and worker test Context.
- Implement safe Fiber/effect/plugin inventory projection directly from the live registry.
- Define correlation and trace-identifier contracts plus the AsyncLocalStorage propagation helper.
  The span model, sinks, and trace UI are deferred (see target architecture section 19.1).
- Add runtime-invariant companion discovery and one request/composition invariant fixture.
- Add import-boundary enforcement.
- Add Cordis conformance tests for dependency activation, provider replacement, isolate realms,
  event modes, async effects, partial boot, teardown, failure containment, Loader entry rollback,
  Group rollback, Include candidate commit, rapid refresh coalescing, and watcher disposal.
- Verify Cordis package contents in unpacked application output.

### Explicitly excluded

- No new worker entrypoint.
- No Cordis session tables.
- No engine selector.
- No model call.
- No product tool.
- No JavaScript/TypeScript module HMR in production.
- No arbitrary user module/package resolution.

### Exit gate

- Conformance tests freeze every substrate behavior listed in target architecture section 21.
- A valid prompt edit advances composition revision; an invalid edit keeps the previous contribution
  and reports the failed stage.
- Correlation identifiers propagate across AsyncLocalStorage boundaries in fixtures; their loss or
  absence never changes fixture outcomes or disposal.
- Pi Agent tests and E2E behavior are unchanged.
- `check:fast`, focused Electron tests, `check:package`, and packaged hybrid smoke pass.
- Dependency scan proves no DeepSeek Harness Agent package was added.

### Rollback

Remove the isolated Cordis substrate and dependencies; no project data exists yet.

## 6. Stage R2 — independent process skeleton and engine shell

### Objective

Establish all three Cordis process contexts and allow the UI to select an unavailable/diagnostic
Cordis engine without sharing the Pi runtime.

### Work

- Add `cordis-agent-worker` Electron utility-process entry.
- Define Cordis Host Protocol v1 envelopes, correlation, cancellation, capability epoch, and errors.
- Add Main Cordis root/project Context and worker root/project realm.
- Add Renderer Cordis client root with only sanitized preload services.
- Add new `cordis-agent:*` channels and preload namespace.
- Add engine-tagged shell/session handle and default-engine setting.
- Keep Cordis hidden behind an experimental availability gate until it can create a session.
- Add read-only Cordis diagnostics showing process composition revision, plugin entry state,
  unsatisfied dependencies, and last reload result.
- Propagate correlation/trace identifiers across Renderer/Main/worker test commands and assert they
  survive malformed-message and late-message paths without recording private payloads. No span
  model, sink, or trace UI is built in this stage.
- Extract the existing Agent panel behind the shell's opaque engine entry so engine routing works
  without changing legacy behavior.
- Add boot, shutdown, worker crash, capability revocation, and late-message tests.

### Isolation gate

- The existing `agent:*` channels and `agent-worker` remain byte-for-byte behaviorally unchanged.
- The Cordis worker cannot access a project path or database.
- Renderer bundles contain no Cordis Main/worker implementation, no Loader/Include/Group/HMR
  packages, and no Node authority.
- No shared event/session/run type exists between panels.

### Verification

- Host protocol property tests and malformed-message tests.
- Repeated open/close/reopen leak test.
- Worker crash/restart and partial-boot cleanup tests.
- Cross-process trace-parent and disposal tests.
- Renderer IPC sender authorization tests.
- `check:electron`, fresh critical E2E, and `check:package`.

### Rollback

Set the Cordis availability gate false and remove its independent process/shell branch. Pi remains
unchanged.

## 7. Stage R3 — Cordis durable conversation vertical slice

### Objective

Create a Cordis session, send one text request, stream one assistant response, reopen the project,
and reconstruct the exact request without any project tool.

### Work

- Add `cordis_sessions`, `cordis_events`, `cordis_payloads`, request snapshot, and projection tables.
- Implement Main session/payload/request-store plugins.
- Implement worker session-log bridge and local session replica.
- Implement `writellm.agentRegistry`, default `agentLoop`, `systemPrompt`, `llm`, token meter, and
  controlled provider transport seams.
- Persist full `request/header` snapshots with composition revision and ordered prompt/context/tool
  contributor manifests.
- Implement at least one production provider adapter without Pi imports.
- Persist turn/step/message/request/chunk/run lifecycle events.
- Build a separate Cordis conversation panel with create/list/open/archive/restore/send/stop.
- Add the first read-only request trajectory: exact prompt and tool schema, contributor list and
  changes, provider attempt, token usage, TTFT/decoding, and durable commits, correlated across
  processes by trace identifiers (no span tree yet).
- Reconstruct projections after project reopen and after deleting projection caches.

### Required behavior

- Main commits user input before provider network I/O.
- Main commits request snapshot before provider network I/O.
- Assistant chunks commit before Renderer publication.
- Abort produces a durable terminal run event.
- Crash recovery closes open turn/step/run state deterministically.
- A Pi session is invisible to the Cordis query service and vice versa.

### Exit gate

- Exact normalized request reconstruction test passes.
- Request reconstruction equals the immutable provider request, and the trajectory identifies every
  model-visible contributor and the active composition revision.
- Disabling or clearing local trace leaves request/event output byte-equivalent.
- Fresh and resumed Cordis conversations pass with the initial provider.
- Pi and Cordis can be selected independently in one project.
- No tool or mutation capability is exposed yet.
- Migration backup/integrity/recovery, Electron tests, E2E, and package gate pass.

### Rollback

Switch default to Pi and disable Cordis session creation. Cordis tables may remain inert until a
forward cleanup migration; no Pi data is touched.

## 8. Stage R4 — engine-neutral Main product authority

### Objective

Remove Pi-specific identity from product collaboration and proposal authority without merging the
two Harness runtimes.

### Work

- Introduce the closed `AgentOrigin` engine tag.
- Extract engine-neutral Main service definitions for proposals, review issues, writing tasks,
  model audit, and Agent-originated assets/revisions.
- Replace `mutation_proposals` with `writing_change_proposals`, preserving IDs, decisions, applied
  results, refresh chains, and task correlation.
- Replace Pi-only foreign keys in Review Issues, Writing Tasks, model requests, and asset variants
  with engine-tagged product origins or engine-neutral proposal references.
- Add Agent engine discriminator to product revision/asset origin records.
- Migrate existing product rows once as `pi-legacy`.
- Update the legacy Pi Main adapters to call the new product services.
- Do not change Pi worker, loop, session events, or Renderer transcript.

R4 has the largest blast radius of the transition: it migrates live product tables while Pi is the
production engine. It carries no Cordis dependency and may be scheduled independently — including
before R1 — to shrink later coupling; whenever it runs, its backup, integrity, and recovery gates
plus the full Pi regression suite are the release criteria.

### No-compatibility rule

This is a hard product-authority cutover, not dual write:

- one migration moves current product proposal/task/review origin data;
- after the migration, only the new engine-neutral services write those product records;
- no shadow legacy proposal table remains writable;
- no Cordis session/event data is created from Pi rows.

### Exit gate

- All current Pi proposal, approval, undo, refresh, batch, review issue, writing task, image, and
  project-reopen tests pass against the generalized product services.
- Foreign-key and integrity checks pass on every recovery fixture.
- A synthetic Cordis origin can create/query an inert proposal fixture without a Cordis run.
- No Harness runtime imports the other's types.
- Full Electron and package gates pass because project schema changed.

### Rollback

Forward recovery restores the pre-migration project backup. There is no live dual-schema fallback.

## 9. Stage R5 — Cordis context, reads, Skills, and deterministic checks

### Objective

Reach complete read-only/context parity before enabling any Cordis mutation.

### Plugins and tools

- prompt policy and typed dynamic blocks;
- named/scoped prompt sections, variables, complete-provider exclusivity, and deterministic ordering;
- source-attributed durable runtime-context contributors rather than hidden dynamic prompt mutation;
- file-backed instructions and Writing Skills with next-step activation and last-good reload;
- context planner and immutable writing snapshot service;
- automatic bounded context and exact model limits;
- `get_writing_context`;
- `read_outline`;
- `read_section`;
- `search_manuscript`;
- `search_knowledge`;
- `read_citations`;
- `read_writing_skill`;
- `inspect_change` in read-only form;
- `check_draft`;
- tool restriction, argument validation, result bounds, parallel classification, timeouts, and
  presentation metadata.

### Required parity

- Current request is never recursively truncated.
- Knowledge and manuscript content remain untrusted data.
- Skill selection/read barrier and reference limits remain enforced.
- Canonical section reads and source snapshot IDs bind later mutation eligibility.
- Read tools can run in parallel only when classified safe.
- Every result is persisted and reconstructable before model continuation.
- Every request header records prompt/context/tool contributor identity, revision, order, and hashes.
- Reloaded content affects only the next step; an invalid edit cannot change the active generation.

### Exit gate

- Contract tests cover valid, invalid, stale, oversized, cancelled, unauthorized, and provider-error
  paths for every read tool.
- The existing Agent E2E scenarios are inventoried and re-expressed as engine-parameterized product
  scenarios that run against both engines wherever the behavior is engine-neutral.
- Side-by-side golden scenarios compare product facts, not Pi event shapes.
- Cordis remains unable to create a proposal or mutate product state.
- Full read-only Agent E2E passes after project reopen and worker restart.

### Rollback

Disable Cordis engine selection. Read-only product state has no external effects beyond its own
session log and model audit.

## 10. Stage R6 — Cordis collaboration, proposals, approval, and image generation

### Objective

Complete all product-changing tools through engine-neutral Main authority.

### Plugins and tools

- `list_review_issues`, `record_review_issues`, `update_review_issues`;
- `get_writing_task`, `create_writing_task`, `update_writing_task`;
- `submit_brief_change`;
- `submit_writing_rules_change`;
- `submit_outline_change`;
- `submit_section_change`;
- `generate_image`;
- approval policy and interactive pause/resume;
- proposal inspect, refresh, reject, apply, undo, and change-set batch projection.

### Required behavior

- Model arguments never select authoritative database IDs or versions that Main must bind.
- Every proposal records Cordis origin and immutable source snapshot.
- Manual, Write Auto, and YOLO behavior is truthful and current-policy based.
- Policy plugins can tighten but never loosen approval.
- Stale or conflicting changes fail without partial unrecorded mutation.
- Image generation remains a background-worker job and produces one bounded asset/proposal result.
- Review Issue and Writing Task transitions retain optimistic version and state-machine checks.
- Product mutation commits reconcile to Cordis durable events through transaction/outbox semantics.

### Exit gate

- Every current mutation/collaboration feature has Cordis unit, Main transaction, recovery, IPC,
  Renderer, and E2E coverage.
- A Pi and a Cordis proposal can coexist and are distinguishable by origin engine.
- Concurrent proposals from both engines resolve through the same optimistic product rules, not a
  shared runtime lock.
- Project close, approval cancellation, worker crash, image job failure, and outbox replay leave no
  half-applied state.
- Full Electron, all recovery fixtures, E2E, and package gates pass.

### Rollback

Set default back to Pi and disable new Cordis runs. Already committed product changes remain ordinary
authoritative project history; they are not rolled back merely because the initiating engine is
disabled.

## 11. Stage R7 — complete operational and UI parity

### Objective

Remove every remaining reason a real user must choose Pi for normal WriteLLM Agent work.

### Work

- all retained provider protocol adapters with no Pi dependency;
- provider/model/thinking selection and capability clamping;
- title generation and fallback;
- queue, steer, follow-up, delete, and consumption barrier;
- automatic and manual compaction with deterministic fallback;
- current task/step correlation and Resume behavior;
- project activity and attention projections;
- proposal review and change-set batch UI;
- live partial rendering, replay paging, tool cards, error/retry, archive/restore;
- complete Cordis Agent settings and diagnostics;
- trusted built-in plugin enable/disable/reconfigure controls with clear last-good rollback state;
- production-ready trajectory inspector with paging, search, folding, timing, prompt/tool diffs,
  nested calls, policy/approval entries, retention controls, and export disclosure (the span-trace
  inspector remains a deferred decision per target architecture section 19.1);
- optional external telemetry backend only after explicit consent and fail-closed redaction;
- accessibility, responsive layout, and keyboard behavior matching product requirements.

### Provider gate

Every Agent protocol still advertised in provider settings must have a Cordis adapter and focused
stream/tool/usage/retry tests. A protocol may be removed only by a separate user-approved product
decision. Unsupported routes fail before run creation and never fall back to Pi.

### Exit gate

- The feature parity matrix in section 15 is complete.
- All twenty tools pass end-to-end with zero legacy runtime import.
- Queue ordering is proven at provider-request order, not only UI order.
- Exact request reconstruction passes across compaction and provider switching.
- Full Electron suite, all recovery fixtures, all fresh Real-Electron scenarios, accessibility,
  visual inspection, and cross-platform package gates pass.

### Rollback

Change the default engine to Pi. Cordis sessions remain independently readable when the engine is
re-enabled.

## 12. Stage R8 — Cordis default and deletion qualification

### Objective

Make Cordis the default for new sessions while retaining Pi as an explicit fallback only long enough
to gather deletion evidence.

### Work

- Set `agent.defaultEngine = 'cordis'` for new installations and migrations.
- Keep the engine selector and legacy Pi panel visible but label Pi as legacy.
- Run both clean-install and upgraded-project matrices.
- Exercise real provider, long conversation, compaction, all proposal kinds, image generation,
  interruption, project reopen, worker crash, and packaged upgrade scenarios.
- Produce a deletion inventory with import, dependency, channel, table, migration, test, package, and
  documentation references.
- Produce an archival export design for users who need a static copy of Pi transcripts.

### Deletion qualification gate

Pi deletion may be proposed only when:

- Cordis is the default and all parity rows are complete;
- no accepted workflow requires selecting Pi;
- every built-in advertised provider used by Agent has a Cordis implementation or approved removal;
- no P0/P1 Cordis correctness, data-loss, security, or recovery defect remains;
- repeated project-close and worker-crash tests show no leaked effects or half-commits;
- upgraded project fixtures retain product proposals, revisions, tasks, reviews, and assets;
- all supported packaged targets pass;
- the exact Pi deletion diff has been reviewed before execution;
- the user explicitly authorizes destructive legacy-data handling.

### Rollback

Set the default back to Pi. No data conversion is required.

## 13. Stage R9 — delete Pi

### Objective

Reach the final single-engine Cordis architecture with no Pi runtime dependency or compatibility
surface.

### Work

1. Build and verify project backups plus optional static Pi transcript export.
2. Remove Pi from engine selection and disable creation/start commands.
3. Remove the legacy Renderer panel, state, replay, subscriptions, and IPC calls.
4. Remove legacy Main Agent session/loop/context/prompt/compaction/queue orchestration.
5. Remove `agent-worker`, `AgentModelClient`, Pi runtime/provider adapters, and worker protocol.
6. Remove old shared Agent runtime contracts and channels when no product consumer remains.
7. Remove `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` from manifest and lockfile.
8. Remove TypeBox if the dependency graph proves it is unused.
9. Remove the `pi-legacy` shell branch and make Cordis the sole Agent feature.
10. Apply the separately authorized forward migration for legacy Pi session/run/event tables, or
    retain them read-only for one explicitly bounded archival checkpoint if the user chooses that
    alternative.
11. Remove legacy tests and replace any product-level coverage they uniquely owned.
12. Update architecture, ADR supersession notes, current plan, tracker, history, packaging inventory,
    diagnostics, and recovery fixtures.

### Non-negotiable proof

Repository-wide searches must show:

```text
0 runtime imports of @earendil-works/pi-agent-core
0 runtime imports of @earendil-works/pi-ai
0 legacy agent-worker entrypoints
0 Pi session/run/event IPC channels used by the product
0 Pi session/event SQL used by the product
0 Pi engine branches in Renderer
```

Scans target the Pi session/run/event runtime surface, not every identifier with an `agent` prefix.
Engine-neutral platform survivors are excluded explicitly: the app-level `agent_*` preference,
catalog, and skill tables; the approval-mode app settings channels; the provider preset/credential
channels; and platform code with Pi-era names. A neutralization rename list maintained during
R4-R7 keeps the final scan free of false positives.

Historical migrations and frozen documents may still contain old names as history; executable
product and package graphs may not.

### Final gate

- frozen install succeeds with no Pi packages;
- `check:fast`, full Electron tests/build, all recovery fixtures, all E2E, package gates for every
  supported platform, native-module checks, ASAR/resource inventory, and packaged smoke pass;
- clean install, upgrade from a Pi-era project, backup restore, static export, and destructive
  cutover recovery are verified;
- project database integrity passes before and after the cutover;
- no compatibility adapter or dead code remains;
- user explicitly accepts final deletion evidence.

### Rollback

There is no code-level fallback after this stage. Recovery restores the complete pre-cutover
application build and project backup. This is why R9 is independently authorized and destructive
data handling is not bundled into R8.

## 14. Verification matrix

| Boundary | Focused gate | Full gate before stage completion |
| --- | --- | --- |
| Cordis lifecycle | conformance/unit tests | Electron suite + package |
| Composition/reload | candidate/rollback/coalescing/disposal tests | invalid-edit and packaged watcher E2E |
| Host protocol | schema/property/cancellation tests | Electron + E2E + package |
| Project migrations | in-memory migration and recovery fixtures | all fixtures + package |
| Session log | append/replay/reconstruction tests | reopen/crash E2E |
| LLM adapters | recorded stream/error/usage fixtures | real configured-provider smoke where authorized |
| Tools | contract + Main authority tests | twenty-tool E2E matrix |
| Proposals | transaction/refresh/undo/outbox tests | review/apply/reopen E2E |
| Renderer | component/accessibility tests | fresh Real-Electron + screenshots |
| Trajectory/correlation | reconstruction, attribution, privacy, correlation-loss tests | cross-process timing/debug E2E |
| Worker disposal | leak/crash/capability tests | repeated packaged close/reopen |
| Pi deletion | repository/dependency/import scan | full release-equivalent unsigned package matrix |

Routine stages do not run signed release verification unless separately authorized.

## 15. Feature parity matrix

R8 cannot start until every row is complete in Cordis:

| Area | Required evidence |
| --- | --- |
| Session lifecycle | create/list/open/archive/restore/title/reopen |
| Run lifecycle | start/stream/stop/fail/retry/interruption/recovery |
| Engine switching | independent session ownership and subscriptions |
| Provider routing | every retained protocol, model limits, thinking, usage |
| Prompt/context | named attribution, precedence, escaping, budget, current snapshot, next-step reload |
| Composition | inventory, dependency diagnosis, trusted reconfigure, candidate rollback, last-good recovery |
| Skills | auto/explicit/none, entrypoint, references, read barrier |
| Read tools | all nine read/inspect/check tools and result bounds |
| Collaboration tools | Review Issues and Writing Tasks state machines |
| Proposal tools | Brief, Writing Rules, outline, section, image |
| Approval | Manual, Write Auto, YOLO, live switch, cancel, resume |
| Queue | enqueue, steer, delete, consume order, clear/recovery |
| Composer UX | progressive disclosure, approval shorthand, circular send action, pending follow-up queue (ADR 038-041) |
| Quick actions | catalog, composer insertion, and E2E parity with current quick-action behavior |
| Compaction | auto/manual, checkpoint, failure fallback, reconstructability |
| Proposals UI | review, reject, apply, undo, refresh, change-set batch |
| Activity UI | attention, task progress, active/paused/failed states |
| Persistence | exact request, event replay, projection rebuild |
| Debuggability | request trajectory, cross-process correlation, timing, prompt/tool diff, local retention controls |
| Security | capability revocation, IPC validation, no authority leaks |
| Packaging | Cordis worker/dependency/resources on every supported target |

## 16. Risk register

| Risk | Control |
| --- | --- |
| DeepSeek Cordis package drifts from studied source or needs a product patch | exact pin, source diff, conformance suite; pnpm `patchedDependencies` first, vendoring second, both inventoried |
| Dual-engine work becomes a permanent abstraction | no shared Harness facade; explicit R8/R9 deletion gates |
| R4 migration corrupts live product data | highest-blast-radius stage; backup, integrity, and recovery gates plus the full Pi regression suite are release criteria; independently schedulable before R1 |
| Host Protocol v1 is under-scoped | treated as the engine's axis workstream; envelope frozen early; schema, property, and cancellation tests from R2 |
| Product tables remain Pi-shaped | mandatory R4 engine-neutral authority cutover |
| Cordis framework mistaken for sandbox | unchanged Electron/Main authority and controlled bridge |
| Async plugin teardown leaks work | effect ownership, quiescence tests, project-close gate |
| Request cannot be reconstructed | persist exact request snapshot before network I/O |
| Reload changes an in-flight request or leaves a partial tree | frozen request generations, serialized candidate/commit, last-good rollback, quiescent disposal |
| Prompt injection becomes an opaque append hook | typed named contributions, deterministic scope/order, source-attributed runtime context |
| Debug tracing leaks private writing content | metadata-only spans, body references, bounded local retention, consent and fail-closed export redaction |
| Inventory drifts from actual lifecycle | project the live Loader/Fiber registry directly; do not cache a second truth |
| Provider parity stalls Pi deletion | adapter matrix is an R7/R8 gate |
| Two engines conflict on manuscript state | one optimistic Main authority and immutable source versions |
| Proposal commit and engine event diverge | same transaction or durable idempotent outbox |
| Renderer accidentally shares incompatible state | separate panels, caches, IPC namespaces, and event types |
| Legacy removal destroys needed history | verified backup and optional static export before R9 |
| Scope expands into generic coding agent | explicit tool allowlist and non-goals |

## 17. Recommended first authorization after design acceptance

Authorize only R1: the exact Cordis and allowlisted composition dependencies, trusted catalog/boot
helper, transactional reload and lifecycle conformance suite, read-only plugin inventory, local trace
contract, import-boundary test, and packaged dependency verification. R1 introduces no new Agent
session, project migration, model request, engine switch, or product tool. It validates the runtime
qualities that directly enable the intended extensibility and debugging experience before product
capability code accumulates.
