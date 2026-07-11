---
title: WriteLLM Project Task Tracker
scope: whole project
status: Active
created: 2026-07-11
last_updated: 2026-07-11
canonical_task_tracker: true
master_prd: project-prd.md
adr_register: adr/README.md
---

# WriteLLM Project Task Tracker

This is the only live task board for WriteLLM. It owns task status, current owner, dates, dependencies, blockers, and implementation evidence across every product area and initiative.

Read the [master PRD](project-prd.md) first. Read a linked initiative PRD and ADR before claiming a task. The Pi initiative's requirements live in [pi-agent-harness-prd.md](pi-agent-harness-prd.md), but its PIA task status lives here.

## Task lifecycle

| Status | Meaning |
| --- | --- |
| NOT_STARTED | Defined but not yet prioritized or still waiting for a dependency. |
| READY | Dependencies and scope are clear; one agent may claim it. |
| IN_PROGRESS | One current owner is actively working on it. |
| BLOCKED | Meaningful progress is prevented; document the blocker. |
| IN_REVIEW | Implementation and verification evidence exist; awaiting review or final validation. |
| DONE | Acceptance criteria and required evidence are recorded. |
| DEFERRED | Explicitly postponed; retain rationale and revisit condition. |
| ABANDONED | Explicitly stopped; retain rationale and any follow-up/superseding task. |

Normal delivery flow is NOT_STARTED to READY to IN_PROGRESS to IN_REVIEW to DONE. A task may move to BLOCKED, DEFERRED, or ABANDONED with an activity-log entry.

## Claim and update protocol

1. Select exactly one READY task whose dependencies are DONE or explicitly waived.
2. Read its requirements, initiative PRD, linked ADRs, and relevant source areas.
3. Replace Current owner with the working agent/person, set Started and Updated to the current date, and set Status to IN_PROGRESS.
4. Keep work within the stated task. Create a linked follow-up task for new scope.
5. Before IN_REVIEW or DONE, record commands/tests/manual evidence or the reason a check is unavailable.
6. Update a linked ADR only when the decision-level implementation state changes; do not copy task status into the ADR.
7. Append one concise activity-log row for every status, owner, scope, or blocker change.

## Prefix registry

| Prefix | Product area |
| --- | --- |
| WLL | Project-wide governance and cross-cutting coordination |
| WKS | Workspace and local persistence |
| DOC | Manuscript structure and authoring |
| PRJ | Project brief and composition guidance |
| KNO | Knowledge ingestion, indexing, and retrieval |
| EVD | Evidence, citations, and coverage |
| GEN | Controlled LLM generation and review |
| HIS | Version history and recovery |
| CFG | Configuration and provider integration |
| SEC | Desktop security, secrets, and outbound-data governance |
| DAT | Data integrity, backups, migrations, and recovery |
| REL | Lifecycle and concurrency reliability |
| QAL | Tests, CI, packaging, and release operations |
| PER | Performance and resource governance |
| UX | Accessibility and UX resilience |
| EXP | Export contract and format support |
| PIA | Pi Agent Harness |

## Task board

