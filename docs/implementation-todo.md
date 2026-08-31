# WriteLLM Implementation Tracker

Status: Phase 28 Checkpoint 79 is complete under ADR 070; Checkpoint 77 remains
independently paused. Checkpoint 26.9 is complete. Immutable `v0.2026.8.45` run `33299058552` passed its shared
static/fixture gate and all four independent native build/upload jobs under the user's narrowed
online scope; complete Electron, E2E, and package verification passed locally before the tag.
Recorded: 2026-09-01

This is the short completion and routing index. Active delivery state lives in
[`current-plan.md`](current-plan.md); detailed plans and evidence live in the matching Phase file;
completed chronology lives in [`history/implementation-log.md`](history/implementation-log.md).

Status markers:

- `[ ]` not started
- `[~]` in progress
- `[x]` completed and verified
- `[!]` blocked or explicitly paused

## Active and paused work

- [~] Candidate `v0.2026.8.49`: verify and package the completed Reference citekey migration as a
  no-Team-ID macOS arm64 trial App, then commit, create an annotated tag, and atomically push
  `main` plus the tag to GitHub under explicit authorization.

- [x] Maintenance: migrate Citation Coverage, draft Reference availability/unused-resource checks,
  Agent Knowledge reads, publication legacy availability, and citation-click resolution to exact
  project citekeys, retaining filename/title matching only for explicit legacy citation syntax.

- [x] Maintenance build: produce and fully verify a no-Team-ID macOS arm64 trial App containing
  the Agent Reference citekey projection and exact `doc-*` source-resolution repair.

- [x] Maintenance: inject project Reference authority into Agent Knowledge reads so new evidence
  uses authoritative citekeys, and resolve earlier `doc-*` compatibility tokens only through their
  exact encoded, Reference-linked Knowledge identity.

- [x] Checkpoint 79: unify Zotero metadata and PDF attachment import around one Reference-first
  prepare/confirm flow, explicit incomplete/relink targets, and orphan-free Knowledge association.
  Authoritative detail: [`implementation-todo/phase-28.md`](implementation-todo/phase-28.md).

- [x] Checkpoint 78: stable Reference authority, one user-selected Zotero bibliography connector,
  bilingual citekeys, evidence enforcement, CSL formatting, and bibliography-aware export under
  ADR 070. Checkpoint 77 remains independently paused.

- [x] Candidate `v0.2026.8.48`: rebuild and fully verify the completed Checkpoint 78 work as a
  no-Team-ID macOS arm64 App, then commit, create an annotated tag, and atomically push `main` plus
  the tag to GitHub under explicit authorization.

- [x] Candidate `v0.2026.8.47`: rebuild and fully verify the completed Checkpoint 76.1 trace work
  as a no-Team-ID macOS arm64 App, then commit, create an annotated tag, and push `main` plus the
  tag to GitHub under explicit authorization.
- [x] Maintenance candidate `v0.2026.8.46`: align tag CI with the accepted pnpm 11.17.0 runtime,
  rebuild and fully verify the no-Team-ID macOS arm64 App, then commit, tag, and push `main` plus
  the immutable tag under explicit user authorization.
- [x] Maintenance: replace a completed or failed context-compaction start marker with its durable
  outcome while preserving the live marker across non-final rolling checkpoints.
- [x] Maintenance: preserve the exact model-call tool envelope and preflight policy reason so
  activated writing tools never surface as `unknown_tool`, collapse duplicate same-call failures,
  and route citation recovery from the evidence already gathered in the active run.
- [x] Maintenance build: produce and fully verify a no-Team-ID macOS arm64 trial App containing
  the Gemini/Vertex `read_section` compatibility and authoritative expanded section-title UI.
- [x] Maintenance: keep completed read-section activity groups collapsed by default and reveal
  only authoritative section titles in their expanded action rows, without exposing section or
  block identifiers.
- [x] Maintenance: eliminate repeated Gemini/Vertex `read_section` preflight failures by
  clarifying whole-section reads and narrowly normalizing the observed blockless canonical-read
  quirk without weakening Main validation.
- [x] Maintenance build: produce and fully verify a no-Team-ID macOS arm64 test App containing the
  Agent model-selection and generated-image lifecycle fixes.
- [x] Maintenance: terminalize generated-image proposals when post-generation publication fails
  and recover request-scoped image generations interrupted by a prior project-session lifetime.
