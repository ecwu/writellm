# Phase 11: Post-Checkpoint-28 Writing Experience Roadmap

Status: planning only; inactive until Checkpoint 28 is explicitly accepted and closed

Recorded: 2026-08-12

## Purpose And Authority

This document is the first complete planning pass for product work after Checkpoint 28. It turns
the current writing workflow into a sequence of independently reviewable vertical checkpoints:

```text
find and navigate
-> revise safely
-> review the whole manuscript
-> coordinate cross-section work
-> publish
-> manage figures
-> retain author intent
-> reuse projects
```

This is not an active implementation plan, an accepted ADR, or authorization to begin Checkpoint
29. It changes no current architecture, IPC contract, database schema, migration, Agent prompt or
tool, Renderer authority, package, release, CI, commit, push, or publication scope.

Checkpoint 28 remains the only product-experience workstream. Checkpoint 29 may start only after:

1. the user explicitly declares Checkpoint 28 complete;
2. Checkpoint 28 acceptance and verification evidence are recorded;
3. the resulting baseline is identified without mixing unfinished Checkpoint 28 changes into the
   first Checkpoint 29 migration or contract;
4. the user explicitly approves the decision-complete Checkpoint 29 plan.

Later checkpoints are ordered proposals, not pre-authorized work. Before implementation, each
checkpoint must be refined against field experience from the preceding checkpoint and must receive
separate approval.

## Planning Principles

### Preserve The Existing Authorities

- BlockNote JSON and `section_revisions` remain the lossless manuscript authority.
- Brief, outline, section, asset, citation, Agent, and version-history ownership remain in their
  current project-local boundaries.
- Renderer receives bounded projections and sends validated intents. It receives no database,
  filesystem, credential, raw IPC, or reusable path authority.
- Agent writes remain typed, revision-checked proposals. New user experiences do not imply direct
  model writes, arbitrary JSON Patch, or generic file/network tools.
- Interactive review, search, replacement planning, export, and model work remain request-scoped
  and cancellable. They are not durable jobs.
- The three worker roles remain `agent-worker`, `background-worker`, and `index-worker`. A new
  checkpoint must reuse them or remain in Main/Renderer unless measured evidence proves that a new
  process boundary is necessary.
- Project version history remains opt-in and linear. New features may integrate with it but may not
  silently enable it, create branches, or expose Git concepts.

### Add Product Modules, Not Frameworks

Each checkpoint should add the narrowest domain module that owns a real invariant. Do not build a
generic workflow engine, plugin registry, rule engine, task database, exporter framework, asset
pipeline, or event-sourcing layer in anticipation of later checkpoints.

Preferred shape:

```text
shared Zod contract and pure domain functions
-> one Main-owned service at the authority boundary
-> existing repository or a narrowly justified new table
-> narrow preload/IPC projection
-> one shadcn-composed Renderer feature
```

Derived state should stay derived. Search hits, review results, export preflight findings, reference
numbers, asset usage, and manuscript health scores should be recomputed from current authoritative
state unless the user explicitly authors or resolves durable state. New persistence is reserved
for durable user intent such as annotations, task boundaries, or writing decisions.

### Reuse Before Extending

- Manuscript search should extract and reuse the current `search_manuscript` matching semantics
  rather than maintain an Agent-only and a Renderer-only implementation.
- Review should extract and reuse the deterministic checks behind `check_draft` rather than call an
  Agent tool from Renderer or duplicate its rules.
- Quick AI actions should use the existing selection capture, Agent conversation, Writing Skill,
  model selection, approval policy, proposal diff, and review continuation paths.
- Cross-section work should group existing Agent events, runs, and mutation proposals before a new
  task or change-set table is considered.
- Publishing should consume one consistent manuscript assembly, reference index, and verified asset
  inventory, then extend the existing atomic export publication boundary.
- Figure management should build on `manuscript_assets`, `section_revision_assets`, opaque
  `writellm-asset:` URLs, and current generation lineage.
- Safe batch work should use revision hashes and the existing proposal refresh rules. It must not
  invent a second concurrency model.

### Checkpoint Sizing Rule

A checkpoint represents one user-visible outcome and one primary authority boundary. Split a
feature when it introduces another one of these:

- a separate database migration or durable lifecycle;
- a new mutation/transaction protocol;
- a new model or provider effect;
- a new export format/runtime;
- a new security or filesystem boundary;
- a separately valuable UI that can ship and be verified independently.

## Proposed Order

| Checkpoint | Product outcome | Primary reuse | Expected architecture change |
| --- | --- | --- | --- |
| 29 | Manuscript-wide find and navigation | Agent manuscript matching, outline, block IDs | None expected |
| 30 | Safe manuscript-wide replacement | Revisions, hashes, materialization | Narrow batch mutation decision |
| 31 | Selection-based quick AI actions | Selection context, Agent, proposals | None expected |
| 32 | Deterministic Review Center | `check_draft`, assembly, references | Extract shared review core |
| 33 | Grounded semantic review and repair | Existing Agent tools and citations | Prompt/template decision only |
| 34 | Durable writing-task plan and progress | Agent sessions, runs, events | Event/schema decision likely |
| 35 | Unified cross-section change-set review | Proposals, refresh, undo, history | Group/apply decision required |
| 36 | Publishing assembly and preflight | Export barrier, assembly, assets | Export contract extension |
| 37 | DOCX publication | Publishing assembly | One format adapter and dependency |
| 38 | PDF publication and reusable presets | Publishing assembly, app settings | Runtime/package decision likely |
| 39 | Manuscript asset workspace | Existing asset tables and capabilities | None or bounded metadata only |
| 40 | Image iteration and figure semantics | Image gateway, asset lineage, proposals | Asset-lineage migration likely |
| 41 | Annotations and actionable TODOs | Stable block IDs, section revisions | New project-local durable state |
| 42 | Writing decisions and terminology rules | Versioned brief and Agent context | Brief-schema decision preferred |
| 43 | Clone / Save As | Snapshot, project lifecycle, filesystem | Project-identity ADR required |
| 44 | Reusable project templates | Clone sanitization and bootstrap | App-global catalog decision |

## Checkpoint 29: Manuscript-Wide Find And Navigation

### User outcome

The author can find text across the manuscript, filter results, inspect context, and jump to the
exact section and block without opening the Agent.

### Scope

- Search section titles, objectives, and current BlockNote body text.
- Support literal case-sensitive and case-insensitive matching with one documented Unicode/NFC
  behavior. Regular expressions and semantic search remain deferred.
- Filter by section, outline subtree, and section status.
- Return bounded, paginated results with section title, heading path, excerpt, block ID, revision
  ID, and exact match ranges.
- Activate a result by saving pending editor changes, switching section, scrolling to the stable
  block, and temporarily highlighting the match without rewriting the document.
- Add a keyboard-accessible global command entry and a contextual manuscript rail/sheet. Reuse the
  existing shell and shadcn components.

### Integration And Complexity Control

Extract the current Agent-only manuscript matcher into a credential-free shared/Main domain
function. The Agent read tool and new Renderer-facing service should consume the same matcher and
separate bounded contracts. Do not index manuscript content in `index.sqlite` yet: the current
single-manuscript, current-revision scan is simpler, authoritative, and already proven by the Agent
tool. Add a dedicated manuscript index only if measured manuscript sizes make the bounded scan
insufficient.

No migration, Agent tool, worker, durable job, or persisted search history is expected.

### Acceptance gate

Results must never reference an old revision after an editor flush; navigation must preserve
unsaved content and Agent-panel focus; searches must stay bounded for large manuscripts; current
Chinese and English matching behavior must be covered; stale project sessions must fail closed.

## Checkpoint 30: Safe Manuscript-Wide Replacement

### User outcome

The author can preview and selectively apply a literal replacement across sections without hidden
or partial edits.

### Scope

- Build a replacement plan from Checkpoint 29 results after a final editor flush.
- Show every candidate grouped by section with before/after context and independent selection.
- Exclude citation labels, links, code, formulas, and other structured content by default when a
  plain-text replacement would damage semantics; expose explicit reasons for skipped matches.
- Revalidate outline version, section revision IDs, block IDs, text hashes, and match ranges before
  application.
- Apply selected replacements in one bounded Main-owned operation or fail without a partially
  presented success state.