| ID | Initiative | Priority | Task | Depends on | Requirements | Related ADRs | Suggested owner | Current owner | Status | Started | Updated | Evidence / blocker |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WLL-001 | WLL | P0 | Establish the master PRD, global task tracker, initiative/ADR hierarchy, and coding-agent operating rules. | — | Product governance | ADR register | Product + Engineering | Product | DONE | 2026-07-11 | 2026-07-11 | Master PRD, task tracker, documentation index, Pi initiative scope, and generic ADR rules created; local links validated. |
| WKS-001 | WKS | P1 | Establish a verified workspace-lifecycle baseline for create/open/recent/switch behavior and identify maintenance gaps without changing canonical recovery policy. | WLL-001 | WLL-FR-001; WLL-NFR-003; WLL-NFR-004 | New ADR if behavior/policy changes | Main process + QA | — | NOT_STARTED | — | 2026-07-11 | Record current behavior, tests/manual evidence, failure cases, and follow-up tasks; DAT owns backup/recovery architecture. |
| DOC-001 | DOC | P1 | Establish an authoring and manuscript-structure baseline for nested sections, ordering, Markdown save/render, citation navigation, and current UX limitations. | WLL-001 | WLL-FR-002; WLL-FR-003; WLL-NFR-006 | New ADR if workflow changes | Renderer + Main process + QA | — | NOT_STARTED | — | 2026-07-11 | Record acceptance evidence and split material gaps into follow-up tasks; do not treat lower-level content-node APIs as a shipped UX without proof. |
| PRJ-001 | PRJ | P2 | Establish Project Brief behavior, review, persistence, and composition-guidance baseline evidence. | WLL-001 | WLL-FR-004; WLL-NFR-008 | New ADR if workflow/data model changes | Renderer + Main process + QA | — | NOT_STARTED | — | 2026-07-11 | Verify author-approved suggestion flow, durable edits, and context behavior; create scoped follow-ups for gaps. |
| KNO-001 | KNO | P1 | Establish knowledge ingest, indexing, retry, source inspection, and retrieval-provenance baseline evidence with representative local fixtures. | WLL-001 | WLL-FR-005; WLL-NFR-005; WLL-NFR-008 | New ADR if ingestion/retrieval architecture changes | Main process + QA | — | NOT_STARTED | — | 2026-07-11 | Cover supported source types, job failure/retry, reindex/delete, source identity, and bounded-resource gaps; SEC owns external-data policy. |
| EVD-001 | EVD | P1 | Establish citation navigation and evidence-coverage baseline evidence, including clear author-facing limitations. | WLL-001 | WLL-FR-006; WLL-NFR-006 | New ADR if evidence contract changes | Renderer + Main process + QA | — | NOT_STARTED | — | 2026-07-11 | Verify source resolution and coverage reporting without presenting coverage as factual proof; create follow-up tasks for gaps. |
| GEN-001 | GEN | P0 | Establish the controlled generation/review baseline and regression suite for proposal-only mutation, validation, cancel/retry, and model-setting behavior. | WLL-001 | WLL-FR-007; WLL-NFR-004; WLL-NFR-008 | ADR-0003 where PIA overlaps; new ADR if core boundary changes | Main process + Renderer + QA | — | NOT_STARTED | — | 2026-07-11 | Prove no generation directly mutates a section before author action; identify snapshot, timeout, and trace-redaction gaps for follow-up. |
| HIS-001 | HIS | P1 | Establish checkpoint/history/restore baseline evidence and define follow-up work separate from the export-format decision. | WLL-001 | WLL-FR-008; WLL-NFR-003 | New ADR if recovery policy changes | Main process + QA | — | NOT_STARTED | — | 2026-07-11 | Verify checkpoint, diff, restore, and failure behavior; EXP-001 owns the export contract decision. |
| CFG-001 | CFG | P0 | Establish provider/settings capability baseline and route security/privacy gaps to the SEC initiative. | WLL-001 | WLL-FR-009; WLL-NFR-002; WLL-NFR-008 | New ADR if provider contract changes | Main process + Renderer + Product | — | NOT_STARTED | — | 2026-07-11 | Verify public/private settings boundaries, unsupported-capability UX, and configuration error behavior; SEC-003 owns secret/data-egress implementation. |
| SEC-001 | SEC | P0 | Define the desktop threat model and ADR-backed hardening plan for BrowserWindow, navigation, IPC sender validation, runtime schemas, and preload capability boundaries. | WLL-001 | WLL-NFR-001 | New ADR required | Security + Main process | — | NOT_STARTED | — | 2026-07-11 | Must include a testable rollout plan without weakening existing context isolation/node integration protections. |
| SEC-002 | SEC | P0 | Implement and verify the accepted desktop/IPC hardening plan. | SEC-001 | WLL-NFR-001 | Determined by SEC-001 | Security + Main process | — | NOT_STARTED | — | 2026-07-11 | Security regression, IPC validation, navigation/window policy, and packaged-like smoke evidence required. |
| SEC-003 | SEC | P0 | Define and implement secret storage, redaction, outbound-data classification, consent, rotation, and local-only behavior. | SEC-001 | WLL-FR-009; WLL-NFR-002; WLL-NFR-008 | New ADR required | Security + Main process + Product | — | NOT_STARTED | — | 2026-07-11 | Must cover LLM, embedding, rerank, PDF, and related provider requests without exposing credentials to renderer/logs. |
| DAT-001 | DAT | P0 | Define backup, migration, corruption recovery, interrupted-job recovery, and DB/Markdown reconciliation policy; record ADRs and a validation fixture plan. | WLL-001 | WLL-FR-001; WLL-FR-003; WLL-FR-008; WLL-NFR-003 | New ADR required | Main process + Data | — | NOT_STARTED | — | 2026-07-11 | Must state canonical-source and recovery UX behavior before implementing destructive migration changes. |
| DAT-002 | DAT | P0 | Implement and test the accepted workspace integrity and recovery plan. | DAT-001 | WLL-FR-001; WLL-FR-003; WLL-FR-008; WLL-NFR-003 | Determined by DAT-001 | Main process + QA | — | NOT_STARTED | — | 2026-07-11 | Backups/snapshots, failure recovery, and migration/reconciliation fixtures required. |
| REL-001 | REL | P0 | Define and implement lifecycle ownership for active workspace work, generation/ingest cancellation, shutdown drain, and concurrency policy. | WLL-001 | WLL-NFR-004 | New ADR required if policy changes | Main process + QA | — | NOT_STARTED | — | 2026-07-11 | Tests must prove no stale work writes to a closed workspace and terminal states remain inspectable. |
| QAL-001 | QAL | P0 | Establish a proportionate automated quality/release baseline: test tiers, CI gates, Electron smoke, dependency review, packaged-build verification, and rollback evidence. | WLL-001 | WLL-NFR-007 | New ADR if delivery architecture changes | QA + Platform | — | NOT_STARTED | — | 2026-07-11 | Existing Bun tests/typecheck/smoke are inputs; acceptance requires documented gates and reproducible execution. PIA-017's 2026-07-11 audit leaves 30 advisories (5 high) in Vite, undici, fast-uri, Hono, and development/tooling paths; QAL-001 owns triage, upgrade/mitigation, and release-gate evidence. |
| PER-001 | PER | P1 | Define performance/resource budgets and add representative measurement/limit coverage for workspace state, ingest, archives, retrieval, generation, and export. | WLL-001 | WLL-NFR-005 | New ADR if resource architecture changes | Main process + QA | — | NOT_STARTED | — | 2026-07-11 | Include source/archive limits, cancellation, and measurable targets before scalability claims. |
| UX-001 | UX | P1 | Audit and improve accessibility and UX resilience across primary author journeys. | WLL-001 | WLL-FR-003; WLL-FR-006; WLL-FR-007; WLL-NFR-006 | New ADR if workflow changes | Renderer + QA | — | NOT_STARTED | — | 2026-07-11 | Cover keyboard/focus, screen-reader/status, error boundary, retry/offline states, and destructive-action UX. |
| EXP-001 | EXP | P1 | Resolve the export contract: implement true LaTeX export or rename/re-scope the current Markdown export honestly, with tests and user-facing documentation. | WLL-001 | WLL-FR-008 | New ADR required | Main process + Product | — | NOT_STARTED | — | 2026-07-11 | Export label, extension, content, and help must agree. |
| PIA-001 | PIA | P0 | Confirm exact Electron, Node, Pi, native-module compatibility, feature flag, and rollback plan; record selected target versions and upgrade risk. | — | WLL-FR-010; PIA-FR-014 | ADR-0006, ADR-0007 | Platform | Codex | DONE | 2026-07-11 | 2026-07-11 | ADR-0006 accepts exact Electron 37.6.0 (embedded Node 22.19.0) and exact Pi Core 0.80.3; npm metadata verified the `>=22.19.0` engine, MIT license, and direct-dependency baseline. ADR-0007 defines local `agent.enabled`, default false, plus staged rollback. |
| PIA-002 | PIA | P0 | Upgrade Electron to the selected compatible line and rebuild better-sqlite3. | PIA-001 | WLL-FR-010; PIA-FR-014 | ADR-0006 | Platform | Codex | DONE | 2026-07-11 | 2026-07-11 | Installed exact Electron 37.6.0; `ELECTRON_RUN_AS_NODE=1` reports Node 22.19.0. `bun run rebuild:native`, `bun run typecheck`, `bun run build`, and `bun run test:smoke` all passed. |
| PIA-003 | PIA | P0 | Add exact reviewed Pi Core dependency and document direct/transitive dependency review. | PIA-002, PIA-017 | WLL-FR-010; PIA-NFR-008 | ADR-0001, ADR-0010 | Platform | Codex | DONE | 2026-07-11 | 2026-07-11 | Installed exact Pi Core 0.80.3. Bun lock resolves Pi AI 0.80.6 plus Core's reviewed direct dependencies; 77 transitive packages were reviewed, prohibited Pi coding-agent/deprecated packages are absent, and untrusted scripts remain blocked. Electron 40 main import, unit tests, typecheck, build, and smoke passed; QAL-001 owns the remaining audit advisories before release. |
| PIA-004 | PIA | P0 | Spike and select a Pi model/stream adapter that preserves current provider settings, cancellation, tool calls, and testability. | PIA-003, SEC-003 | WLL-FR-009; WLL-FR-010; PIA-FR-001 to PIA-FR-003; PIA-FR-011; PIA-NFR-001 to PIA-NFR-008 | ADR-0001, ADR-0005 | Main process | — | NOT_STARTED | — | 2026-07-11 | Decision record plus focused proof of one tool-call round with a compatible endpoint or deterministic fake; must follow the accepted outbound-data/secret policy. |
| PIA-005 | PIA | P1 | Define schema/migration and typed records for agent sessions, runs, events, and tool calls. | PIA-001, DAT-001 | WLL-NFR-008; PIA-FR-008 to PIA-FR-012; PIA-NFR-001 to PIA-NFR-008 | ADR-0008 | Main process | — | NOT_STARTED | — | 2026-07-11 | Migration is compatible; records redact secrets; database tests cover create/list/terminal updates and follow the accepted recovery policy. |
| PIA-006 | PIA | P1 | Implement AgentManager with bounded lifecycle, event sequencing, cancellation, and cleanup. | PIA-004, PIA-005, PIA-007, REL-001 | WLL-FR-010; WLL-NFR-004; PIA-FR-001 to PIA-FR-003; PIA-FR-008 to PIA-FR-012; PIA-NFR-001 to PIA-NFR-008 | ADR-0001, ADR-0002, ADR-0005, ADR-0008, ADR-0009 | Main process | — | NOT_STARTED | — | 2026-07-11 | Deterministic test completes, errors, cancels, and persists terminal run state without direct mutation; must implement the shared lifecycle policy. |
| PIA-007 | PIA | P1 | Implement scoped tool facade, validation, output caps, prompt-injection guidance, and default budgets. | PIA-001, SEC-001 | WLL-FR-010; PIA-FR-004; PIA-FR-005; PIA-FR-013; PIA-NFR-001 to PIA-NFR-008 | ADR-0004 | Main process / Security | — | NOT_STARTED | — | 2026-07-11 | Only MVP tool list is reachable; policy tests prove forbidden operations cannot be called and comply with the accepted desktop threat model. |
| PIA-008 | PIA | P2 | Bridge agent output to the existing proposal/patch/validator flow without duplicating write logic. | PIA-006 | WLL-FR-007; WLL-FR-010; PIA-FR-006; PIA-FR-007; PIA-FR-013; PIA-NFR-001 to PIA-NFR-008 | ADR-0003, ADR-0004 | Main process | — | NOT_STARTED | — | 2026-07-11 | Valid proposal yields the same reviewable patch semantics; invalid/stale output is blocked or warned by existing validation. |
| PIA-009 | PIA | P1 | Add shared agent run/event types and all IPC, preload, and renderer API surfaces. | PIA-006, SEC-002 | WLL-NFR-001; PIA-FR-001 to PIA-FR-003; PIA-FR-008 to PIA-FR-012; PIA-NFR-001 to PIA-NFR-008 | ADR-0002, ADR-0008 | Main + Renderer | — | NOT_STARTED | — | 2026-07-11 | Typecheck proves contract is wired consistently; renderer cannot access raw main services and the accepted IPC hardening is enforced. |
| PIA-010 | PIA | P2 | Extend generation/review UI with agent timeline, evidence display, patch review, cancellation, and error states. | PIA-008, PIA-009 | WLL-FR-007; WLL-FR-010; WLL-NFR-006; PIA-FR-001 to PIA-FR-003; PIA-FR-006; PIA-FR-007; PIA-FR-009; PIA-FR-012; PIA-NFR-001 to PIA-NFR-008 | ADR-0003, ADR-0007, ADR-0009 | Renderer | — | NOT_STARTED | — | 2026-07-11 | Manual UI flow supports start, trace, review, reject/apply, section-busy/steer/follow-up states; keyboard and error states are covered. |
| PIA-011 | PIA | P2 | Add workspace-switch, shutdown, one-active-run-per-section, timeout, and retry safeguards. | PIA-006, PIA-009, REL-001 | WLL-NFR-004; PIA-FR-008 to PIA-FR-012; PIA-NFR-001 to PIA-NFR-008 | ADR-0002, ADR-0008, ADR-0009 | Main process | — | NOT_STARTED | — | 2026-07-11 | Tests show no run survives against a closed workspace and no duplicate active section run occurs; behavior must match the shared lifecycle policy. |
| PIA-012 | PIA | P2 | Add deterministic unit/integration tests and fixture scenarios for tool policy, retrieval, cancellation, stale patches, and persistence. | PIA-008, PIA-009 | WLL-NFR-007; PIA-FR-004; PIA-FR-005; PIA-FR-008 to PIA-FR-013; PIA-NFR-001 to PIA-NFR-008 | ADR-0002, ADR-0003, ADR-0004, ADR-0005, ADR-0008, ADR-0009 | QA / Main process | — | NOT_STARTED | — | 2026-07-11 | Tests run without provider credentials and cover all Must requirements. |
| PIA-013 | PIA | P3 | Add an Electron smoke scenario for the evidence-grounded vertical slice. | PIA-010, PIA-011, PIA-012 | WLL-NFR-007; PIA-FR-006; PIA-FR-007; PIA-NFR-001 to PIA-NFR-008 | ADR-0003 | QA | — | NOT_STARTED | — | 2026-07-11 | Smoke test verifies trace, no direct write, and human-reviewed patch lifecycle. |
| PIA-014 | PIA | P3 | Build the evaluation corpus, run pilot cases, define usefulness threshold, and resolve release blockers. | PIA-013 | WLL-FR-010; PIA release gates | ADR-0003, ADR-0004 | Product + QA | — | NOT_STARTED | — | 2026-07-11 | Release-gate evidence is recorded; only non-blocking findings become follow-up tasks, while Must-requirement gaps or P0 blockers keep PIA-014 incomplete. |
| PIA-015 | PIA | P3 | Update user-facing help and engineering guidance after implementation decisions are stable. | PIA-014 | WLL-FR-010; WLL-NFR-008 | ADR register | Product + Engineering | — | NOT_STARTED | — | 2026-07-11 | Documentation matches actual permission model, supported providers, limits, and recovery behavior. |
| PIA-016 | PIA | P3 | Implement and rehearse the feature-flag rollout and rollback path. | PIA-010, PIA-011, PIA-013 | WLL-FR-010; PIA-FR-014 | ADR-0010, ADR-0007 | Platform + QA | — | NOT_STARTED | — | 2026-07-11 | Flag disables new runs safely, leaves history readable, and rollback rehearsal evidence is recorded on the supported runtime. |
| PIA-017 | PIA | P0 | Replace the superseded Electron 37.6.0 runtime with the selected supported, patched Electron line and repeat native/runtime verification. | PIA-002 | WLL-FR-010; WLL-NFR-001; WLL-NFR-007; PIA-NFR-008 | ADR-0010 | Platform | Codex | DONE | 2026-07-11 | 2026-07-11 | Exact Electron 40.10.5 / Node 24.15.0 and better-sqlite3 12.11.1 installed. Native rebuild, typecheck, build, Electron smoke, and main-process Pi import passed; repeat audit removed the direct Electron advisory. Remaining 30 audit findings are assigned to QAL-001. |