- [x] Maintenance: synchronize application-global Agent Provider catalog changes into an open
  Agent panel and recover model selection without silently rewriting stale conversations.
- [x] Checkpoint 76: add sticky Ask, Plan, and Write ceilings, Protocol v13 exact tool enforcement,
  immutable run snapshots, and the Agent composer mode selector under ADR 068.
- [x] Checkpoint 76.1: add permanent content-addressed Agent request traces, fail-closed persistence
  acknowledgement, reconstruction views, and tool/Skill/compaction/title/image correlation under
  ADR 069.
- [!] Checkpoint 77: detailed Writing Task v2 and Plan-to-Write execution handoff; separate
  authorization required after Checkpoint 76.

- [x] Thermo-Nuclear structural remediation: remove behavior-bearing duplication, decompose the
  oversized Agent/UI/Main authorities along tested lifecycle and transaction boundaries, and
  preserve the tag-CI gate.
- [x] Thermo-Nuclear P1 maintenance: make Writing Skill publication rollback atomic, fail closed
  on unprojectable Agent tool schema roots, and bind tag-only CI to the canonical release source
  verifier.
- [x] Release maintenance: publish `WriteLLM 0.2026.8` from immutable `v0.2026.8.45` as an
  explicitly unsigned four-platform GitHub Release with checksums and per-platform evidence.
- [x] Maintenance: replace the final Node 20 GitHub Action runtime with the Node 24-based
  `pnpm/action-setup` v6.0.10 pin in active and disabled hosted workflows.
- [x] Checkpoint 75 maintenance: project root-union properties into the model-visible object root,
  retain exact branch constraints, verify OpenAI-compatible and LM Studio behavior, and produce a
  fresh no-identity macOS trial build.
- [x] Maintenance build: verify the current dirty macOS arm64 App through the complete no-identity
  package gate and produce structurally checked DMG and ZIP artifacts.
- [x] Maintenance: allow custom Provider HTTP Base URLs for localhost and numeric `10.*`, `100.*`,
  `127.*`, and `192.*` IPv4 endpoints while retaining HTTPS for other remote hosts.
- [x] Checkpoint 75: add Protocol v12 layered tool descriptions, run-local capability groups,
  exact active-envelope budgets, and provider-neutral object-root schemas under ADR 067.
- [x] Checkpoint 74: add Protocol v11 hash-bound table reads and typed edits, bounded review,
  native header editing, and portable Markdown/PDF/LaTeX projection under ADR 066.
- [x] Checkpoint 73: establish a summary-first Agent sidebar hierarchy with compact live status,
  bounded activity, inline task and attention docks, and a calmer responsive composer under ADR
  065.
- [x] Checkpoint 72: discard re-readable tool bodies, retain exhaustive writing continuation
  facts, and size the final escaped compaction request under ADR 064.
- [x] Checkpoint 71: recover complete oversized historical runs, finalize pathological tool loops,
  and harden model-continuation settlement under ADR 063.
- [x] Checkpoint 70: align transient Notebook with the shared Pi session runtime, selected-source
  read-only tools, and Agent model/Thinking controls under ADR 062.
- [x] Checkpoint 69: add Protocol v10 `ask_user`, Main-owned in-run waiting, exact answer IPC, and
  the inline shadcn Questionnaire experience under ADR 061.
- [x] Checkpoint 68: adopt native Block Math and converge application-owned Diagram on plain
  content, schema v5, and shared cross-system semantics under ADR 060.
- [x] Checkpoint 67: skippable first-run Agent, Embedding, Reranking, MinerU, and project-creation
  onboarding with versioned application-global progress.
- [x] Checkpoint 66: independent transient Notebook workspace with selected Knowledge sources,
  multi-turn source-only answers, validated citations, and project-session lifecycle cleanup.
- [x] Checkpoint 65: bounded native BlockNote inline mathematics with schema-v4 persistence,
  Agent semantics, prose-operation isolation, interchange, and safe publication.
- [x] Checkpoint 26.9: immutable `v0.2026.8.45` passed the shared static/fixture gate and independent
  Windows x64, macOS arm64, macOS x64, and Linux x64 native build/upload jobs. Release promotion
  remains disabled.

