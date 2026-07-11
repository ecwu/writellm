---
title: WriteLLM Master Product Requirements Document
product: WriteLLM
scope: whole project
status: Active
owner: Product and Engineering
created: 2026-07-11
last_updated: 2026-07-11
canonical_product_prd: true
canonical_task_tracker: task-tracker.md
adr_register: adr/README.md
---

# WriteLLM Master Product Requirements Document

## 1. Purpose and planning hierarchy

This is the whole-product PRD for WriteLLM. It defines the product vision, user value, requirements, quality bar, initiative portfolio, and cross-initiative priorities. It is the first planning document a coding agent must read before changing the project.

| Document | Canonical responsibility | Must not duplicate |
| --- | --- | --- |
| This master PRD | Product vision, global requirements, product boundaries, initiative portfolio, and release gates | Per-task owner, status, dates, or implementation evidence |
| [Task tracker](task-tracker.md) | Every task's status, owner, dependency, verification evidence, and activity history | Architecture rationale or a second requirements specification |
| Initiative PRD, such as [Pi Agent Harness](pi-agent-harness-prd.md) | Scoped requirements, acceptance criteria, dependency design, and requirement-to-task traceability | Live task status, owner, or activity log |
| [ADR register](adr/README.md) | Durable architectural decisions, alternatives, constraints, and decision-level implementation roll-up | Per-task progress or secret/unbounded trace data |

### Operating contract for coding agents

1. Read this master PRD before changing product code, product behavior, or product documentation.
2. Route the requested work to a product area and find its task in the [task tracker](task-tracker.md). Read the linked initiative PRD and ADRs before claiming a task.
3. The task tracker is the only place that changes a task's owner, status, dates, blocker, or verification evidence.
4. Claim exactly one READY task by recording a current owner, start date, and IN_PROGRESS status in the tracker. Do not claim blocked or unrelated work.
5. A change to permissions, data handling, runtime/dependency strategy, storage/migration, public IPC, or a user-visible workflow requires an ADR update or a new ADR.
6. Preserve scope. Create a new task or initiative PRD rather than silently expanding a task. Do not mark work DONE merely because it compiles.
7. Keep requirements, task evidence, and ADR implementation roll-ups coherent in the same change; never record credentials, raw model reasoning, or unbounded source data in planning documents.

## 2. Product vision

WriteLLM is a local-first desktop workbench for academic and other evidence-heavy long-form writing. It helps a single author turn a body of local sources and a structured manuscript plan into a controllable, reviewable, versioned document.

The product combines structured outlining, Markdown authoring, a local knowledge library, citation-aware retrieval, bring-your-own model configuration, and human-reviewed LLM assistance. The author remains the authority for document mutations, source use, outbound data sharing, and release of the finished manuscript.

### Primary users

| User | Job to be done |
| --- | --- |
| Academic author or graduate researcher | Plan a thesis or paper, synthesize local literature, write with traceable support, and recover prior versions. |
| Evidence-heavy professional writer | Produce technical, policy, or consulting material while keeping terminology, claims, and sources consistent. |
| Power user with their own model services | Configure compatible chat, embedding, rerank, vision, and PDF-processing endpoints without giving up local workspace ownership. |

### Product principles

- Local workspace first: a .writellm workspace, its SQLite data, Markdown sections, and Git history are the primary product data.
- Author control first: generated content is reviewable; it is never a silent substitute for the author's decision.
- Evidence before fluency: source provenance, citation coverage, and uncertainty must remain visible.
- Safe extensibility: additional automation is introduced through bounded, typed capabilities rather than ambient computer access.
- Honest contracts: labels, exports, privacy behavior, capability claims, and recovery behavior must match what the product actually does.

### Non-goals

- A hosted SaaS, account system, real-time multi-user editor, or cloud-sync product in the current scope.
- General computer-use, coding, shell, arbitrary filesystem, arbitrary Git, or autonomous web-research agents.
- Autonomous publication, guaranteed factual correctness, or automatic acceptance of LLM-generated document changes.
- A promise that every user-supplied model or endpoint supports every feature.

## 3. Primary author journeys