- Append normal section revisions, update asset references/counts, and materialize through existing
  manuscript services. Never modify stored BlockNote JSON directly from Renderer.
- Provide per-section undo through existing revision lineage. If project version history is ready,
  offer—but do not require—a named pre-change checkpoint.

### Integration And Complexity Control

Add one manuscript-specific replacement planner and application service; do not create a generic
batch-command framework. Its plan is an ephemeral capability containing exact revision and block
preconditions, not a durable job. Literal replacement ships before AI/semantic replacement.

Before implementation, decide in an ADR whether multi-section application is one short SQLite
transaction or a staged series with an explicit compensation contract. Network work, editor flush,
and materialization must remain outside the body transaction.

### Acceptance gate

Cover concurrent manual edits, changed match counts, nested rich blocks, citations, links, assets,
duplicate matches, zero selected results, crash/materialization repair, undo, and project switch.
No accepted replacement may be reported if its exact preconditions were not committed.

## Checkpoint 31: Selection-Based Quick AI Actions

### User outcome

Common rewrite operations become available directly from a text selection while preserving the
same review and safety behavior as the full Agent panel.

### Scope

- Offer a restrained selection toolbar and keyboard command for rewrite, shorten, expand, adjust
  tone, check evidence, align with manuscript, and custom instruction.
- Open or reuse one normal Agent conversation with the existing captured selection/revision
  context. The toolbar itself performs no model call and never constructs a mutation.
- Show progress in the existing Agent surface and return the normal typed proposal diff.
- Preserve the selected model, Thinking level, Writing Skill, context scope, and approval policy.
- Keep selection actions available on narrow layouts and fully keyboard accessible.

### Integration And Complexity Control

Treat quick actions as bounded Main-owned task templates passed to the existing Agent start path.
Do not add a second AI runtime, inline model provider, quick-action table, automatic direct write,
or new Agent tool. Renderer-local presets are fixed application commands in the first version;
user-authored reusable prompts remain deferred until usage proves the need.

### Acceptance gate

The exact selection snapshot must be visible and stale selections must fail safely. A quick action
must produce the same proposal lineage, citation provenance, stop/steer behavior, usage accounting,
and review continuation as a manually entered Agent request.

## Checkpoint 32: Deterministic Manuscript Review Center

### User outcome

The author receives a whole-manuscript health view that is instant, reproducible, explainable, and
useful without a model provider.

### Scope

- Surface document structure, outline integrity, revision lineage, safe-link, placeholder,
  duplicate heading/paragraph, and length checks already represented by `check_draft`.
- Add deterministic checks for empty or incomplete sections, section-objective/target metadata
  presence, unresolved citations, missing image captions/alt text, unused assets, and References
  availability where the current authoritative data supports them.
- Group findings by severity, category, and section; support filtering and direct navigation.
- Derive a summary from exact findings. Avoid an opaque single health score in the first version.
- Refresh on demand and after relevant saves with debounce. Results are not persisted.

### Integration And Complexity Control

Extract a pure `ManuscriptReview` domain from the current Agent read-tool implementation. Both
`check_draft` and a new bounded Main/IPC projection consume it. The Renderer never calls an Agent
tool and does not reimplement review rules. Checks use one captured manuscript snapshot so results
cannot mix revisions.

Do not build a generic configurable rule engine. Each check is an explicit typed function with a
stable ID, bounded evidence, tests, and severity owned by the application.

### Acceptance gate

The Agent and Review Center must report equivalent results for shared checks on the same snapshot.
Every finding must identify a current section/block or a manuscript-level target and navigate
safely. Provider absence, unavailable knowledge index, or an unresolvable citation must be shown as
an explicit skipped/unavailable state rather than a false pass.

## Checkpoint 33: Grounded Semantic Review And Repair

### User outcome

The author can ask for higher-level review—consistency, contradictions, repetition, audience fit,
and objective coverage—and turn selected findings into normal revision-safe proposals.

### Scope

- Add application-owned review templates for terminology consistency, claim/evidence coverage,
  cross-section contradictions, repetition, audience/tone fit, and section-objective coverage.
- Run review as a normal Agent request using existing `read_outline`, `read_section`,
  `search_manuscript`, `search_knowledge`, `read_citations`, and `check_draft` tools.