## Activity log

| Date | Task | Owner | Change | Verification / blocker |
| --- | --- | --- | --- | --- |
| 2026-07-11 | WLL-001 | Product | Created project-wide planning hierarchy and global tracker. | Master PRD, tracker, docs index, initiative routing, and ADR rules linked locally. |
| 2026-07-11 | WKS-001 through EXP-001 | Product | Added baseline-evidence tasks for every existing product area plus P0/P1 cross-cutting hardening tasks. | No new implementation is claimed; tasks remain NOT_STARTED pending prioritization. |
| 2026-07-11 | PIA-* | Product | Migrated Pi task ownership/status authority from the initiative PRD into this global tracker without changing IDs, dependencies, or acceptance criteria. | PIA-001 remains the only READY Pi task; all other PIA tasks retain their prior initial state. |
| 2026-07-11 | PIA-004 through PIA-011 | Product | Added SEC, DAT, and REL task gates to Pi model, persistence, lifecycle, tool, and IPC work. | Pi work must follow project-wide security, recovery, outbound-data, and lifecycle decisions. |
| 2026-07-11 | PIA-006, PIA-010 through PIA-012 | Product | Added ADR-0009 to define the MVP section-level agent-run lock for whole-section and selection requests. | No competing active run may target the same section; implementation remains NOT_STARTED. |
| 2026-07-11 | PIA-001 | Codex | Claimed runtime compatibility and rollout decision. | Electron 37.6.0 embeds Node 22.19.0; selected Pi Core 0.80.3 is exact-pinned for the subsequent dependency task. |
| 2026-07-11 | PIA-001 | Codex | Completed the runtime and feature-flag decision; promoted PIA-002 to READY. | Electron 37.6.0 release metadata confirms embedded Node 22.19.0; Pi Core 0.80.3 npm metadata confirms engine `>=22.19.0`, MIT license, and direct dependencies `yaml`, `ignore`, `typebox`, and Pi AI. |
| 2026-07-11 | PIA-002 | Codex | Claimed Electron/native-module upgrade. | ADR-0006 implementation roll-up moved to IN_PROGRESS; Pi dependency remains out of scope until runtime proof passes. |
| 2026-07-11 | PIA-002 | Codex | Completed Electron 37.6.0 upgrade; promoted PIA-003 to READY. | `ELECTRON_RUN_AS_NODE=1` reported Electron 37.6.0 / Node 22.19.0; native rebuild, typecheck, build, and Electron smoke passed. |
| 2026-07-11 | PIA-003 | Codex | Claimed the exact Pi Core dependency and supply-chain review. | ADR-0001 implementation roll-up moved to IN_PROGRESS; the coding-agent CLI and Pi dynamic resource loaders remain prohibited. |
| 2026-07-11 | PIA-003 | Codex | Installed and reviewed exact Pi Core 0.80.3, then blocked final acceptance on a runtime security finding. | Electron main-process import succeeded; no Pi coding-agent package is in the manifest/lockfile. Bun kept `@google/genai` and `protobufjs` scripts blocked. `bun audit` reports Electron <38.8.6 high findings, so ADR-0010 / PIA-017 supersede the 37.6.0 decision before final dependency proof. |
| 2026-07-11 | PIA-017 | Product + Engineering | Added the patched-runtime remediation task after the PIA-003 dependency audit. | ADR-0010 selects Electron 40.10.5 with Node 24.15.0; PIA-003 waits for its verification evidence. |
| 2026-07-11 | PIA-017 | Codex | Claimed the supported patched-runtime upgrade. | ADR-0010 implementation roll-up moved to IN_PROGRESS; PIA-003 remains blocked until its runtime proof is repeated. |
| 2026-07-11 | PIA-017 | Codex | Found better-sqlite3 11.10.0 incompatible with Electron 40's Node 24 V8 headers; selected an exact compatible native-module upgrade. | better-sqlite3 12.11.1 declares Node 20–26 support, MIT license, and only `bindings` / `prebuild-install` runtime dependencies; no workspace schema or data migration is included in this task. |
| 2026-07-11 | PIA-017 | Codex | Completed supported Electron/native runtime remediation; unblocked PIA-003. | Electron main process reports 40.10.5 / Node 24.15.0 and imports Pi Core; better-sqlite3 12.11.1 rebuild, typecheck, build, and smoke passed. A repeat audit removed the direct Electron finding; QAL-001 owns the remaining 30 advisories. |
| 2026-07-11 | PIA-003 | Codex | Resumed exact Pi Core dependency review after PIA-017 verification. | Electron 40.10.5 / Node 24.15.0 imports Pi Core successfully; final lockfile and prohibited-component evidence is being recorded. |
| 2026-07-11 | PIA-003 | Codex | Completed exact Pi Core dependency and supply-chain review. | Exact Core 0.80.3 loads as `Agent` in Electron 40.10.5 / Node 24.15.0; no coding-agent/deprecated Pi package is locked, and untrusted scripts were not run. `bun test` (28), typecheck, build, and smoke passed. QAL-001 owns the remaining 30 audit findings before release. |