1. **Start a manuscript:** create or open a local workspace, define a project brief, build a nested outline, and establish section intent.
2. **Build a source library:** import notes or supported documents, monitor ingestion/indexing, inspect source content, and recover from a failed job.
3. **Draft with evidence:** edit a focused section, retrieve relevant local evidence, ask for a targeted revision or continuation, inspect the diff and warnings, then explicitly apply, save, or dismiss it.
4. **Audit and recover:** inspect citation coverage and source use, create Git checkpoints, compare section history, restore a prior version, and export the manuscript.
5. **Configure safely:** choose local appearance and compatible model/retrieval/PDF settings, understand external-data implications, and recover from unavailable services.

## 4. Product capability map

This map records the observed product baseline in the repository. It is not a claim that every quality requirement below is already complete.

| Area | Product outcome | Current baseline and boundary |
| --- | --- | --- |
| WKS — Workspace | An author owns a local, reopenable writing workspace. | Create/open/recent .writellm workspaces backed by SQLite, Markdown section files, and Git; one active workspace at a time. |
| DOC — Manuscript | An author can create, organize, and edit a structured long-form document. | Nested sections, intents, drag/reorder, Markdown/raw and rendered views, and autosave; lower-level content nodes/edges are platform capabilities, not a fully established end-user workflow. |
| PRJ — Project brief | The manuscript has reusable audience, terminology, argument, and structure guidance. | Project Brief editors and reviewable LLM suggestions for glossary, motivation, and framework. |
| KNO — Knowledge | An author can ingest and search local supporting material. | Manual sources plus text/Markdown/PDF ingest, background jobs, chunking, embeddings, optional rerank, retrieval traces, and reindex/retry operations. |
| EVD — Evidence | Sources and citations remain navigable and auditable. | Stable public references, editor citation navigation, source reader, citation-coverage report, and section/source matrix. |
| GEN — Assisted writing | LLM assistance produces bounded, reviewable writing proposals. | The observed baseline is a scoped rewrite/continue path with retrieval planning, streaming, legacy generation rounds, WritingPatch validation, and human Apply/Save Candidate/Reject. ADR-0012 replaces its active runtime and presentation contract with Pi Agent Core while retaining the review boundary. |
| HIS — History and export | An author can checkpoint, compare, restore, and take a portable copy of work. | Git checkpoints, section history/diff/restore, and Markdown export to exports/main.md. The current exportLatex name is not evidence of a true LaTeX exporter. |
| CFG — Configuration | An author can configure appearance and compatible local/remote services. | Local settings for chat, embedding, rerank, vision, PDF processing, retrieval, and appearance; secure secret storage and outbound-data policy remain product requirements. |
| PIA — Agent harness | Interactive writing generation gains bounded Pi multi-step orchestration. | Accepted project-wide rearchitecture; see ADR-0012 and the [Pi Agent Harness initiative PRD](pi-agent-harness-prd.md). |

## 5. Functional requirements

| ID | Priority | Requirement | Product acceptance outcome |
| --- | --- | --- |
| WLL-FR-001 | Must | Provide a local workspace lifecycle for creating, opening, and returning to a valid .writellm workspace. | The author can reliably identify the active workspace; invalid or unavailable workspaces fail clearly without silently creating conflicting data. |
| WLL-FR-002 | Must | Support a structured manuscript with ordered, nested sections and durable section intent. | Authors can create, rename, reorder, navigate, and recover the document structure without losing associated section content. |
| WLL-FR-003 | Must | Provide focused Markdown authoring with visible save/recovery behavior and citation navigation. | An author can edit a section, see rendering where applicable, navigate a recognized citation to its source, and receive a clear error if a save cannot complete. |
| WLL-FR-004 | Should | Maintain a project brief that can guide consistent terminology, motivation, framework, and composition. | Brief edits are durable; an LLM suggestion remains previewable and author-approved before it alters project guidance. |
| WLL-FR-005 | Must | Let authors ingest, inspect, retry, remove, and search local knowledge sources with source-level provenance. | Import work is observable and recoverable; results identify their source and do not fabricate a source on failure. |
| WLL-FR-006 | Must | Surface evidence and citation coverage as review aids. | The author can trace displayed references to a source and identify coverage gaps or unused material without implying that coverage proves truth. |
| WLL-FR-007 | Must | Offer controlled LLM writing assistance through a typed, reviewable proposal boundary. | No successful generation directly mutates manuscript content; validation warnings, diff, cancellation, retry, and explicit author actions remain available. |
| WLL-FR-008 | Must | Provide version recovery and an honest portable export contract. | Authors can checkpoint and restore section history; every export command and file extension accurately describes the artifact produced. |
| WLL-FR-009 | Must | Allow configurable providers and processing services while showing their capabilities and data consequences. | Unsupported capability is surfaced before work begins; settings exclude secrets from renderer-facing responses and explain external processing when enabled. |
| WLL-FR-010 | Should | Use a bounded Pi runtime for all interactive writing-generation workflows through a separately specified initiative. | Every active generation route follows the Pi initiative's tool, review, audit, budget, event-projection, and kill-switch requirements; the retired legacy generator is not an active fallback. |