- Require location-bound findings and distinguish observed text, retrieved evidence, and model
  inference in the presentation.
- Keep findings inside the normal conversation/event history. A selected repair starts or
  continues a normal proposal-producing run.
- Permit a review-only outcome with no proposal.

### Integration And Complexity Control

This checkpoint adds prompt/task-template behavior and Renderer presentation, not a semantic-rule
database, review provider role, new model, or new Agent tool. The deterministic Review Center stays
authoritative for mechanical checks. Semantic results are advisory and must never be merged into a
deterministic pass/fail score.

### Acceptance gate

Review must remain bounded by the selected scope and model context; citations must pass the current
provenance rules; findings without adequate evidence must say so; repairs must use existing typed
submit tools and proposal review. Provider failure must leave the deterministic Review Center
usable.

## Checkpoint 34: Durable Writing-Task Plan And Progress

### User outcome

A long cross-section request has a visible plan, current step, completed steps, and remaining work
instead of being represented only as an undifferentiated conversation.

### Scope

- Let the user start a bounded writing task within one Agent conversation.
- Persist one human-readable task objective and an ordered bounded plan with statuses such as
  pending, active, completed, skipped, and blocked.
- Correlate plan progress with exact Agent runs and existing proposal/application outcomes.
- Display the plan in the existing conversation canvas and allow the user to stop, resume, or ask
  for a revised plan while the conversation is idle.
- Keep one task line per conversation; use current project-level Agent work reservations.

### Integration And Complexity Control

Prefer a versioned, bounded presentation payload on existing Agent events and session metadata over
a generic `tasks` table. The plan is collaboration state, not mutation authority: manuscript,
proposal, and model-request rows remain authoritative for actual effects. Do not add a scheduler,
durable Agent job, background recovery loop, subagent, or cross-project task manager.

An ADR is required before implementation to freeze task/event persistence, recovery after restart,
plan-size limits, and how progress is reconciled when the model's narration disagrees with durable
proposal state.

### Acceptance gate

Restart, archive/restore, stop, retry, request-changes continuation, provider failure, and project
close must preserve a truthful plan. The UI must never mark a manuscript step complete solely from
assistant prose when the corresponding authoritative effect failed or remains pending.

## Checkpoint 35: Unified Cross-Section Change-Set Review

### User outcome

Proposals created by one writing task can be reviewed as a coherent manuscript-wide change set,
with per-item control and a truthful overall result.

### Scope

- Group existing brief, outline, section, and image proposals by the Checkpoint 34 task boundary.
- Present a summary and per-section diffs without replacing the current exact proposal diff.
- Allow apply selected, request changes for one item, reject selected, and resume the remaining
  task.
- Refresh stale section proposals through ADR 003; never silently rebase or apply an old base.
- Report applied, satisfied, superseded, conflicted, rejected, and pending outcomes separately.
- Integrate optional pre-change version checkpoint creation when history is already enabled.
- Provide a post-application deterministic review and a clear partial-result summary.

### Integration And Complexity Control

The first design should derive the set from task-scoped Agent events, runs, and
`mutation_proposals`. Do not introduce a second proposal table or generic transaction coordinator.
If field requirements prove that a durable change-set identity is needed, add the smallest
project-local relation after an ADR; do not broaden it into a workflow engine.

Apply remains a Main-owned sequence of existing proposal decisions with exact precondition checks.
An all-or-nothing multi-proposal transaction is not assumed: brief, outline, section, asset, and
external image effects have different authorities. The UI must model partial outcomes honestly.

### Acceptance gate

Cover multiple proposals in one section, proposals across sections, outline/body dependencies,
stale refresh, rejected repairs, image-generation failure, crash between applications, undo, and
version-history unavailable/damaged states. No group action may bypass each proposal's current
authorization and validation.

## Checkpoint 36: Publishing Assembly And Preflight

### User outcome

Before choosing an output format, the author can inspect one deterministic publication model and
resolve issues that would otherwise appear only after export.

### Scope

- Build a format-neutral publication assembly from the current manuscript, outline, reference
  index, figures, captions, alt text, and verified asset inventory.