Authoritative detail:
[`implementation-todo/phase-10.md`](implementation-todo/phase-10.md#checkpoint-26-cross-platform-ci-recovery-matrix-and-release-promotion).

Checkpoint 63 detail: [`implementation-todo/phase-13.md`](implementation-todo/phase-13.md).

Checkpoint 65 detail: [`implementation-todo/phase-14.md`](implementation-todo/phase-14.md).

Checkpoint 66 detail: [`implementation-todo/phase-15.md`](implementation-todo/phase-15.md).

Checkpoint 67 detail: [`implementation-todo/phase-16.md`](implementation-todo/phase-16.md).

Checkpoint 68 detail: [`implementation-todo/phase-17.md`](implementation-todo/phase-17.md).

Checkpoint 69 detail: [`implementation-todo/phase-18.md`](implementation-todo/phase-18.md).

Checkpoint 70 detail: [`implementation-todo/phase-19.md`](implementation-todo/phase-19.md).

Checkpoint 71 detail: [`implementation-todo/phase-20.md`](implementation-todo/phase-20.md).

Checkpoint 72 detail: [`implementation-todo/phase-21.md`](implementation-todo/phase-21.md).

Checkpoint 73 detail: [`implementation-todo/phase-22.md`](implementation-todo/phase-22.md).

Checkpoint 74 detail: [`implementation-todo/phase-23.md`](implementation-todo/phase-23.md).

Checkpoint 75 detail: [`implementation-todo/phase-24.md`](implementation-todo/phase-24.md).

Checkpoint 76–77 detail: [`implementation-todo/phase-25.md`](implementation-todo/phase-25.md).

Checkpoint 76.1 detail: [`implementation-todo/phase-26.md`](implementation-todo/phase-26.md).

Checkpoint 78 detail: [`implementation-todo/phase-27.md`](implementation-todo/phase-27.md).

## Phase 27: Stable References, Zotero Import, And Citation Workflow

- [x] Checkpoint 78.0: ADR 070 decision gate, dependency/license boundary, architecture amendment,
  and explicit CP78-ahead-of-CP77 authorization.
- [x] Checkpoint 78.1: Reference authority, Zotero bibliography connector, parsers, synchronization,
  and attachment preview.
- [x] Checkpoint 78.2: bilingual citation identity, Agent evidence enforcement, legacy conversion,
  and Reference Library UI.
- [x] Checkpoint 78.3: CSL formatting, formatted mode, bibliography export, and publication
  integration.

Authoritative detail: [`implementation-todo/phase-27.md`](implementation-todo/phase-27.md).

## Phase 25: Agent Interaction Modes

- [x] Checkpoint 76: writing-only interaction ceilings, Protocol v13, exact Main/Worker
  enforcement, mode prompt layer, and responsive composer selector.
- [!] Checkpoint 77: Writing Task v2 and execution handoff; not authorized.

Authoritative detail: [`implementation-todo/phase-25.md`](implementation-todo/phase-25.md).

## Phase 24: Agent Tool Layering And Demand Profiles

- [x] Checkpoint 75: layered descriptions, explicit run-local activation, dual active-set
  enforcement, exact budgets, and strict OpenAI-compatible schema roots.

Authoritative detail: [`implementation-todo/phase-24.md`](implementation-todo/phase-24.md).

## Phase 23: Agent Table Authoring And Publication

- [x] Checkpoint 74: bounded table transformer, Protocol v11 table tools, review UI, editor
  configuration, and cross-format publication.

Authoritative detail: [`implementation-todo/phase-23.md`](implementation-todo/phase-23.md).

## Phase 22: Agent Sidebar Focus Hierarchy

- [x] Checkpoint 73: summary-first activity, stable task and attention docks, responsive composer,
  focused conversation navigation, and a verified local no-identity macOS arm64 App build.

Authoritative detail: [`implementation-todo/phase-22.md`](implementation-todo/phase-22.md).

## Phase 21: Writing Harness Semantic Compaction

- [x] Checkpoint 72: exhaustive per-tool compaction projection, deterministic continuation facts,
  final-request budgeting, and recovered-failure presentation.

Authoritative detail: [`implementation-todo/phase-21.md`](implementation-todo/phase-21.md).

## Phase 20: Agent Compaction And Tool-Loop Recovery

- [x] Checkpoint 71: bounded complete-run compaction scanning, tool-free finalization, and exact
  continuation recovery.

Authoritative detail: [`implementation-todo/phase-20.md`](implementation-todo/phase-20.md).

## Phase 19: Notebook Read-Only Agent Alignment

- [x] Checkpoint 70: reuse the Pi session runtime with selected-source-only Knowledge tools and
  transient model/Thinking selection.

Authoritative detail: [`implementation-todo/phase-19.md`](implementation-todo/phase-19.md).

## Phase 18: Agent User Clarification

- [x] Checkpoint 69: keep the original Agent run waiting for one bounded clarification tool call,
  authorize an exact answer, and resume the same Pi loop.

Authoritative detail: [`implementation-todo/phase-18.md`](implementation-todo/phase-18.md).

## Phase 17: Native Block Math And Diagram Experience Convergence

- [x] Checkpoint 68: register BlockNote native `mathBlock`, retain an application-owned
  plain-content `diagram`, and align schema-v5 persistence, Agent, interchange, and publication
  semantics under ADR 060.

Authoritative detail: [`implementation-todo/phase-17.md`](implementation-todo/phase-17.md).

## Phase 16: First-Run Onboarding

- [x] Checkpoint 67: add a responsive optional first-run flow that reuses the existing provider
  workspaces and Main-owned project creation boundary under ADR 059.

Authoritative detail: [`implementation-todo/phase-16.md`](implementation-todo/phase-16.md).

## Phase 15: Transient Notebook Knowledge Chat

- [x] Checkpoint 66: add a dedicated Notebook workspace and Main-owned, non-persistent Knowledge
  question-answering service under ADR 058 without changing the Knowledge management surface.

Authoritative detail: [`implementation-todo/phase-15.md`](implementation-todo/phase-15.md).

## Phase 14: Native Inline Mathematics

- [x] Checkpoint 65: introduce bounded native inline Math end to end without admitting native
  display Math, Diagram, collaboration, or BlockNote-owned persistence.

Authoritative detail: [`implementation-todo/phase-14.md`](implementation-todo/phase-14.md).

## Phase 13: Agent Review Experience

- [x] Checkpoint 63: bounded Agent status motion and semantic Proposal presentation while
  preserving typed mutation and approval authority.
- [x] Checkpoint 64: dependency security and compatibility refresh with production-audit,
  persisted-BlockNote, Electron/native, and packaged-runtime verification.

Authoritative detail: [`implementation-todo/phase-13.md`](implementation-todo/phase-13.md).

## Phase 12: Use And Fix

- [x] Checkpoint 48: Agent composer progressive disclosure, including ADR 039 approval shorthand
  and ADR 040 circular Send refinements.
- [x] Checkpoint 49: bounded Main-owned pending Follow-up queue under ADR 041.
- [x] Checkpoint 50: complete Agent tool-contract and recovery hardening under ADR 042.
- [x] ADR 043/044 refinements: Write Auto/YOLO semantics and live proposal-time approval reads.
- [x] Checkpoint 51: Pi active tool-loop context recovery under ADR 046.
- [x] Checkpoint 52: Knowledge citation coverage checks under ADR 047.
- [x] Checkpoint 53: safe existing-image cross-section relocation under ADR 048.
- [x] Checkpoint 54: harness-style writing context compaction under ADR 049.
- [x] Checkpoint 55: run-matched Agent context-usage indicator under ADR 050.
- [x] Checkpoint 56: bottom-docked Agent plan progress capsule.
- [x] Checkpoint 57: fixed Gemini/OpenAI/xAI image catalog under ADR 051.
- [x] Checkpoint 58: independent whole-manuscript Markdown Preview workspace.
- [x] Checkpoint 59: Vertex AI Nano Banana source and large-inline-image repair under ADR 052.
- [x] Checkpoint 60: observable per-run dynamic Writing Skills under ADR 054, superseding ADR 053's
  session-selection interaction.
- [x] Checkpoint 61: ordinary textual `$skill-name` mentions with Main-authorized visible loading
  under ADR 055.
- [x] Checkpoint 62: flat Settings reorganization and missing read-only support surfaces; no new
  ADR is required.

Authoritative detail: [`implementation-todo/phase-12.md`](implementation-todo/phase-12.md).

## Completed delivery milestones

- [x] Local no-identity candidate `v0.2026.8.26` for the completed Checkpoints 73–74 snapshot;
  source commit, annotated tag, and push of `main` plus the tag are separately user-authorized.
- [x] Local no-identity candidate `v0.2026.8.25` for the completed Checkpoint 71 baseline; the
  annotated tag and verified unpacked macOS arm64 App are prepared for the explicitly authorized
  push of `main` and the tag.
- [x] Local no-identity candidate `v0.2026.8.24` for the completed Checkpoint 70 baseline; the
  annotated tag and verified unpacked macOS arm64 App are prepared for the explicitly authorized
  push of `main` and the tag.
- [x] Local no-identity candidate `v0.2026.8.23` for the completed Checkpoint 69 baseline; the
  annotated tag and verified unpacked macOS arm64 App remain local with no push or release.
- [x] Local no-identity candidate `v0.2026.8.22` for the completed Checkpoints 67–68 baseline;
  structurally verified macOS arm64 App, DMG, and ZIP with no push, Developer ID signing,
  notarization, or release.
- [x] Checkpoint 64 hands-on no-Team-ID macOS arm64 App build from the current dirty worktree; no
  DMG, ZIP, candidate, commit, tag, push, or release was created.
- [x] Checkpoint 63 hands-on no-Team-ID macOS arm64 App, DMG, and ZIP build from the current dirty
  worktree; no candidate, commit, tag, push, or release was created.
- [x] Checkpoint 62 hands-on no-identity macOS arm64 App build from the current dirty worktree; no
  candidate, commit, tag, or release was created.
- [x] Local no-identity candidate `v0.2026.8.17` for the completed Phase 11 baseline.
- [x] Local no-identity candidate `v0.2026.8.18` for CP58/59 and the large-image repair.
- [x] Local no-identity candidate `v0.2026.8.19` for CP60.
- [x] Local no-identity candidate `v0.2026.8.20` for CP61.
- [x] No-identity candidate `v0.2026.8.21` for the current CP62–66 snapshot; CP65 remains explicitly
  incomplete, and `main` plus the annotated tag are pushed under separate user authorization.

Exact verification and artifact boundaries are recorded in
[`history/implementation-log.md`](history/implementation-log.md).

## Completed baseline

- [x] Phases 0–9 and Checkpoints 23M/23V.
- [x] Phase 10 Checkpoints 24–26.9.
- [x] Checkpoints 27–28.x and related maintenance under ADRs 012–020. Detailed evidence:
  [`implementation-todo/phase-agent-writing.md`](implementation-todo/phase-agent-writing.md).
- [x] Phase 11 Checkpoints 29–47B under ADRs 021–037.
- [x] Phase 12 Checkpoints 48–62 under ADRs 038–044 and 046–055.
- [x] Phase 13 Checkpoints 63–64; Checkpoint 64 is governed by ADR 056.
- [x] Phase 14 Checkpoint 65 under ADR 057.
- [x] Phase 15 Checkpoint 66 under ADR 058.
- [x] Phase 16 Checkpoint 67 under ADR 059.
- [x] Phase 17 Checkpoint 68 under ADR 060.
- [x] Phase 18 Checkpoint 69 under ADR 061.
- [x] Phase 19 Checkpoint 70 under ADR 062.

## Plan and evidence routing

- [Phase 0](implementation-todo/phase-0.md)
- [Phase 1](implementation-todo/phase-1.md)
- [Phase 2](implementation-todo/phase-2.md)
- [Phase 3](implementation-todo/phase-3.md)
- [Phase 4](implementation-todo/phase-4.md)
- [Phase 5](implementation-todo/phase-5.md)
- [Phase 6](implementation-todo/phase-6.md)
- [Phase 7](implementation-todo/phase-7.md)
- [Phase 8](implementation-todo/phase-8.md)
- [Phase 9](implementation-todo/phase-9.md)
- [Phase 10](implementation-todo/phase-10.md)
- [Checkpoints 27–28](implementation-todo/phase-agent-writing.md)
- [Phase 11](implementation-todo/phase-11.md)
- [Phase 12](implementation-todo/phase-12.md)
- [Phase 13](implementation-todo/phase-13.md)
- [Phase 14](implementation-todo/phase-14.md)
- [Phase 15](implementation-todo/phase-15.md)
- [Phase 16](implementation-todo/phase-16.md)
- [Phase 17](implementation-todo/phase-17.md)
- [Phase 18](implementation-todo/phase-18.md)
- [Phase 19](implementation-todo/phase-19.md)
- [Phase 20](implementation-todo/phase-20.md)
- [Phase 21](implementation-todo/phase-21.md)
- [Phase 22](implementation-todo/phase-22.md)
- [Phase 28](implementation-todo/phase-28.md)
- [Implementation history](history/implementation-log.md)