## 6. Cross-cutting quality requirements

| ID | Priority | Requirement | Current planning focus |
| --- | --- | --- | --- |
| WLL-NFR-001 | Must | Maintain desktop least privilege: narrow typed IPC, hardened BrowserWindow behavior, validated public inputs, and no renderer access to privileged services. | Preserve context isolation/node integration boundaries; plan sandbox, CSP, navigation/window policy, sender checks, and runtime validation. |
| WLL-NFR-002 | Must | Protect credentials and make outbound data use explicit. | Move secrets out of plaintext settings, redact telemetry/traces, provide deletion/rotation, and add a consent/policy layer for LLM, embedding, rerank, PDF, and similar external requests. |
| WLL-NFR-003 | Must | Preserve workspace integrity, backup/recovery, and migration safety. | Define backup/snapshot, integrity-check, corruption recovery, interrupted-job recovery, and canonical-source reconciliation behavior. |
| WLL-NFR-004 | Must | Make workspace, generation, ingest, and future agent lifecycles safe under cancellation, app shutdown, and workspace switching. | Prevent stale work from writing to a closed workspace; define single-workspace/run concurrency and shutdown-drain policy. |
| WLL-NFR-005 | Should | Bound resource use and maintain responsive author workflows for realistic local libraries and documents. | Define measurable startup, save, search, first-result, export, file-size, archive, chunk, and concurrency limits before scaling claims. |
| WLL-NFR-006 | Should | Provide accessible, resilient desktop UX. | Cover keyboard/focus/screen-reader behavior, contrast/type scaling, reduced motion, destructive-action confirmation, error boundaries, and offline/retry states. |
| WLL-NFR-007 | Must | Maintain a proportionate quality and release process. | Require deterministic unit tests, IPC/integration, migration/recovery, Electron smoke, security/accessibility regression, provider evaluation, CI, packaged-build verification, and rollback evidence. |
| WLL-NFR-008 | Must | Keep diagnostics useful without leaking privacy-sensitive content. | Record local, bounded, redacted operational summaries; never persist API keys, raw settings, hidden chain-of-thought, or unnecessary source contents. |

## 7. Initiative portfolio and routing

| Prefix | Initiative or product area | Status | Detailed source |
| --- | --- | --- | --- |
| WKS | Workspace and local persistence | Baseline / maintenance | This PRD and task tracker |
| DOC | Structured manuscript and authoring | Baseline / maintenance | This PRD and task tracker |
| PRJ | Project brief and composition guidance | Baseline / maintenance | This PRD and task tracker |
| KNO | Knowledge ingestion, indexing, and retrieval | Baseline / maintenance | This PRD and task tracker |
| EVD | Evidence, citations, and coverage | Baseline / maintenance | This PRD and task tracker |
| GEN | Controlled LLM generation and review | Baseline / maintenance | This PRD and task tracker |
| HIS | History, recovery, and export | Baseline / maintenance | This PRD and task tracker |
| CFG | Provider configuration, privacy, and appearance | Baseline / maintenance | This PRD and task tracker |
| SEC | Desktop security and outbound-data governance | Planned | [Task tracker](task-tracker.md) |
| DAT | Workspace integrity and recovery | Planned | [Task tracker](task-tracker.md) |
| REL | Lifecycle and concurrency reliability | Planned | [Task tracker](task-tracker.md) |
| QAL | Quality, release, and delivery automation | Planned | [Task tracker](task-tracker.md) |
| PER | Performance and resource governance | Planned | [Task tracker](task-tracker.md) |
| UX | Accessibility and UX resilience | Planned | [Task tracker](task-tracker.md) |
| EXP | Export-contract correctness | Planned | [Task tracker](task-tracker.md) |
| PIA | Pi Agent Harness | Planning | [Initiative PRD](pi-agent-harness-prd.md) and [PIA tasks](task-tracker.md) |