- Define heading hierarchy, paragraphs, lists, tables, formulas, Mermaid, figures, citations, and
  References as typed publication nodes without replacing BlockNote as authority.
- Add preflight findings for unsupported blocks, missing assets, invalid heading hierarchy,
  unresolved citations, absent figure metadata, empty sections, and known format losses.
- Provide a bounded preview/summary and navigation back to each issue.
- Reuse the current export consistency barrier, final editor flush, asset capture, validation,
  staging, and atomic publication rules.

### Integration And Complexity Control

Extend the existing manuscript export module with one pure publication projection and one shared
preflight result. Do not create a general document object model intended to replace BlockNote, and
do not persist the publication assembly. Native and Markdown exports remain readable and may adopt
shared pieces only when their current behavior can be preserved.

### Acceptance gate

The same captured manuscript state must drive preview, preflight, reference numbering, asset
inventory, and the eventual format converter. An export must not silently proceed past errors; any
allowed loss must appear in a machine-readable and human-readable report.

## Checkpoint 37: DOCX Publication

### User outcome

The author can produce a portable Word document suitable for editing, review, and delivery.

### Scope

- Convert the Checkpoint 36 publication assembly to DOCX.
- Preserve heading levels, paragraphs, lists, basic tables, images, captions, alt text, hyperlinks,
  citations, and a generated References section where representable.
- Define explicit fallbacks for Mermaid, formulas, unsupported BlockNote blocks, and layout
  limitations.
- Produce an inventory/hash record and loss report through the current atomic export package
  boundary.
- Validate the generated ZIP/package structure and reopen it with an independent parser during
  tests.

### Integration And Complexity Control

Choose and exact-pin one maintained DOCX library only during checkpoint refinement, after current
documentation and package/runtime impact are reviewed. Keep the library inside one converter
module; shared manuscript code must depend on the publication node contract, not library types.
Do not build a dynamic exporter registry for a single new format.

### Acceptance gate

Golden fixtures must cover Chinese/English text, Unicode filenames, nested headings, tables,
figures, citations, links, Mermaid/formula fallbacks, large images, and deterministic loss
reporting. The generated document must open in at least one independent parser and in a manual Word
or LibreOffice acceptance pass before the checkpoint is complete.

## Checkpoint 38: PDF Publication And Reusable Presets

### User outcome

The author can generate a stable final PDF and reuse a small set of publication preferences.

### Scope

- Render the Checkpoint 36 publication assembly to PDF with page size, margins, typography,
  heading styles, page numbers, headers/footers, table of contents, figures, and References.
- Add application-owned presets first, then bounded user presets for settings that have stable
  cross-format meaning.
- Store non-sensitive reusable preset metadata in `app.sqlite`; project content remains
  project-local.
- Provide print-oriented preview and deterministic preflight/loss reporting.
- Keep PDF publication distinct from the existing project-source PDF preview boundary.

### Integration And Complexity Control

Prefer Electron/Chromium's existing rendering capability or one narrowly isolated converter after
a measured prototype; do not introduce a local HTTP server, office-suite runtime, or general print
service. Main owns capture and publication. Heavy rendering may use the existing background worker
only if Main responsiveness measurements justify it, while project file publication remains in
Main.

An ADR and package gate are required because PDF behavior can depend on Electron, fonts, native
resources, and platform packaging.

### Acceptance gate

Verify page breaks, table of contents, headers/footers, mixed CJK/Latin text, links, selectable text,
images, Mermaid, formulas, references, large manuscripts, cancellation, and packaged execution.
Preset changes must never mutate manuscript revisions.

## Checkpoint 39: Manuscript Asset Workspace

### User outcome

The author can see every manuscript image, where it is used, how it was created, and whether it is
safe to remove.

### Scope

- List generated and uploaded assets using existing metadata and session-bound preview URLs.
- Show MIME, dimensions, size, creation time, generation lineage, and current revision references.
- Filter by used, unused, generated, uploaded, and current section.
- Navigate from an asset to each current section/block reference.
- Permit deletion only when no current revision, retained proposal, or other protected lineage
  requires the asset; otherwise explain why it is retained.
- Keep existing grace-period cleanup and immutable bytes.

### Integration And Complexity Control

Add bounded list/usage projections to `ManuscriptAssetService`; do not scan the project directory
from Renderer or create a second asset catalog. Current revision usage should derive from
`section_revision_assets` and BlockNote references. New metadata columns are deferred unless the UI
cannot derive a required value safely.

### Acceptance gate

Cover shared assets, historical-only references, pending image proposals, missing or tampered asset
files, cleanup races, project switch, large libraries, and keyboard navigation. The workspace must
never expose absolute paths or raw asset bytes outside existing capabilities.

## Checkpoint 40: Image Iteration And Figure Semantics

### User outcome

The author can iterate on a generated figure and replace it in place without losing the figure's
role, caption, alt text, or manuscript history.

### Scope

- Generate another candidate from an existing image's prompt/specification and current manuscript
  context using the existing image provider role.
- Preserve immutable candidate assets and show their lineage; replacement creates a normal section
  proposal against the current block/revision.
- Support keep current, replace, insert as another figure, and compare candidates.
- Make caption and alt text explicit figure metadata in the BlockNote image block and Review Center.
- Add derived figure numbering and bounded cross-reference presentation only after stable figure
  identity is defined. Numbers remain derived from current manuscript order.
- True pixel editing, crop tools, masks, and arbitrary image-to-image provider calls remain
  deferred until separately justified.

### Integration And Complexity Control

Reuse the current background-worker image gateway, `model_requests`, asset publication, generation
provenance, and `submit_section_change`. Add only a parent/variant lineage relation if existing
generation metadata cannot express it; an ADR and forward-only migration are required before doing
so. Do not introduce an image-provider plugin framework or mutable asset bytes.

### Acceptance gate

Cover generation cancellation/failure, candidate deduplication, stale target blocks, shared current
assets, replacement/undo, caption/alt preservation, checkpoint restore, orphan cleanup, and exact
model/Agent provenance.

## Checkpoint 41: Annotations And Actionable TODOs

### User outcome

The author can attach a durable note or TODO to manuscript content, navigate unresolved work, and
resolve it without inserting editorial notes into the published text.

### Scope

- Create project-local annotations anchored to a section and stable block ID, with an optional
  bounded text anchor/fingerprint for relocation diagnostics.
- Support note and TODO kinds, open/resolved status, author text, creation/update timestamps, and
  direct navigation.
- Keep annotations outside BlockNote body content and exclude them from counts, exports, citations,
  search results, and model context by default.
- Surface unresolved items in a contextual rail and Review Center.
- Define explicit orphaned state when a block is deleted or replaced; never guess a new target.
- Let the user explicitly include selected annotations in a normal Agent request.

### Integration And Complexity Control

This is the first checkpoint in the roadmap that clearly justifies new durable project state. Add a
small annotation table and one service rather than a general comments/collaboration system. There
is one local author, no threads, mentions, permissions, realtime collaboration, Yjs, or external
sync.

### Acceptance gate

Cover revision changes that preserve block IDs, block replacement/deletion, section tombstones,
restore, import, export exclusion, Agent opt-in, large annotation counts, and stale project
sessions. Annotation failure must never block manuscript editing.

## Checkpoint 42: Writing Decisions And Terminology Rules

### User outcome

The author can record durable manuscript-level choices such as preferred terminology, audience,
voice, and prohibited forms, and use them consistently in review and Agent work.

### Scope

- Add bounded writing decisions with category, preferred form, discouraged alternatives, rationale,
  and active/inactive status.
- Surface decisions in Brief editing and the Review Center.
- Include active decisions as trusted writing requirements in bounded Agent context.
- Add deterministic exact-term checks where possible; semantic interpretation remains advisory.
- Keep changes versioned and reviewable, with explicit conflict handling during Agent brief
  proposals.

### Integration And Complexity Control

Prefer a versioned extension of the existing manuscript brief over a new memory or rules subsystem.
Only introduce a separate table if independent item identity, lifecycle, and query requirements
cannot be satisfied within the bounded brief contract. Do not call this long-term memory: current
project state is authoritative, user-editable, and scoped to one manuscript.

### Acceptance gate

Cover Unicode normalization, conflicting preferred forms, term boundaries, language-specific false
positives, brief version conflicts, Agent snapshots, Review Center equivalence, export behavior, and
project portability.