### Routing rule

Use the prefix that best matches the dominant product outcome. A task that affects more than one area remains one task only when it has one clear acceptance boundary; otherwise create linked tasks with explicit dependencies. Create an initiative PRD when a body of work has its own requirements, three or more coordinated tasks, or a distinct security/architecture boundary.

## 8. Product task allocation and release gates

The [task tracker](task-tracker.md) contains the only live work board. It includes the task prefix, requirements, related ADRs, suggested/current owner, dependency, priority, status, and evidence. Product work is allocated as follows:

1. Product or engineering identifies the relevant requirement and task prefix.
2. A new task is entered as NOT_STARTED with acceptance evidence and dependencies. It becomes READY only after priority and dependencies are confirmed.
3. One agent claims one READY task. It records the owner/start date and moves the task to IN_PROGRESS.
4. The agent adds verification evidence, moves the task to IN_REVIEW or DONE, and updates any affected ADR implementation roll-up.
5. A release is not approved while a Must requirement lacks evidence, a P0 blocker remains unresolved, or a rollback/recovery requirement has not been exercised.

### Initial cross-project priority order

1. P0: security/IPC, secret and outbound-data governance, workspace integrity/recovery, lifecycle safety, and quality/release baselines.
2. P1: performance/resource governance, accessibility/resilience, and export-contract correctness.
3. Initiative-specific roadmap work, including PIA, proceeds according to its own dependencies and the global tracker.

## 9. Requirement-to-initiative traceability

| Requirement group | Primary initiative prefixes | Required evidence |
| --- | --- | --- |
| WLL-FR-001 to WLL-FR-004 | WKS, DOC, PRJ | Workspace/structure/save behavior and project-brief verification. |
| WLL-FR-005 to WLL-FR-006 | KNO, EVD | Ingest/retry/search/provenance and coverage/navigation evidence. |
| WLL-FR-007 | GEN, PIA | Proposal-only mutation boundary, validation, cancellation, and human-review evidence. |
| WLL-FR-008 | HIS, EXP, DAT | Checkpoint/restore and accurate export/recovery evidence. |
| WLL-FR-009 | CFG, SEC, PIA | Capability preflight, secret protection, outbound-data policy, and agent-adapter evidence. |
| WLL-FR-010 | PIA | Pi initiative release gates and feature-flag evidence. |
| WLL-NFR-001 to WLL-NFR-008 | SEC, DAT, REL, QAL, PER, UX, PIA | Threat model, tests, recovery, lifecycle, performance, accessibility, release, and redaction evidence. |

## 10. Open product decisions

1. What privacy/consent experience is appropriate for each type of external provider and data class?
2. What is the canonical conflict/recovery policy when SQLite state and section Markdown disagree?
3. Should true LaTeX export be implemented, or should the current export contract be renamed to Markdown only?
4. Which packaged desktop platforms, signing, update, and support matrix are in scope for the first supported release?
5. Which collaboration, sync, or sharing capabilities, if any, belong after the single-author local-first foundation is hardened?

## 11. Change history

| Date | Change | Evidence |
| --- | --- | --- |
| 2026-07-11 | Created master product PRD and established project-wide planning hierarchy. | Links to task tracker, Pi initiative PRD, and ADR register. |
| 2026-07-11 | Accepted a full Pi Agent Core rearchitecture of interactive generation and its progress presentation. | ADR-0012 supersedes the prior optional-agent/legacy-fallback scope; task tracker and Pi initiative PRD define the migration and removal work. |