## Checkpoint 43: Clone / Save As

### User outcome

The author can create an independent copy of a project for experimentation or a new deliverable
without duplicating project identity.

### Scope

- Clone a consistent project state through the current snapshot barrier and verified inventory.
- Generate a new `projectId` and update every identity-bearing project record that requires it.
- Define whether Agent history, version history, exports, backups, knowledge originals, parsed
  artifacts, and derived index data are included or omitted.
- Never leave two independently writable folders with the same `projectId`.
- Publish the clone through staging and full validation before opening or adding it to recent
  projects.

### Integration And Complexity Control

Reuse project snapshot, manifest-last publication, database backup, `ProjectFilesystem`, migrations,
and open validation. Do not implement clone as a raw folder copy and do not add project watchers or
multi-project concurrency. A dedicated ADR is required because this changes the current
restore-versus-clone identity boundary.

### Acceptance gate

Cover open projects with WAL data, Unicode and long paths, symlinks/junctions, cancellation,
`ENOSPC`, identity rewrite failure, knowledge/index inclusion choices, version history, credential
absence, and opening source and clone sequentially without shared authority.

## Checkpoint 44: Reusable Project Templates

### User outcome

The author can start a new project from a known Brief, outline, writing decisions, and optional
publication preset without copying old manuscript content or identity.

### Scope

- Ship a small reviewed application catalog of built-in templates.
- Allow an explicit project-to-template operation that extracts only approved reusable structure.
- Exclude manuscript bodies, knowledge files, citations, Agent history, credentials, generated
  assets, version history, project IDs, and private absolute paths by default.
- Create a new project through the normal bootstrap path, then apply validated template data as
  initial project state.
- Show a complete inclusion preview before saving a user template.

### Integration And Complexity Control

Build on Checkpoint 43's identity sanitization and existing project creation. Template manifests
are bounded, versioned data—not executable skills or plugins. Built-in templates may ship as
resources; user templates require a narrow application-global catalog plus hash-verified files only
after the storage boundary is designed. Do not reuse Writing Skills as project templates.

### Acceptance gate

Cover template schema evolution, unknown fields, malformed or tampered template files, duplicate
names, missing optional presets, CJK content, source-project deletion, and deterministic new-project
identity. A template must never carry project content not shown in its inclusion preview.

## Cross-Checkpoint Verification Strategy

Each checkpoint receives the smallest applicable gate plus focused tests for its authority:

- Pure matching, review, publication projection, and conversion logic: deterministic unit/golden
  fixtures.
- Main services and migrations: Electron-hosted tests with original-error logging and rollback
  coverage.
- IPC and capabilities: sender authorization, `projectSessionId`, bounds, stale-session, and safe
  error tests.
- Renderer flows: keyboard, focus, narrow-window, accessibility, save barriers, and exact navigation
  behavior.
- Cross-section mutations, Agent tasks, export, clone, and packaged rendering: fresh Real-Electron
  scenarios.
- Native/runtime or format dependencies: `check:package` only where the repository gate requires
  it. `check:release` remains separately authorized.

Every implemented checkpoint must emit structured lifecycle logs at material boundaries, log the
original top-level `err` before sanitization, and avoid logging manuscript content, annotations,
prompts, generated image bytes, credentials, or private paths.

## Explicitly Deferred Beyond This Roadmap

- Multiple simultaneously open projects or multiple primary manuscripts.
- External-edit synchronization and project-wide file watching.
- Multi-agent/subagent workflows, generic plans/tasks, autonomous background writing, and long-term
  implicit memory.
- Generic plugins, executable Writing Skills, arbitrary filesystem/network/shell tools, and direct
  Agent writes.
- Realtime collaboration, comments with identities/mentions, Yjs, and cloud sync.
- Semantic manuscript indexing before measured search evidence requires it.
- True image editing, masks, arbitrary remote-image ingestion, and provider-agnostic image plugins.
- Auto-updater, new distribution targets, hosted CI restoration, signing, notarization, and release
  promotion.

These may be reconsidered only from concrete usage evidence and a separately approved architecture
decision. They are not implied by Checkpoints 29-44.
