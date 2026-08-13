# Phase 11: Post-Checkpoint-28 Writing Experience Roadmap

Status: Checkpoint 31 is locally complete; later checkpoints remain planning-only

Recorded: 2026-08-12
Revised: 2026-08-12 — second planning pass. This revision merges two independent reviews of the
first pass: an internal library/codebase research pass (existing-module inventory plus mature-
library selection for parsing and export) and an external architecture review (dependency
ordering, checkpoint sizing, and durability boundaries). Checkpoint numbers are stable
identities, not a sequence; the Execution Order section is authoritative for sequencing, and
several original checkpoints are split into A/B parts to satisfy the sizing rule. The activation
authority below is unchanged: this document authorizes no implementation.

Revised: 2026-08-12 — Checkpoint 29 decision-complete pass. Checkpoint 28.x and the local
`v0.2026.8.13` baseline are complete. ADR 021 now fixes CP29 literal-search semantics, semantic
text spans, the two-layer offset source map, snapshot/pagination behavior, exact navigation,
bounded UI, observability, performance gate, and verification matrix. This refinement authorizes
planning only; CP29 implementation still requires a separate explicit user approval.

Revised: 2026-08-12 — Checkpoint 29 implementation completed within accepted ADR 021. The shared
literal matcher, cooperative hybrid offset map, strict Main/IPC revalidation, unchanged Agent
adapter, Find workspace, exact editor navigation, and local acceptance evidence are complete.

Revised: 2026-08-12 — Checkpoint 30 decision-complete pass. Proposed ADR 022 fixes the writable
target matrix, complete ephemeral plan, selection and transaction bounds, exact structural
transform, revision/asset/materialization behavior, per-section Undo, optional project checkpoint,
Replace UI, observability, implementation slices, performance gate, and acceptance matrix. This
refinement authorizes planning only; CP30 implementation requires separate explicit approval.

Revised: 2026-08-12 — the user explicitly accepted the decision-complete CP30 boundary and
requested implementation, the next local patch build (`0.2026.8.15`), and an unsigned macOS App
for hands-on testing. ADR 022 is accepted. CP31 and later checkpoints remain planning-only.

Revised: 2026-08-12 — Checkpoint 30 implementation and local acceptance are complete. Literal
replacement now uses an exhaustive ephemeral review plan, exact structural revalidation, one
canonical transaction, bounded per-section Undo, optional ready-only project checkpoints, and
mounted-editor reconciliation. The `0.2026.8.15` unsigned macOS arm64 package passed its runtime
and packaged E2E gates. CP31 has not started.

Revised: 2026-08-12 — Checkpoint 31 implementation and local acceptance are complete under
accepted ADR 023. Exact text selection now enters the existing Agent conversation through bounded
Main-owned task templates, with current-revision/block/text revalidation, frozen timeline
presentation, normal proposal/review controls, and explicit review-only success. No release or
package metadata changed.

## Purpose And Authority

This document is the complete planning record for product work after Checkpoint 28. It turns
the current writing workflow into a sequence of independently reviewable vertical checkpoints:

```text
find and navigate
-> revise safely
-> review the manuscript (deterministic, then grounded semantic)
-> coordinate cross-section work
-> define figures, then publish
-> import external manuscripts
-> retain author intent
-> reuse projects
```

This document is not implementation authorization. Checkpoint refinements change no current
architecture, IPC contract, database schema, migration, Agent prompt or tool, Renderer authority,
package, release, CI, commit, push, or publication scope until their proposed ADR is separately
accepted and implementation is explicitly requested.

Checkpoint 29 implementation may start only after:

1. [x] the user explicitly declares Checkpoint 28 complete;
2. [x] Checkpoint 28 acceptance and verification evidence are recorded;
3. [x] the resulting baseline is identified without mixing unfinished Checkpoint 28 changes into
   the first Checkpoint 29 contract (`v0.2026.8.13` is the local baseline);
4. [x] the decision-complete Checkpoint 29 plan and proposed ADR 021 are recorded; and
5. [x] the user explicitly approves that plan and requests Checkpoint 29 implementation.

Later checkpoints are ordered proposals, not pre-authorized work. CP30 has now received separate
implementation approval against the completed CP29 implementation. Before implementation, every
later checkpoint must likewise be refined against field experience from its preceding checkpoint.

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
  process boundary is necessary. The Checkpoint 37 trust boundary (parsing hostile LaTeX input)
  is a recorded exception candidate; see Cross-Cutting Decisions.
- Project version history remains opt-in and linear. New features may integrate with it but may
  not silently enable it, create branches, or expose Git concepts.

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

Derived state should stay derived. Search hits, review results, export preflight findings,
reference numbers, asset usage, and manuscript health findings should be recomputed from current
authoritative state unless the user explicitly authors or resolves durable state. New persistence
is reserved for durable user intent such as annotations, task boundaries, or writing decisions.

### Reuse Before Extending

- Manuscript search extracts and reuses the current `search_manuscript` matching semantics
  (`src/main/agent/read-tools.ts`) rather than maintaining an Agent-only and a Renderer-only
  implementation.
- Review extracts and reuses the deterministic checks behind `check_draft` rather than calling an
  Agent tool from Renderer or duplicating its rules.
- Quick AI actions use the existing selection capture, Agent conversation, Writing Skill, model
  selection, approval policy, proposal diff, and review continuation paths.
- Cross-section work groups existing Agent events, runs, and mutation proposals before a new task
  or change-set table is considered.
- Publishing consumes one consistent manuscript assembly, reference index, and verified asset
  inventory, then extends the existing atomic export publication boundary
  (`src/main/manuscript/manuscript-export.ts`).
- Figure management builds on `manuscript_assets`, `section_revision_assets`, opaque
  `writellm-asset:` URLs, and current generation lineage.
- Safe batch work uses revision hashes and the existing proposal refresh rules. It does not
  invent a second concurrency model.
- Import staging reuses the contained-extraction and file-budget invariants of
  `src/main/knowledge/mineru-archive.ts` rather than adding another extractor.

### Mature-Library Gate

Any checkpoint that introduces parsing, format conversion, export, archive handling, compression,
or rendering must satisfy this gate before its decision-complete plan is approved:

1. Survey the current official documentation and released versions of at least two or three
   candidate libraries at refinement time. Selection from memory is not acceptable; the survey
   must be repeated even when a prior research pass exists, because versions and maintenance
   status change.
2. Record for each candidate: maintenance activity and release history; license and known
   security issues (licenses must be MIT-compatible: MIT/ISC/BSD/Apache-2.0; LGPL/GPL are
   rejected); Electron 43 / Node runtime compatibility; native binaries and packaged-runtime
   impact; behavior on hostile input, resource bounds, and cancellation; CJK, math, table,
   image, and citation coverage; AST/API stability; and output determinism.
3. Exact-pin the chosen dependency and confine its types to one adapter module. The rest of the
   application consumes only application-owned contracts.
4. Verify with golden fixtures plus an independent parser/reopen or round-trip check. A
   successful library call alone is never acceptance evidence.
5. If no mature library fits, stop. Present the minimal self-implementation scope, the evidence
   that no library qualifies, and the risks, and obtain explicit approval before writing code.

The Library Pre-Selection section below records the 2026-08-12 research pass for the modules
already known. It is a pre-selection, not a pin: each checkpoint refinement re-verifies versions
and maintenance status under this gate.

### Checkpoint Sizing Rule

A checkpoint represents one user-visible outcome and one primary authority boundary. Split a
feature when it introduces another one of these:

- a separate database migration or durable lifecycle;
- a new mutation/transaction protocol;
- a new model or provider effect;
- a new export format/runtime;
- a new security or filesystem boundary;
- a separately valuable UI that can ship and be verified independently.

This revision applies the rule retroactively: original Checkpoints 34, 35, 37, 41, 43, and 47
each bundled two independent outcomes or boundaries and are split into A/B parts below.

## Execution Order

Checkpoint numbers are stable identities from the first pass; they are not a sequence. The
following order is the proposed execution sequence. Splits are listed as separate rows.

| Order | Checkpoint | Product outcome | Primary reuse | Expected architecture change |
| --- | --- | --- | --- | --- |
| 1 | 29 | Manuscript-wide find and navigation | Agent manuscript matcher, outline, block IDs | None expected |
| 2 | 30 | Safe manuscript-wide replacement | CP29 semantic spans, revisions, hashes | Batch-mutation ADR (one short transaction) |
| 3 | 31 | Selection-based quick AI actions | Selection context, Agent, proposals | None expected |
| 4 | 32 | Deterministic Review Center | `check_draft` core extraction | Pure snapshot review core; skipped checks implemented |
| 5 | 45 | Writing decisions and terminology rules | Versioned brief, Agent context | Brief-schema decision preferred |
| 6 | 33 | Grounded semantic review and repair | Agent tools, CP45 decisions, citations | Typed review-result payload decision |
| 7 | 34A | Writing-task identity and plan model | Agent sessions, runs, events | Event/schema ADR required |
| 8 | 34B | Task progress, reconciliation, recovery | CP34A model, proposal outcomes | None beyond 34A |
| 9 | 35A | Read-only cross-section change-set review | Task-scoped proposals and runs | Grouping derivation only |
| 10 | 35B | Change-set batch decisions and apply | CP30 precondition planner pattern | Apply-sequence ADR |
| 11 | 43A | Figure identity, caption, and alt text | Image blocks, Review Center | BlockNote schema + project migration |
| 12 | 42 | Manuscript asset workspace | Asset tables and capabilities | Bounded metadata migration (dimensions) likely |
| 13 | 43B | Image iteration and candidate lineage | Image gateway, CP43A metadata | Asset-lineage migration likely |
| 14 | 38 | Publishing assembly and preflight | Export barrier, CP43A figure metadata | Publication-node contract |
| 15 | 39 | DOCX publication | CP38 assembly | One format dependency + adapter |
| 16 | 40 | LaTeX publication | CP38 assembly, reference index | Template/profile ADR; hand-written emitter |
| 17 | 41A | PDF publication | CP38 assembly, Chromium printToPDF | Runtime decision; package gate |
| 18 | 41B | Reusable publication presets | CP38-41A options | App-global preset state |
| 19 | 36 | Staged import with Markdown adapter | Contained extraction, editor flush | Import contract and staging-lifetime ADR |
| 20 | 37A | LaTeX import core (single file) | CP36 staging, unified-latex adapter | Parser dependency; worker isolation |
| 21 | 37B | LaTeX import full profile | CP37A, citation-js, archive reuse | Second parser dependency |
| 22 | 44 | Annotations and actionable TODOs | Stable block IDs, section revisions | New project-local durable state |
| 23 | 46 | Clone / Save As | Snapshot barrier, restore validation | Project-identity ADR |
| 24 | 47A | Built-in project templates | Project bootstrap | None expected |
| 25 | 47B | User-defined templates | CP46 sanitization | App-global catalog and storage boundary |

Rationale for the reorder relative to the first pass:

- CP45 moves ahead of CP33 because deterministic terminology checks extend the Review Center and
  grounded semantic review consumes active decisions as trusted requirements.
- Figure metadata (CP43A) must exist before publishing preflight (CP38) can check captions and
  alt text, and before image iteration (CP43B) can preserve figure semantics. Review Center
  figure checks land with CP43A rather than with CP32; see Checkpoint 32.
- The publishing family (CP38-41B) builds on the already-mature Checkpoint 24 export barrier and
  now runs before the riskier import family (CP36-37B).
- Built-in templates (CP47A) do not depend on Clone and need no app migration, but remain late
  because they reuse the sanitization rules proven by CP46; user templates (CP47B) require a new
  app-global storage boundary.

## Library Pre-Selection (2026-08-12 Research)

Recorded from the 2026-08-12 research pass against the npm registry, download APIs, GitHub
metadata, Electron v43.1.0 documentation, and local package inspection. Exact pins below are
pre-selections; each checkpoint refinement re-verifies them under the Mature-Library Gate.

### LaTeX Import Parsing (Checkpoint 37A)

- Pre-selected: `@unified-latex/unified-latex-util-parse@1.8.4` with
  `@unified-latex/unified-latex-util-visit@1.8.4` (traversal) and
  `@unified-latex/unified-latex-util-print-raw@1.8.4` (raw round-trip of unmapped subtrees).
  MIT, pure JavaScript, TypeScript types, active maintenance. Macro arguments attach by known
  CTAN signatures without expansion; unknown macros remain inert nodes; `\input`/`\include`
  arrive as plain AST nodes with no filesystem access.
- Fallback/oracle: `latex-utensils@7.0.0` (MIT, zero runtime dependencies, revived under the
  LaTeX-Workshop maintainer).
- Rejected: `LaTeX.js` (a TeX-to-HTML interpreter that expands macros by design, violating the
  inert-macro rule); `pandoc-wasm` (GPL-2.0, 57 MB).
- Wrappers: parsing runs in the background worker with a hard timeout and input byte caps;
  macro-expansion processors stay disabled; internal `^` ranges in the `@unified-latex` tree
  require lockfile/pnpm-overrides discipline to keep the tree exact-pinned.

### BibTeX Parsing (Checkpoint 37B)

- Pre-selected: `@citation-js/core@0.8.2` + `@citation-js/plugin-bibtex@0.8.2` (MIT, active),
  producing CSL-JSON from BibTeX/BibLaTeX with LaTeX-command-to-Unicode decoding.
- Fallback: `@retorquere/bibtex-parser@10.0.1` (battle-tested in Zotero Better BibTeX; heavier
  dependency tree).
- Rejected: `biblatex-csl-converter` (LGPL-3.0), `astrocite-bibtex` (archived), `bibtex-parser`
  (dead), Zotero translators (requires a separate service).
- Wrappers: citation-js ships no TypeScript types and pulls network-capable `node-fetch` /
  `sync-fetch`. It sits behind one Zod-validated adapter, is fed only strings (never
  URLs/DOIs), and the Main bundle aliases both fetch modules to throwing stubs so the
  no-network rule is structural. It is 0.x: exact pin and re-review on every bump.

### DOCX Generation And Validation (Checkpoint 39)

- Pre-selected: `docx@9.7.1` (MIT, pure JS, bundled TypeScript types, active). Typed object model
  matches the publication-node tree: headings, lists, tables, images with captions/alt text,
  hyperlinks/bookmarks, table-of-contents field, footnotes, page-number footers, and mixed
  CJK/Latin run fonts.
- Rejected: `docxtemplater` (template filler; images/HTML/math require paid modules),
  `html-docx-js` and `officegen` (unmaintained), `pandoc-wasm` (GPL-2.0).
- Determinism: `docx` emits random relationship IDs and build-time zip timestamps. A
  canonicalization post-pass re-packs the zip with fixed timestamps using the existing
  `yazl`/`yauzl` dependencies and normalizes `docProps/core.xml` dates. See Cross-Cutting
  Decisions for the determinism contract.
- Math: KaTeX (already pinned) with `output: 'mathml'`, then a small application-owned
  MathML-to-`docx`-MathComponents mapper (KaTeX's MathML vocabulary is bounded; MIT reference
  implementations exist). Constructs the component set cannot express (matrices, `cases`,
  exotic n-ary) fall back to a KaTeX-rendered PNG `ImageRun` with the LaTeX source as alt text.
  Rejected: `mathml2omml` (LGPL-3.0, and `docx` has no raw-XML injection point).
- Test validation (independent reopen): structural layer with `jszip` + `fast-xml-parser@5.10.1`;
  semantic layer with `mammoth@1.12.1` as a devDependency (mammoth does not read OMML; math is
  asserted at the structural layer only). A manual Word/LibreOffice acceptance pass remains part
  of the checkpoint gate.

### PDF Rendering (Checkpoint 41A)

- Pre-selected: no new dependency. Electron 43 (Chromium 150) hidden `BrowserWindow` plus
  `webContents.printToPDF` with `preferCSSPageSize`, `printBackground`, `generateTaggedPDF`
  (selectable, accessible text), and `generateDocumentOutline` (PDF bookmarks from headings).
- Capture runs in Main. Chromium printing requires a browser context and cannot run in a utility
  process; the first-pass option of moving rendering to the background worker is withdrawn.
- Table of contents: clickable TOC entries are HTML anchors (Chromium preserves links in printed
  PDFs); TOC page numbers use two-pass rendering — pass one without the TOC, read the
  heading-to-page mapping from the first PDF's outline/destinations with the already-installed
  `pdfjs-dist`, inject the TOC, then render the final pass. `pagedjs` is the fallback only
  (stale release cadence).
- Known risks to spike before the decision-complete plan: `generateDocumentOutline` and internal
  link preservation (experimental, thin documentation), and macOS CJK glyph dropout (force a CJK
  font stack, await `document.fonts.ready`, and add a pdfjs text-extraction regression test).
- Test validation: `pdfjs-dist` `getTextContent` (selectable/CJK text), `getOutline` (bookmarks),
  `getAnnotations`/`getDestination` (links).

### LaTeX Generation (Checkpoint 40)

- Decision: hand-written string emitter with a small escaping helper set (`escapeLatex`,
  `escapeLabel`, `escapeKey`), golden fixtures, and one reviewed application-owned template. The
  ecosystem has no maintained generator library: unified-latex offers only verbatim `printRaw`,
  latex-utensils has no stringifier, and `prettier-plugin-latex` is dormant. Self-implementation
  here is the evidence-based outcome of the Mature-Library Gate, not a default.
- Independent verification: parse the generated project with the pinned unified-latex parser
  (already a Checkpoint 37A dependency) and assert the expected AST shape. A manual compile in an
  explicitly provisioned test environment may be acceptance evidence, but the product never
  invokes or requires a TeX compiler.
- Import and export may share escaping/identifier/supported-construct fixtures but must not share
  one bidirectional parser/converter abstraction: their trust boundaries and loss semantics
  differ.

## Cross-Cutting Decisions

1. Match-range source mapping (CP29/CP30). Accepted ADR 021 fixes locale-independent
   `NFC(...).toLowerCase()` matching, application-owned semantic text paths, and a two-layer offset
   source map from search projection to original surface and then to stored inline nodes. The
   common NFC/length-preserving path is linear; only normalization or length-changing surfaces use
   grapheme atoms, and a match may not end inside a non-reversible atom. CP30 builds replacement
   plans on revalidated semantic spans, never on preview, DOM, ProseMirror, or flattened offsets.
2. Snapshot purity (CP32). `check_draft` currently reads live revision content inside snapshot
   checks, and its `safe_links` and `citation_provenance` checks are declared but skipped. CP32
   first extracts a pure snapshot-driven `ManuscriptReview` core and implements the two skipped
   checks; it does not merely surface them. Figure-metadata checks (caption/alt text) are added
   to the Review Center only when CP43A defines that metadata.
3. Batch mutation model (CP30, CP35B). Proposed ADR 022 fixes a replacement application as one short
   SQLite transaction per batch with exact outline-version, section-revision, block-ID, text-hash,
   and match-range preconditions revalidated inside the transaction. Editor flush, network work,
   and materialization stay outside the transaction body. CP35B reuses the CP30 precondition
   planner pattern instead of designing a second batch-apply mechanism.
4. Determinism semantics for binary exports (CP39, CP41A). Determinism is content-level: the same
   captured manuscript state produces a semantically equivalent document, verified by independent
   reopen/parse. Artifact hashes are recorded per build in the export inventory; cross-run byte
   equality is required only for canonicalized DOCX, not for PDF (which embeds a creation date).
5. Untrusted-parse isolation (CP37A/CP37B). LaTeX and BibTeX parsing runs in the existing
   background worker with a hard timeout and input byte caps. The first pass conditioned worker
   use on responsiveness measurements; the trust boundary (hostile file content with no formal
   parser worst-case bound) is the recorded justification instead. Main retains staging, mapping,
   and apply authority.
6. PDF capture location (CP41A). PDF rendering uses a hidden `BrowserWindow` owned by Main. The
   first-pass option of moving heavy rendering to the background worker is removed because
   Chromium printing requires a browser context.
7. Measurement methodology (CP29). CP29 ships a 1,000-section/8-MiB synthetic manuscript fixture
   and a p95 scan-latency benchmark following the `scripts/benchmark-index.mjs` pattern. The fixed
   gate is p95 wall time at most 250 ms and maximum synchronous Main slice at most 16 ms after five
   warmups and across at least 30 complete scans. Missing either threshold stops implementation
   before any manuscript index or authority move is considered.
8. DOCX import. Explicitly deferred beyond this roadmap. CP36's `ImportPlan` contract must not
   preclude a future `mammoth`-to-publication-node adapter.
9. Structured semantic-review results (CP33). Navigable findings require a bounded typed
   review-result payload on Agent events — not parsing assistant prose. This is a presentation
   contract, not a new Agent tool.
10. Annotation semantics (CP44). Annotations roll back with version-history restore like other
    project state. "Annotation failure never blocks manuscript editing" covers runtime service
    failure only; it never bypasses database integrity.

## Checkpoint 29: Manuscript-Wide Find And Navigation

Decision record: accepted [`ADR 021`](../adrs/021-manuscript-find-and-offset-source-map.md)

Planning status: decision-complete; implementation locally complete

### User outcome

The author can find text across the manuscript, filter results, inspect context, and jump to the
exact section and text target without opening the Agent or risking a stale range.

### Fixed product behavior

- Search section titles, objectives, and current BlockNote body text.
- Support literal case-sensitive `NFC(input)` and locale-independent case-insensitive
  `NFC(input).toLowerCase()` matching. Do not use `toLocaleLowerCase`, NFKC, accent stripping,
  transliteration, full Unicode case folding, regular expressions, fuzzy matching, or semantic
  search.
- Treat each title, objective, ordinary block inline surface, table cell, and rich-media caption
  as a separate search surface. A phrase may cross style/link nodes inside one ordinary inline
  surface but never crosses metadata fields, blocks, table cells, captions, or child blocks.
- Include code-block inline text and visible captions. Exclude image names and Mermaid/math source
  from the Renderer search because they are not visible manuscript prose in the main editor.
- Return one result per non-overlapping occurrence with section title/status, outline heading path,
  bounded plain-text preview, exact target kind, snapshot fingerprint, and stable `matchId`.
- Express body matches as semantic spans over the stable block ID, typed inline/table-cell path,
  and original per-text-node UTF-16 ranges. Metadata and caption results use their typed field plus
  original UTF-16 range. A ProseMirror/DOM position or flattened offset is never authoritative.
- Filter by section, outline subtree, and section status; bounded, paginated results.
- Order results by outline, surface, and original range. Page 25 by default and at most 50; expose
  at most 2,000 navigable occurrences per request fingerprint, with an explicit result-limit state
  rather than a fabricated total.
- Activate a result by flushing pending editor/title changes, revalidating the exact semantic path
  and source-slice hash in Main, switching through the serialized section path without editor
  autofocus, loading the validated revision, scrolling, and temporarily highlighting without
  rewriting the document. A stale result refreshes and remains unselected; nearest-text guessing
  is prohibited.
- Add `Cmd/Ctrl+F` plus an enabled-project Menubar item. Find is a workspace-rail destination that
  keeps the editor mounted and uses the existing secondary-sidebar/mobile-sheet behavior.
- Compose the remote result list with shadcn `Command` (`shouldFilter={false}`) and existing
  Sidebar/Sheet, Button, DropdownMenu/Popover, Badge, and Empty primitives. Filters use progressive
  disclosure. The selected result, not a short timer, remains the accessible state.

### Exact offset source-map decision

The matcher constructs two mappings:

```text
search projection UTF-16 interval
-> raw visible search-surface UTF-16 interval
-> one or more typed original text-node/property UTF-16 intervals
```

The second mapping is a sequence of `SourceRun` records over the concatenated original surface.
The first is an `OffsetMapRun` sequence. If the raw surface is already NFC and lowercasing (when
enabled) preserves UTF-16 length, one linear run covers the surface. Only a surface whose NFC form
changes or whose lower mapping changes length uses one reused
`Intl.Segmenter('und', { granularity: 'grapheme' })` and per-grapheme runs.

Composition, reordering, expansion, or contraction creates an atomic run. Search candidates may
start/end at linear positions or atomic boundaries, never inside an atomic run. The per-grapheme
projection must equal the whole-surface projection or the operation fails closed. This makes a
composed `é` query locate the two original UTF-16 units of decomposed `e` plus acute, while a query
cannot claim half of a length-expanded lowercase source character.

Offset maps are ephemeral derived values. They are never persisted, logged, returned as generic
paths, or accepted later without revalidation. The complete algorithm, target types, Unicode
non-goals, and invariants are fixed in ADR 021.

### Main contract and snapshot consistency

- Add strict shared manuscript-search request/result/navigation schemas. Query length is 1-512
  well-formed UTF-16 code units; section/filter arrays, previews, paths, pages, and total IPC bytes
  have explicit bounds.
- Main assembles outline metadata and every current revision in one existing short SQLite snapshot
  and fingerprints its versioned canonical IDs/versions/hashes. Search itself performs no write.
- A cursor binds its version, snapshot fingerprint, request fingerprint, and next ordinal. Main
  recomputes all fields. A changed snapshot/options set, malformed cursor, or project switch fails
  stale/invalid and never mixes pages.
- Track each scan in the active project operation registry, check abort between surfaces, yield
  after at most 16 ms of synchronous Main work, and stop visibly at the 250 ms scan budget. Return
  `incompleteReason: 'result_limit' | 'scan_budget'` plus scanned counts; never silently omit.
- Navigation revalidation accepts only the exact returned semantic target, source-slice hash,
  query/mode, and active session. An unrelated save may leave the exact target valid; a changed
  path, range, or slice is stale even if similar text exists nearby.
- Authorize IPC senders and validate `projectSessionId` before capture and after asynchronous
  work. Project close/switch aborts outstanding scans and clears Find state.

### Editor navigation adapter

- Extend `SectionEditorHandle` with one bounded reveal/clear intent. The Renderer never receives a
  generic ProseMirror command or raw IPC capability.
- Implement an application-owned BlockNote extension using the official extension/ProseMirror
  plugin surface and `DecorationSet`, parallel to the readable-citation extension. Resolve the
  stable block ID and validated surface-local range against the loaded revision; do not use
  `_tiptapEditor` or persist positions.
- Prove Find and readable-citation decorations coexist. Editing, query/result change, Escape, Find
  close, and project switch clear the highlight.
- Inline/table results decorate the exact range; captions mark and scroll their owning media block;
  title selection occurs only on explicit edit; objective activation opens the existing outline
  editor at that section/field.
- Navigation does not change Agent conversation, stream, selection capture, proposal state, or
  panel focus. It honors reduced motion and announces loading, result, stale, incomplete, empty,
  and error states.

### Integration And Complexity Control

Extract the current Agent-only projection matcher from `src/main/agent/read-tools.ts` into a
credential-free pure domain module. Pure source enumerators, projection/source mapping, semantic
span construction, ordering/filtering, and snapshot fingerprinting remain application-owned. A
narrow Main service owns assembly, cooperative budgets, pagination, navigation revalidation,
logging, and Renderer IPC.

The existing Agent tool calls the same projection/source-map matcher behind its current snapshot,
surface, and output limits. Its model-visible tool name and schema do not change; legacy
`matchRanges` are corrected to original Agent-text UTF-16 coordinates by an adapter. The Renderer
does not call the Agent tool, and Agent code does not consume Renderer contracts.

Do not index manuscript content in `index.sqlite` yet: the current single-manuscript,
current-revision scan is simpler and authoritative. The benchmark must pass the fixed gate below.
If it fails, stop and revise the decision with measured alternatives; do not silently add a
manuscript index, worker responsibility, or persistence.

No migration, Agent tool, worker, durable job, or persisted search history is expected.

### Implementation slices

1. Pure search domain and benchmark: typed surface enumeration, hybrid linear/atomic offset source
   map, semantic-span/property tests, snapshot fingerprint, filters/order, and the maximum fixture.
2. Main and compatibility: strict contracts, request-scoped service/IPC, cursor/budget/cancellation,
   safe logs, navigation revalidation, and unchanged Agent-tool projection over the shared matcher.
3. Renderer vertical outcome: Find rail/sheet, Menubar/shortcut, query/filter/pagination states,
   serialized flush/revalidate/switch sequence, editor decoration adapter, title/objective/caption
   targets, and accessibility/responsiveness.
4. Integrated verification and evidence: focused suites, benchmark gate, Electron/build/E2E,
   recovery/session cleanup, scoped Impeccable detector, diff check, and documentation/status
   update.

Slices are one checkpoint, not separately shippable authority. Do not begin slice 2 if the pure
mapping invariants or performance decision gate fail.

### Acceptance gate

- Unicode fixtures cover NFC composed/decomposed forms, combining reorderings, dotted/dotless I,
  Greek sigma, sharp S, CJK, emoji/surrogates, and expansion/contraction. Host locale changes do not
  change results. Property tests prove projection/source-map round trips and atomic-boundary
  rejection.
- Styled/link-crossing matches return exact ordered semantic segments. Title, objective, ordinary
  inline, table cell, code, and caption surfaces are covered, while prohibited surface boundaries
  never merge.
- Filters, deterministic order, pagination, cursor tampering/staleness, 2,000-result cap, 250 ms
  budget exit, abort, project switch, sender/session rejection, and IPC output bounds fail visibly
  and safely.
- The Agent and Renderer adapters agree on shared fixtures, the Agent tool schema remains
  unchanged, and every Agent legacy range slices the original Agent text exactly.
- A result never targets an old revision after flush/revalidation. Unrelated saves may validate;
  edits to the target path/range/slice never auto-relocate. Unsaved content is preserved.
- Exact editor decoration, readable-citation coexistence, edit invalidation, title/objective/caption
  navigation, Agent-state/focus preservation, reduced motion, keyboard-only use, screen-reader
  status, and desktop/narrow layouts pass focused and Real-Electron coverage.
- `scripts/benchmark-manuscript-search.mjs` uses 1,000 sections and 8 MiB with five warmups and at
  least 30 samples. Representative complete scans pass p95 <= 250 ms and maximum synchronous Main
  slice <= 16 ms, with recorded runtime, fixture fingerprint, counts, slow-path surfaces, and RSS
  delta.
- `pnpm check:fast`, focused tests, `pnpm check:electron`, fresh build plus applicable focused/full
  E2E, scoped Impeccable detector, and `git diff --check` pass. `check:package` and `check:release`
  are out of scope because CP29 changes no package/release boundary.

### Completion evidence

- The 1,000-section fixture serializes to 10,419,993 bytes and contains 4,051 surfaces, including
  1,001 Unicode slow-path surfaces and one 75,000-UTF-16-unit decomposed surface. After five
  warmups, 30 Node v24.18.0 arm64 samples passed at p50 32.34 ms, p95 34.66 ms, and maximum
  synchronous Main slice 12.02 ms.
- Focused source-map, semantic-span, Main service, IPC, Agent compatibility, editor decoration,
  panel, outline-targeting, and responsive close-path suites pass. Exact revalidation accepts an
  unrelated new revision only when the path, original range, and slice remain identical.
- `check:fast`; `check:electron` with 146 passing files, 798 passing tests, two opt-in benchmark
  skips, and a production build; fresh focused and full Real-Electron E2E with 26/26 scenarios;
  all 25 recovery fixtures from 23 sources; one clean scoped Impeccable detector run followed by
  a fresh finish review and remediation; and `git diff --check` pass.
- Package/release, hosted CI, commit, tag, push, and publication were not run.

### Explicitly deferred

Regular expressions, fuzzy/semantic search, accent-insensitive or full Unicode case folding,
cross-block phrases, persisted history, replacement, a manuscript index, and generic command
palette remain deferred. Checkpoint 30 owns every replacement plan and mutation boundary.

## Checkpoint 30: Safe Manuscript-Wide Replacement

Decision record: accepted
[`ADR 022`](../adrs/022-safe-manuscript-wide-replacement.md). Implementation is locally complete.

### User outcome

The author can preview and selectively apply a literal replacement across sections without hidden
or partial edits.

### Scope

- Extend Find with an explicit Replace mode that creates a complete Main-owned plan only after the
  serialized pending-title flush plus an in-scope active-body flush. Plan creation reruns the CP29
  matcher against one authoritative assembly; Renderer search pages and flattened offsets never
  become mutation input.
- Make ordinary inline text, table-cell prose, and rich-media captions eligible. Show but make
  unselectable title/objective, canonical-citation, link, code-block, inline-code, mixed-structure,
  and unchanged hits with a fixed human-readable skip reason. Formula/Mermaid source and image
  identity remain outside the search surface.
- Accept exact single-line replacement text from 0-4,096 well-formed UTF-16 code units. Empty text
  deletes a match; no normalization, markup interpretation, block splitting, or semantic/regex
  replacement is added.
- Retain one opaque 15-minute plan per project session, page at most 50 of at most 2,000 exhaustive
  candidates, cap one IPC page at 512 KiB and plan memory at 32 MiB, yield within 16 milliseconds,
  and fail rather than expose an applicable partial plan after 500 milliseconds.
- Default selection to empty. Apply at most 500 eligible candidates across at most 100 sections
  from one plan. Revalidate exact outline version and every selected section/revision/block/
  string/range precondition; tolerate body changes only in unselected sections.
- Apply multi-node matches deterministically from right to left. Replacement inherits the first
  matched ordinary text node's style; matched pieces are removed from later nodes, untouched
  text/style/structure stays in place, and captions use exact property splices.
- Commit all selected canonical changes in one immediate SQLite transaction with one new
  `manual` / `manual_checkpoint` revision per affected section. Recalculate hashes/counts, record
  full revision asset references, update current pointers by compare-and-swap, and commit none if
  any selected precondition fails.
- Keep materialization outside the transaction. Report a committed batch with explicit pending-
  repair section IDs if a mirror publication fails; startup repair remains authoritative. A
  committed result never means only a subset of selected revisions was accepted.
- Return a 30-minute, session-bound, per-section Undo capability. Undo requires the replacement
  revision still be current, appends one `undo` / `manual_checkpoint` revision from its retained
  parent, and cannot discard later work. Protect direct parents of retained manual checkpoints in
  revision pruning.
- When managed project history is already ready, optionally create a pre-change checkpoint whose
  generated name contains no manuscript text, then revalidate. Never auto-enable or repair history.
- Publish a typed affected-section/revision event after commit so the mounted editor reconciles
  through the existing serialized mutation path and cannot autosave its old document over the
  replacement.

### Integration And Complexity Control

Add one pure replacement transformer plus one manuscript-specific plan/application service. The
service owns one live in-memory capability and bounded idempotence/Undo state; it does not add a
generic batch-command framework, durable job, persistence table, migration, worker, index,
provider call, or Agent tool/schema. Literal replacement ships before AI/semantic replacement.

The proposed implementation direction is one short SQLite transaction for the selected canonical
batch. Editor/title flush, optional project checkpoint, and materialization remain outside the
transaction body. A consumed live plan returns `already_applied` for the same command/selection;
plan capabilities deliberately do not survive process restart. Database authority plus existing
materialization repair handles a crash after commit.

Implementation slices:

1. Pure eligibility, citation/structure overlap, semantic revalidation, and multi-node transform.
2. Strict contracts, exhaustive bounded planner, paging, expiry/revocation, and safe logging.
3. Atomic revision application, asset/count integration, retention protection, materialization,
   idempotence, and per-section Undo.
4. Sender/session-authorized IPC, active-editor barrier, optional project checkpoint, typed change
   events, preload projection, and close/switch revocation.
5. Find/Replace preview, default-empty grouped selection, skip reasons, apply/conflict/repair/Undo
   states, narrow layout, accessibility, and editor reconciliation.
6. Focused, fault, Electron, E2E, performance, recovery, Impeccable, and diff gates.

### Acceptance gate

Cover Unicode projection edge cases and exact replacement bytes; ordinary/cross-styled/table/
caption transforms; every structured skip reason; exhaustive-plan/result/byte/time/memory bounds;
cursor/capability tampering and expiry; duplicate/zero/ineligible/over-limit selections; concurrent
manual and Agent edits; changed match counts and outline; exact revision/block/string/range
revalidation; nested rich blocks, citations, links, code, assets, and duplicate matches; injected
failure at every transaction step; parent retention; materialization failure and restart repair;
same-command retry; per-section stale/successful Undo; version-history states; project switch;
mounted-editor reconciliation; keyboard/screen-reader and narrow Replace UI; and no interaction
with Agent conversation/proposal state.

The disposable-database performance fixture applies 500 selected replacements across 100 sections
with mixed styled/table/caption/citation/link/asset content. After warmup, at least 30 samples must
keep the synchronous SQLite transaction body at p95 100 milliseconds or less. A miss stops
implementation for a revised bound or decision; it does not permit partial commit or a new worker.

Final gates are the focused suites, `pnpm check:fast`, `pnpm check:electron`, fresh focused/full
Real-Electron E2E, all recovery fixtures, scoped Impeccable review, and `git diff --check`.
Package/release verification is required for this implementation because the user separately
requested a local App build. No accepted replacement may be reported unless all
selected exact preconditions and canonical revisions committed.

### Explicitly deferred

Title/objective replacement, structured citation/link/code/source editing, regular expressions,
semantic or AI replacement, formatting replacement, block creation/splitting, a durable
replacement audit record, generic revision restore, generic batch commands, and persisted
replacement history remain deferred.

## Checkpoint 31: Selection-Based Quick AI Actions

Implementation completed on 2026-08-12 after explicit user authorization. ADR 023 fixes the
conversation, selection-validation, prompt-ownership, review-only, and UI boundaries.

### User outcome

Common rewrite operations become available directly from a text selection while preserving the
same review and safety behavior as the full Agent panel.

### Scope

- Offer a restrained selection toolbar and keyboard command for rewrite, shorten, expand, adjust
  tone, check evidence, align with manuscript, and custom instruction.
- Open or reuse one normal Agent conversation with the existing captured selection/revision
  context. The toolbar itself performs no model call and never constructs a mutation. The
  conversation policy (reuse the visible conversation versus a dedicated quick-action
  conversation) is fixed in the decision-complete plan, not left to runtime heuristics.
- Show progress in the existing Agent surface and return the normal typed proposal diff.
  Evidence-check style actions may legitimately end in a review-only outcome with no proposal;
  the UI must present that as a success state, not a failure.
- Preserve the selected model, Thinking level, Writing Skill, context scope, and approval policy.
- Keep selection actions available on narrow layouts and fully keyboard accessible.

### Integration And Complexity Control

Treat quick actions as bounded Main-owned task templates passed to the existing Agent start path.
Do not add a second AI runtime, inline model provider, quick-action table, automatic direct
write, or new Agent tool. Renderer-local presets are fixed application commands in the first
version; user-authored reusable prompts remain deferred until usage proves the need.

### Acceptance gate

The exact selection snapshot must be visible and stale selections must fail safely. A quick
action must produce the same proposal lineage, citation provenance, stop/steer behavior, usage
accounting, and review continuation as a manually entered Agent request, including the
review-only outcome.

### Implementation checklist

- [x] Add bounded quick-action and exact-selection contracts without a migration or new Agent tool.
- [x] Add Main-owned task templates and current-revision/block/text revalidation.
- [x] Reuse the visible normal Agent conversation and preserve all session/run settings.
- [x] Add the compact selection toolbar, `Cmd/Ctrl+Shift+K`, custom instruction, and narrow/a11y states.
- [x] Display the frozen selection snapshot in the ordinary Agent timeline.
- [x] Cover stale selection, prompt escaping, review-only success, lineage, controls, and E2E flows.
- [x] Pass focused suites, `check:fast`, `check:electron`, fresh E2E, recovery fixtures,
  scoped Impeccable detection, and `git diff --check`.

### Completion evidence

The focused contract, prompt, Main, IPC, and Renderer suite passed 55 tests. `check:fast` passed.
`check:electron` passed 150 Electron-hosted test files and 816 tests with three opt-in files/tests
skipped, followed by a successful production build. The focused CP31 Real-Electron scenario proved
the keyboard entry, exact frozen selection, ordinary conversation reuse, Main-owned evidence task,
review-only completion, and no proposal; the fresh full suite passed all 28 scenarios. The 25-case
recovery fixture verifier passed, scoped Impeccable detection returned no findings, and
`git diff --check` passed. Package/release, hosted CI, commit, tag, push, and publication were not
run for the CP31 implementation gate. On 2026-08-12 the user separately authorized release
metadata `0.2026.8.16` and an unsigned local macOS arm64 App build for hands-on testing; its package
gate passed 12 packaged runtime smoke scenarios, 17 packaged E2E scenarios, and all 25 recovery
fixtures, verified arm64 native resources plus a no-Team-ID signature, and produced the App, DMG,
and ZIP.

## Checkpoint 32: Deterministic Review And Problem Set

Implementation authorized together with CP45 and CP33 under accepted ADR 024. The existing
ordinary Agent conversation remains the only model execution surface; the Workbench is a passive
projection and never starts a review.

### Implementation checklist

- [x] Extract a pure `check_draft` core that reads one immutable run snapshot and never rereads a
  live revision.
- [x] Return bounded P0-P3 findings with stable check IDs, evidence, exact anchors, and explicit
  passed/failed/skipped/unavailable outcomes.
- [x] Implement structure, outline, lineage, safe-link, placeholder, duplicate, length, empty
  section, objective, unresolved citation, References availability, unused resource, and bounded
  citation-provenance checks.
- [x] Add project-local `review_issues` and append-only `review_issue_events` with exact
  fingerprint deduplication, optimistic versions, assignment transfer, orphaned anchors, and
  proposal linkage.
- [x] Add bounded `list_review_issues`, `record_review_issues`, and `update_review_issues`
  Agent fixture tools without manuscript/task authority.
- [x] Add a passive responsive Issues Workbench with priority/status/category/section filters,
  navigation, evidence, lineage, proposal, history, and user correction controls.

## Checkpoint 45: Agent-Native Writing Rules

### Implementation checklist

- [x] Store strict `writingRulesV1` inside versioned Brief `extensible` state: 100 total, 50
  active, and a fail-closed 32 KiB active context budget.
- [x] Add typed add/update/activate/deactivate/remove operations and block generic
  `submit_brief_change` from writing the reserved namespace.
- [x] Add `submit_writing_rules_change` as an ordinary Brief-version-bound proposal with a
  concise rules diff and no hidden extraction/model request.
- [x] Inject every active rule in full as `TRUSTED_WRITING_RULES` below application policy;
  inactive rules are excluded and conflicts fail closed.
- [x] Add deterministic NFC-aware Latin whole-word and CJK exact-substring terminology checks.
- [x] Add a passive Writing Rules Workbench with instruction-first add, collapsed advanced fields,
  direct edit/toggle/remove, and versioned Brief updates.

## Checkpoint 33: Agent-Native Semantic Review And Repair

### Implementation checklist

- [x] Add an application-owned `REVIEW_POLICY` to the ordinary Agent prompt; add no review
  session/run type, provider/runtime, job, report table, nested model call, or conversation flow.
- [x] Direct the Agent to read Writing Rules and active issues, call `check_draft`, inspect the
  requested manuscript scope and evidence, distinguish observation/retrieval/inference, record
  actionable issues, and summarize durable issue IDs by P0-P3.
- [x] Define “check and fix” as record, prioritize, claim, inspect, propose, approve/continue, and
  repeat through the existing Agent loop.
- [x] Add optional `resolvesReviewIssues` provenance to existing proposal/effect tools and
  validate current assignment plus optimistic issue version.
- [x] Resolve linked issues only after authoritative applied/satisfied outcomes; surface version
  races without rolling back manuscript edits; reopen unchanged resolver-owned issues on undo.
- [x] Preserve truthful issue state for rejection, refresh, conflict, cancellation, provider
  failure, and project switch.

### Acceptance evidence

Focused contract, deterministic-check, context, Agent-tool, Review Issue, mutation-reconciliation,
IPC, migration, and Workbench tests are implemented. Final evidence passed `check:fast`;
`check:electron` with 154 passing Electron-hosted test files, 829 passing tests, and three skipped
opt-in files/tests; a production build; focused Agent-native and passive-Workbench scenarios;
fresh full Real-Electron E2E with 30/30 scenarios; all 25 recovery fixtures from 23 sources; clean
scoped Impeccable detection; and `git diff --check`.

## Checkpoint 34A: Writing-Task Identity And Plan Model

### User outcome

A long cross-section request has a durable, unambiguous identity and plan structure that later
checkpoints can group, display, and reconcile.

### Scope

- Freeze in an ADR: task ID allocation and lifetime, plan version numbering, step IDs and the
  step state machine (pending, active, completed, skipped, blocked), plan-size limits, and the
  persistence mechanism (a versioned bounded payload on Agent session/event rows versus one
  narrow new table; `agent_sessions` has no general metadata column today, so a schema decision
  is required either way).
- Let the user start a bounded writing task within one Agent conversation; persist one
  human-readable objective and an ordered bounded plan.
- Keep one task line per conversation; use current project-level Agent work reservations.

### Integration And Complexity Control

Prefer the smallest persistence that satisfies the identity requirements. The plan is
collaboration state, not mutation authority: manuscript, proposal, and model-request rows remain
authoritative for actual effects. Do not add a scheduler, durable Agent job, background recovery
loop, subagent, or cross-project task manager. Task boundaries must be explicit durable IDs —
deriving them from event order is ambiguous under retries, plan revision, recovery, and
concurrent conversations, and is rejected.

### Acceptance gate

Task and step identities survive restart, archive/restore, and project close/reopen; plan
versions are monotonic; every progress event carries an exact task/step correlation.

### Acceptance evidence

Accepted ADR 025 defines UUID task/step identity, the bounded plan state machine, monotonic
optimistic versions, and one narrow project-local table. The implementation adds ordinary Agent
task tools, exact proposal correlation, and a passive conversation projection without adding a
scheduler, worker, subagent, or manuscript authority. Focused tests, `check:fast`, `check:electron`
with 157 passing files and 835 passing tests, the production build, focused and full Real-Electron
E2E with 31/31 scenarios, all 25 recovery fixtures, scoped Impeccable detection, and
`git diff --check` passed. The task scenario proves identity across archive/restore, project close,
and application restart.

## Checkpoint 34B: Writing-Task Progress, Reconciliation, And Recovery

### User outcome

The author sees the plan's current step, completed steps, and remaining work, and can stop,
resume, or revise the plan, with the display always telling the truth about manuscript effects.

### Scope

- Correlate plan progress with exact Agent runs and existing proposal/application outcomes.
- Display the plan in the existing conversation canvas; allow stop, resume, or plan revision
  while the conversation is idle.
- Implement restart/restart-after-crash reconciliation: durable proposal and revision state
  decides what is truly complete; model narration that disagrees is reconciled, never trusted.

### Integration And Complexity Control

Presentation and reconciliation over the CP34A model. The UI must never mark a manuscript step
complete solely from assistant prose when the corresponding authoritative effect failed or
remains pending. Progress computation stays derived from authoritative rows; only user-authored
plan edits are durable.

### Acceptance gate

Restart, archive/restore, stop, retry, request-changes continuation, provider failure, and
project close must preserve a truthful plan. Reconciliation disagreement states are explicit and
recoverable.

### Acceptance evidence

Migration 0031 adds exact nullable task/step snapshots to ordinary Agent runs. Main derives bounded
per-step progress from correlated run status and authoritative proposal outcomes, including
pending review, verified effects, stopped/failed work, report-only completion, and explicit
disagreement. Idle user revisions reuse the optimistic CP34A service; Resume sends a Main-authored
request to the same conversation and first calls `get_writing_task`. Focused reconciliation,
migration, IPC, and session tests, `check:fast`, `check:electron` with 158 passing files and 839
passing tests, the production build, focused and fresh full Real-Electron E2E with 31/31 scenarios,
all 25 recovery fixtures, scoped Impeccable detection, and `git diff --check` passed.

## Checkpoint 35A: Read-Only Cross-Section Change-Set Review

### User outcome

Proposals created by one writing task can be inspected as a coherent manuscript-wide change set
before any batch decision exists.

### Scope

- Group existing brief, outline, section, and image proposals by the CP34A task boundary.
- Present a summary and per-section diffs without replacing the current exact proposal diff.
- Report applied, satisfied, superseded, conflicted, rejected, and pending outcomes separately,
  derived from current authoritative proposal state.
- Provide navigation from each group item to the normal proposal review surface.

### Integration And Complexity Control

Derive the set from task-scoped Agent events, runs, and `mutation_proposals`. Do not introduce a
second proposal table or generic transaction coordinator. If field requirements prove a durable
change-set identity is needed beyond the task ID, add the smallest project-local relation after
an ADR; do not broaden it into a workflow engine.

### Acceptance gate

Grouping must be exact under retries, plan revisions, and concurrent conversations; stale
proposals surface their ADR 003 refresh state; a project switch or restart reproduces the same
grouping.

### Acceptance evidence

The Renderer derives one bounded task change set from exact proposal task/step correlation,
preserves every refresh-chain outcome, groups brief/outline/body/image authorities, shows persisted
per-item exact diffs and stale refresh-required state, and navigates to the ordinary proposal
surface. It adds no persistence, IPC, provider work, or mutation authority. Focused projection
tests, `check:fast`, `check:electron` with 158 passing files and 840 passing tests, a production
build, and the focused Real-Electron task scenario passed; the scenario covers Agent-created task
and proposal, rejection, archive/restore, and app restart reconstruction.

## Checkpoint 35B: Change-Set Batch Decisions And Apply

Decision record: accepted
[`ADR 026`](../adrs/026-agent-change-set-batch-sequencing.md)

### User outcome

The author can apply or reject selected items of a change set with per-item control and a
truthful overall result.

### Scope

- Allow apply selected, request changes for one item, reject selected, and resume the remaining
  task.
- Refresh stale section proposals through ADR 003; never silently rebase or apply an old base.
- Define in an ADR: proposal dependency ordering (for example outline-before-body), stop-on-
  conflict behavior, idempotence of repeated batch commands, and crash recovery mid-batch.
- Integrate optional pre-change version checkpoint creation when history is already enabled.
- Provide a post-application deterministic review and a clear partial-result summary.

### Integration And Complexity Control

Apply remains a Main-owned sequence of existing proposal decisions with exact precondition
checks, reusing the CP30 planner pattern (Cross-Cutting Decisions, item 3). An all-or-nothing
multi-proposal transaction is not assumed: brief, outline, section, asset, and external image
effects have different authorities. The UI must model partial outcomes honestly.

### Acceptance gate

Cover multiple proposals in one section, proposals across sections, outline/body dependencies,
stale refresh, rejected repairs, image-generation failure, crash between applications, undo,
repeated identical batch commands, and version-history unavailable/damaged states. No group
action may bypass each proposal's current authorization and validation.

### Acceptance evidence

Accepted ADR 026 fixes deterministic Brief/Outline/body/image ordering, stop-on-adverse partial
results, durable per-command idempotence, crash-window reconciliation, and ready-only optional
history checkpoints. Main invokes the existing proposal approval/rejection services item by item;
it records no duplicate proposal authority and performs no model work. Focused tests cover
dependency ordering, conflicts, partial results, replay, the crash-after-effect window, approval
audit repair, undo drift, migration, IPC authorization, and the Renderer batch surface. Final gates
passed `check:fast`; `check:electron` with 160 files and 844 tests; the production build; 31/31
fresh full Real-Electron scenarios including durable batch rejection through restart; all 25
recovery fixtures from 23 sources; scoped Impeccable detection; and `git diff --check`.

## Checkpoint 43A: Figure Identity, Caption, And Alt Text

Decision record: accepted
[`ADR 027`](../adrs/027-figure-semantics-and-schema-v3.md)

### User outcome

Every manuscript figure has a stable identity and explicit caption/alt-text metadata that review,
publishing, and iteration can rely on.

### Scope

- Extend the BlockNote image block with application-owned figure metadata: stable figure ID,
  caption, and alt text. (The current block carries only `name` and `caption`; there is no
  independent `altText`.) Requires a BlockNote schema version and a forward-only project
  migration that backfills existing image blocks.
- Surface caption/alt presence as deterministic Review Center checks (additive entries in the
  CP32 core).
- Define derived figure numbering from current manuscript order; no durable numbers.
- Define the publication-node figure contract consumed by CP38.

### Integration And Complexity Control

One schema migration plus bounded Renderer editing UI; no generation, provider, or lineage work
in this checkpoint. Migration follows the repository's forward-only rules with backup, integrity
checks, and recovery coverage. Missing caption/alt text is a review finding, never a persistence
blocker.

### Acceptance gate

Old revisions remain readable; migrated and new figures keep stable IDs across edits, undo, Agent
proposals, export, and version-history restore; Review Center reports exact figure targets.

### Acceptance evidence

Accepted ADR 027 fixes stable application-owned figure IDs, explicit caption/alt metadata,
derived-only numbering, a typed publication figure node, and additive deterministic review checks.
Migration 0033 widens the revision constraint, preserves every historical revision body, appends a
new normalized current revision using the next free history number, copies asset references, and
passes foreign-key validation. Focused migration, history, export, review, schema, and Renderer
tests passed. Final gates passed `check:electron` with 162 files and 848 tests; the production
build; 31/31 fresh full Real-Electron scenarios including metadata edit, export, project reopen,
and stable identity; all 25 recovery fixtures from 23 sources; scoped Impeccable detection; and
`git diff --check`.

## Checkpoint 42: Manuscript Asset Workspace

Decision record: accepted
[`ADR 028`](../adrs/028-manuscript-asset-workspace-and-safe-deletion.md)

### User outcome

The author can see every manuscript image, where it is used, how it was created, and whether it
is safe to remove.

### Scope

- List generated and uploaded assets using existing metadata and session-bound preview URLs.
- Show MIME, dimensions, size, creation time, generation lineage, and current revision
  references. Dimensions are validated at store time today but not persisted; a bounded metadata
  migration adding width/height columns is the expected implementation, decided in the
  decision-complete plan.
- Filter by used, unused, generated, uploaded, and current section.
- Navigate from an asset to each current section/block reference.
- Permit deletion only when no current revision, retained proposal, or other protected lineage
  requires the asset; any retained historical revision reference also protects the asset in this
  first version (retain and explain). A purge flow for historical-only references is deferred.
- Keep existing grace-period cleanup and immutable bytes.

### Integration And Complexity Control

Add bounded list/usage projections to `ManuscriptAssetService`; do not scan the project directory
from Renderer or create a second asset catalog. Current revision usage derives from
`section_revision_assets` and BlockNote references.

### Acceptance gate

Cover shared assets, historical-only references, pending image proposals, missing or tampered
asset files, cleanup races, project switch, large libraries, and keyboard navigation. The
workspace must never expose absolute paths or raw asset bytes outside existing capabilities.

### Acceptance evidence

Accepted ADR 028 keeps `manuscript_assets` as the only catalog, adds validated dimensions and a
two-phase deletion state, and fixes current/history/proposal protection plus cursor pagination.
Focused migration, asset-service, mutation, IPC, and Renderer coverage passed. Final gates passed
`check:electron` with 163 files and 851 tests; the production build; focused and fresh full
Real-Electron E2E with 31/31 scenarios including listing, protected usage, unprotected deletion,
exact navigation, and reopen; all 25 recovery fixtures from 23 sources; scoped Impeccable
detection; and `git diff --check`.

## Checkpoint 43B: Image Iteration And Candidate Lineage

Status: Completed locally on 2026-08-13 under accepted ADR 029. The ordinary `generate_image`
tool accepts an exact block-hash iteration target, Main reuses retained prompt/specification plus
bounded current section context, and the existing image gateway publishes an immutable candidate.
The generation request is then superseded by a normal section proposal: rejection keeps current,
replacement updates only the asset URL, insert-another creates a new figure, and the Images
workspace compares retained lineage with session-bound previews. Forward migration v35 records
parent/candidate, generation proposal, section proposal, model request, Agent run, and tool call.
Focused tests prove exact provenance, candidate deduplication compatibility, stale target safety,
figure metadata preservation, undo, workspace lineage, and cleanup protection. `check:fast` and
`check:electron` passed with 164 files / 853 tests, three skipped opt-in tests, and a production
build; final Phase 11 verification owns the cumulative E2E, recovery, UI, diff, and package gates.

### User outcome

The author can iterate on a generated figure and replace it in place without losing the figure's
identity, caption, alt text, or manuscript history.

### Scope

- Generate another candidate from an existing image's prompt/specification and current manuscript
  context using the existing image provider role.
- Preserve immutable candidate assets and show their lineage; replacement creates a normal
  section proposal against the current block/revision and preserves CP43A figure metadata.
- Support keep current, replace, insert as another figure, and compare candidates.
- Bounded cross-reference presentation may follow once figure identity proves stable. True pixel
  editing, crop tools, masks, and arbitrary image-to-image provider calls remain deferred.

### Integration And Complexity Control

Reuse the current background-worker image gateway, `model_requests`, asset publication,
generation provenance, and `submit_section_change`. Add only a parent/variant lineage relation if
existing generation metadata cannot express it; an ADR and forward-only migration are required
before doing so. Do not introduce an image-provider plugin framework or mutable asset bytes.

### Acceptance gate

Cover generation cancellation/failure, candidate deduplication, stale target blocks, shared
current assets, replacement/undo, caption/alt preservation through CP43A metadata, checkpoint
restore, orphan cleanup, and exact model/Agent provenance.

## Checkpoint 38: Publishing Assembly And Preflight

### User outcome

Before choosing an output format, the author can inspect one deterministic publication model and
resolve issues that would otherwise appear only after export.

### Scope

- Build a format-neutral publication assembly from the current manuscript, outline, reference
  index, CP43A figure metadata, and verified asset inventory.
- Define heading hierarchy, paragraphs, lists, tables, formulas, Mermaid, figures, citations, and
  References as typed publication nodes without replacing BlockNote as authority. The publication
  node schema plus its shared golden-fixture corpus is the primary deliverable of this
  checkpoint; CP39/40/41A converters are tested against the same corpus.
- Add preflight findings for unsupported blocks, missing assets, invalid heading hierarchy,
  unresolved citations, absent figure metadata, empty sections, and known format losses.
- Provide a bounded preview/summary and navigation back to each issue.
- Reuse the current export consistency barrier, final editor flush, asset capture, validation,
  staging, and atomic publication rules.
- Define the shape of reusable publication options (page size, margins, template) so CP39/40 can
  consume the same contract; durable preset persistence remains CP41B.

### Integration And Complexity Control

Extend the existing manuscript export module with one pure publication projection and one shared
preflight result. Do not create a general document object model intended to replace BlockNote,
and do not persist the publication assembly. Native and Markdown exports remain readable and may
adopt shared pieces only when their current behavior can be preserved.

### Acceptance gate

The same captured manuscript state must drive preview, preflight, reference numbering, asset
inventory, and the eventual format converter. An export must not silently proceed past errors;
any allowed loss must appear in a machine-readable and human-readable report.

### Completion evidence (2026-08-13)

Complete. One non-persisted typed assembly projects current revision identities, references,
verified assets, figure metadata, reusable options, deterministic findings, and a source hash.
The passive preflight dialog exposes exact issue navigation and readiness; converter entry is
fail-closed. Focused tests, `check:fast`, and the shared CP38/39 `check:electron` gate passed 165
files / 857 tests with three opt-in skips plus the production build.

## Checkpoint 39: DOCX Publication

### User outcome

The author can produce a portable Word document suitable for editing, review, and delivery.

### Scope

- Convert the Checkpoint 38 publication assembly to DOCX with the pre-selected `docx` library
  (re-verified and exact-pinned under the Mature-Library Gate at refinement time).
- Preserve heading levels, paragraphs, lists, basic tables, images, captions, alt text,
  hyperlinks, citations, and a generated References section where representable.
- Emit math through the KaTeX-to-MathML-to-OMML-component pipeline with the recorded image
  fallback; define explicit fallbacks for Mermaid, unsupported BlockNote blocks, and layout
  limitations.
- Produce an inventory/hash record and loss report through the current atomic export package
  boundary, with the canonicalization post-pass from the Library Pre-Selection section.
- Validate the generated ZIP/package structure and reopen it with independent parsers during
  tests (structural: jszip + fast-xml-parser; semantic: mammoth), plus a manual Word/LibreOffice
  acceptance pass.

### Integration And Complexity Control

Keep the library inside one converter module; shared manuscript code depends on the publication
node contract, not library types. Do not build a dynamic exporter registry for a single new
format. A time-boxed spike precedes the decision-complete plan: quantify byte-level variance,
prove the canonicalization post-pass, and confirm the math pipeline on the hardest in-tree
formulas.

### Acceptance gate

Golden fixtures must cover Chinese/English text, Unicode filenames, nested headings, tables,
figures, citations, links, math and its fallback, Mermaid fallback, large images, deterministic
content-level output, and deterministic loss reporting. Byte-level reproducibility is required
only after canonicalization.

### Completion evidence (2026-08-13)

Complete with `docx@9.7.1`, `jszip@3.10.1`, and `fast-xml-parser@5.10.1` exact runtime pins and
`mammoth@1.12.1` as an exact dev pin. The isolated converter preserves headings, text styles,
lists, tables, figures/captions/alt text, links, citations, References, TOC, bookmarks, page
numbers, and CJK fonts. KaTeX MathML maps common fractions/scripts/radicals to OMML; unsupported
math, Mermaid, and WebP produce explicit losses. OOXML relationship/drawing IDs, metadata dates,
ZIP timestamps, entry order, and compression are canonicalized, with byte-identical repeated
fixtures. Independent structural and semantic reopen tests, whole-export/IPC/menu integration,
`check:fast`, and the shared 165-file / 857-test Electron plus production-build gate passed.

## Checkpoint 40: LaTeX Publication

### User outcome

The author can export the current manuscript as a readable, editable LaTeX project with local
assets, deterministic structure, and an explicit account of every unsupported conversion.

### Scope

- Convert the Checkpoint 38 publication assembly into one root `.tex` file plus a contained asset
  directory, using the hand-written emitter decided in the Library Pre-Selection section.
  Optional split-per-section output is deferred.
- The ADR fixes the target output profile before implementation: one declared engine/template
  target (including the CJK strategy), the supported construct list, and the verification method.
- Emit document metadata, heading hierarchy, paragraphs, emphasis, lists, quotes, footnotes,
  hyperlinks, labels/references, tables, figures/captions, inline/display mathematics, and local
  image references where representable.
- Preserve Mermaid through an explicit source listing or pre-rendered image fallback selected by
  a bounded export option; record the choice in the loss report.
- Export canonical manuscript citations through one deterministic bibliography mapping. Emit a
  `.bib` file only when sufficient bibliographic metadata exists; otherwise emit readable
  citation text and report that a reversible BibTeX mapping was not possible. Never fabricate
  missing authors, dates, identifiers, or citation provenance.
- Escape all manuscript text for LaTeX context, generate application-owned safe identifiers, and
  prevent manuscript content from injecting commands into the generated preamble or template.
- Publish a manifest, source hash, asset inventory, and loss report through the existing atomic
  export boundary.

### Integration And Complexity Control

Implement one pure LaTeX converter over the Checkpoint 38 publication nodes. Do not build a
generic templating language, run a TeX compiler, bundle a TeX distribution, or make export
success depend on a local TeX installation. Start with one reviewed application-owned template
and a bounded typed option set; custom preambles and arbitrary templates remain deferred.

### Acceptance gate

Golden fixtures must cover CJK/Latin text, reserved characters, labels, links, formulas, tables,
figures, captions, citations, missing bibliography metadata, Mermaid fallback, Unicode filenames,
and deterministic repeated exports. Tests must parse the generated project with the pinned
unified-latex parser (independent-parse rule). A manual compile with an explicitly provisioned
test environment may be acceptance evidence, but the product must never invoke or require that
compiler.

### Completion evidence (2026-08-13)

Complete under accepted ADR 030. One deterministic XeLaTeX/ctexart emitter covers CJK/Latin text,
reserved characters, headings/labels, links, common formulas, lists, quotes, tables, figures,
captions, numeric citations, References, and contained hashed assets. KaTeX validation plus a
dangerous-command denylist prevents formula injection; context-specific escaping and listing
terminator neutralization preserve the template boundary. Missing structured bibliography data,
Mermaid source, unsupported math, and span/listing changes are explicit losses. Repeated whole
exports are byte-identical, the full source reopens through exact-pinned unified-latex, and
`check:electron` passed 166 files / 860 tests plus the production build. No local XeLaTeX is
installed, so optional manual compilation is not claimed.

## Checkpoint 41A: PDF Publication

### User outcome

The author can generate a stable final PDF.

### Scope

- Render the Checkpoint 38 publication assembly to PDF with page size, margins, typography,
  heading styles, page numbers, headers/footers, table of contents, figures, and References,
  using a Main-owned hidden `BrowserWindow` and `webContents.printToPDF` (Library Pre-Selection).
- A time-boxed spike precedes the decision-complete plan and must verify on the target platform:
  `generateDocumentOutline` bookmarks, internal/external link preservation, macOS CJK rendering
  with the forced font stack, and the two-pass TOC page-number approach using `pdfjs-dist`.
- Provide print-oriented preview and deterministic preflight/loss reporting.
- Keep PDF publication distinct from the existing project-source PDF preview boundary. Reusable
  presets are CP41B and are out of scope here.

### Integration And Complexity Control

Main owns capture and publication; utility processes are not involved in Chromium printing
(Cross-Cutting Decisions, item 6). Do not introduce a local HTTP server, office-suite runtime,
TeX distribution, or general print service. An ADR and the package gate are required because PDF
behavior depends on Electron, fonts, native resources, and platform packaging.

### Acceptance gate

Verify page breaks, table of contents (entries, page numbers, bookmarks), headers/footers, mixed
CJK/Latin text, links, selectable text, images, Mermaid, formulas, references, large manuscripts,
cancellation, and packaged execution.

### Completion evidence (2026-08-13)

Complete under accepted ADR 031. Main renders the immutable CP38 assembly in one hidden,
sandboxed BrowserWindow with an ephemeral asset-only protocol and a fixed print profile. A bounded
two-pass, conditionally three-pass pipeline resolves TOC pages through `pdfjs-dist`; cancellation
destroys the browser and cleans staging. The target-runtime spike independently proved selectable
mixed CJK/Latin text, heading bookmarks, internal and external links, images, headers/footers, and
page destinations. Focused and large-manuscript tests, `check:fast`, and `check:electron` passed
with 167 files / 868 tests plus the production build. The required package gate passed 12 packaged
smoke scenarios and 19/19 packaged E2E scenarios, verified sandbox-safe preload, schema-v3 reopen,
ASAR and arm64 native inventory, and produced verified no-Team-ID App, DMG, and ZIP artifacts.

## Checkpoint 41B: Reusable Publication Presets

### User outcome

The author can reuse a small set of publication preferences across exports.

### Scope

- Add application-owned presets first, then bounded user presets for settings that have stable
  cross-format meaning (as shaped by the CP38 options contract).
- Store non-sensitive reusable preset metadata in `app.sqlite`; project content remains
  project-local.
- Preset changes must never mutate manuscript revisions.

### Integration And Complexity Control

One bounded app-global table and service; no project schema change, no preset marketplace, no
import/export of presets in the first version.

### Acceptance gate

Presets apply identically across DOCX, LaTeX, and PDF where meaningful; malformed or
version-unknown preset data fails closed; preset CRUD is covered by app-database tests.

### Completion evidence (2026-08-13)

Complete. Forward app migration v7 seeds Academic A4, Report Letter, and Minimal A4 as immutable
application presets. One bounded app-global repository supports at most 20 user presets, strict
versioned options, unique case-insensitive names, one default, protected built-ins/defaults, and
fail-closed malformed rows. The global shadcn Settings Command exposes the catalog and editing
controls. Preflight and all three publication exports resolve the same default; focused tests prove
the same preset produces one publication source hash across DOCX, LaTeX, and PDF. Repository,
migration, IPC, export, fast, and Electron gates passed with 168 files / 871 tests plus the
production build. No project table or manuscript revision changes when presets change.

## Checkpoint 36: Safe Manuscript Import Staging And Preview

### User outcome

The author can inspect what an external manuscript will create, replace, omit, or fail to map
before any current manuscript revision is changed.

### Scope

- Introduce a Main-owned file/directory picker and opaque, project-session-bound import request.
- Capture a bounded immutable import source in project temporary storage, hash it, reject links
  and path escapes, and remove the staging data after completion or cancellation. The
  decision-complete plan fixes staging TTL, startup crash cleanup, and import-plan capability
  expiry.
- Produce a typed import plan containing proposed Brief metadata, outline/section structure,
  BlockNote bodies, registered image candidates, warnings, unsupported constructs, and a loss
  report.
- Show side-by-side structure and content preview before application. Allow the user to choose
  create new sections, replace the active section, or cancel; replacing the whole manuscript
  remains a separately reviewed option.
- Revalidate current brief, outline, and section revisions immediately before apply, then use the
  existing manuscript service, import revision source, asset publication, counts,
  materialization, and optimistic concurrency rules.
- Migrate the existing lightweight Markdown section import (currently Renderer-driven) onto the
  staged Main-owned path as the mandatory first adapter and the end-to-end proof of the
  machinery. The old path is retired only after parity is proven.

### Integration And Complexity Control

Add one manuscript-specific `ImportPlan` contract and service rather than a general importer
plugin framework. A format adapter returns bounded application-owned import nodes; it receives
bytes and a constrained resource resolver, never arbitrary filesystem access. Main owns source
selection, containment, hashing, asset publication, and final mutation. Renderer only previews
the plan and sends an approval intent.

Import parsing is request-scoped and cancellable, not a durable job. No importer may launch a
process, run a macro, load a plugin, contact the network, or execute embedded content. The
contract must not preclude the deferred DOCX-import adapter (Cross-Cutting Decisions, item 8).

An ADR is required before implementation to define whole-manuscript apply semantics, temporary
source lifetime, resource containment, partial-versus-atomic outcomes, and how imported section
IDs are allocated by Main.

### Acceptance gate

Cover cancellation, malformed and oversized inputs, Unicode/long filenames, symlinks/junctions,
resource path traversal, duplicate assets, stale manuscript revisions, partial asset publication,
crash cleanup, no-op plans, imported IDs, and project switch. Previewed content and applied
content must come from the same hashed staged source and mapping plan. The Markdown adapter must
pass parity fixtures against the legacy path before it is retired.

Complete. ADR 032 fixes the 30-minute session capability and staging lifetime, restart/switch
cleanup, contained resource root, atomic manuscript/repairable materialization outcome, and
Main-owned IDs. Exact-pinned unified/remark libraries map the captured SHA-256 source into bounded
BlockNote plans; local images are captured, validated, registered, and deduplicated without
exposing paths. The Renderer importer and legacy IPC were removed after semantic parity fixtures.
Focused coverage exercises cancellation/no-op, invalid UTF-8, byte/depth limits, Unicode names,
links, traversal, duplicate assets, stale revisions, partial asset publication, crash cleanup,
atomic IDs, and session revocation. `check:fast`, `check:electron` (170 files / 878 tests plus
build), and all 32 silent Electron E2E scenarios passed.

## Checkpoint 37A: LaTeX Import Core (Single File)

### User outcome

The author can bring a single-file LaTeX manuscript into WriteLLM as a reviewable outline,
sections, prose, and formulas, with an exact account of everything not mapped.

### Scope

- Accept one selected `.tex` entry file through CP36 staging. Includes, archives, external
  directories, images, and `.bib` files are CP37B scope.
- Parse with the pre-selected unified-latex adapter (re-verified and exact-pinned under the
  Mature-Library Gate), running in the background worker under a hard timeout and byte cap
  (Cross-Cutting Decisions, item 5).
- Recognize document metadata, `\part`/`\chapter`/`\section` heading structure, paragraphs,
  common emphasis, lists, quotes, and display mathematics.
- The ADR decides the representation of constructs the current BlockNote schema lacks — inline
  mathematics, footnotes, and arbitrary fallback/raw content — choosing between nearest-
  representable mapping with a visible inert source rendering plus loss-report entry, or a
  bounded schema v3. Do not promise native footnote or inline-math support in this checkpoint.
- Citation commands without a bibliography remain explicit unresolved tokens; never fabricate
  citation provenance.
- Preserve unsupported or custom constructs as visible, inert source/fallback content or explicit
  import losses rather than dropping them silently; unmapped subtrees are preserved via
  `printRaw`.
- Preview through CP36 before application.

### Trust And Execution Boundary

LaTeX is treated as untrusted source text, not executable input. WriteLLM must not run `latex`,
`pdflatex`, `xelatex`, `lualatex`, BibTeX/Biber, `latexmk`, shell escape, user-defined commands,
package hooks, or external converters during import. Macro handling is bounded syntax
interpretation: macro-expansion processors of the parser stay disabled; unknown `\newcommand`,
package-defined behavior, conditionals, file I/O, and executable primitives remain inert and
appear in the loss report.

### Acceptance gate

Golden fixtures must cover multilingual text, comments/verbatim content, equations, custom
macros, unknown packages, malformed syntax, oversized inputs, parser timeout behavior, and
deterministic repeated imports. Applying an import must create ordinary `import` revisions and
remain fully editable after reopen, export, Agent review, and version-history restore.

Complete under accepted ADR 033. Exact-pinned unified-latex and `printRaw` run only in a
disposable one-request utility process with a Main-owned five-second timeout, cancellation, and
bounded application projection. One staged UTF-8 `.tex` source maps metadata, normalized outline
hierarchy, prose, emphasis, lists, quotes, verbatim, and display math. Inline math, footnotes,
unresolved citations, comments, malformed syntax, custom macros, and unknown constructs remain
visible and inert with exact findings; no compiler, macro expansion, include resolver, package
hook, model, or network path exists. Applying the reviewed plan creates ordinary hierarchical
`import` revisions and survives reopen. Verification passed 26 focused tests, `check:fast`, 172
Electron-hosted files / 884 tests, the production build, all 33 silent Real-Electron scenarios,
and all 25 recovery fixtures.

## Checkpoint 37B: LaTeX Import Full Profile

Decision record: accepted [`ADR 034`](../adrs/034-contained-latex-project-import.md)

Planning status: implementation locally complete

### User outcome

The author can import a realistic LaTeX project — multiple files, images, tables, cross-
references, and a bibliography — through the same staged, reviewable path.

### Scope

- Accept an optional selected project directory or bounded archive containing local dependencies;
  archive extraction reuses the contained-extraction and file-budget invariants of the MinerU
  archive path.
- Recognize `\input` and `\include` only through the staged-root resolver with bounded depth,
  file count, total bytes, cycle detection, normalized relative paths, and a text-extension
  allowlist.
- Parse common citation commands and `.bib` files (pre-selected citation-js adapter, re-verified
  and exact-pinned under the Mature-Library Gate) into canonical readable citation text only when
  an exact bibliography mapping exists; preserve an explicit unresolved token otherwise.
- Recognize basic and complex tables, figures, captions, labels/references, footnotes per the
  CP37A representation decision, and safe local image references as registered asset candidates.
- Preview the resulting outline, per-section body, assets, unresolved references, unsupported
  macros/environments, and exact loss report through CP36 before application.

### Integration And Complexity Control

Same adapter and worker isolation as CP37A; the second parser dependency (citation-js) is added
with its recorded wrappers (Zod-validated output, structural no-network aliasing). Do not attempt
full TeX compatibility.

### Acceptance gate

Golden fixtures must cover nested includes, cycles, path traversal, duplicate labels, `.bib`
data, unresolved citations, tables, figures, multilingual bibliographies, hostile archives
(including bombs), and deterministic repeated imports. Imported assets must satisfy the normal
asset validation and proposal rules.

Local evidence: focused hostile archive, parser, staging, mapping, and asset tests; `check:fast`;
172 passing Electron-hosted files / 888 tests; production build; 34/34 silent Real-Electron
scenarios; all 25 recovery fixtures; clean scoped Impeccable and diff checks; and a passing macOS
arm64 package gate with all 12 packaged smoke scenarios, 22/22 packaged E2E scenarios, and
structurally verified App, DMG, and ZIP artifacts.

## Checkpoint 44: Annotations And Actionable TODOs

Planning status: implementation locally complete

### User outcome

The author can attach a durable note or TODO to manuscript content, navigate unresolved work, and
resolve it without inserting editorial notes into the published text.

### Scope

- Create project-local annotations anchored to a section and stable block ID, with an optional
  bounded text anchor/fingerprint for relocation diagnostics.
- Support note and TODO kinds, open/resolved status, author text, creation/update timestamps, and
  direct navigation.
- Keep annotations outside BlockNote body content and exclude them from counts, exports,
  citations, search results, and model context by default.
- Surface unresolved items in a contextual rail and Review Center.
- Define explicit orphaned state when a block is deleted or replaced; never guess a new target.
- Let the user explicitly include selected annotations in a normal Agent request.
- Annotations roll back with version-history restore like other project-local state.

### Integration And Complexity Control

This is the first checkpoint in the roadmap that clearly justifies new durable project state. Add
a small annotation table and one service rather than a general comments/collaboration system.
There is one local author, no threads, mentions, permissions, realtime collaboration, Yjs, or
external sync. "Annotation failure never blocks manuscript editing" covers runtime service
failure only; database integrity rules are never bypassed (Cross-Cutting Decisions, item 10).

### Acceptance gate

Cover revision changes that preserve block IDs, block replacement/deletion, section tombstones,
restore (including version-history rollback), import, export exclusion, Agent opt-in, large
annotation counts, and stale project sessions.

Local evidence: accepted ADR 035; forward-only project migration v36; focused migration, service,
history, export, IPC, Agent-context, and Renderer tests; a passing production build and full
Electron-hosted gate; and a passing focused Real-Electron annotation/TODO scenario.

## Checkpoint 46: Clone / Save As

Planning status: implementation locally complete

### User outcome

The author can create an independent copy of a project for experimentation or a new deliverable
without duplicating project identity.

### Scope

- Clone a consistent project state through the current snapshot barrier and verified inventory.
- Generate a new `projectId` and update every identity-bearing project record that requires it;
  the ADR enumerates the complete rewrite list.
- Fixed first-version inclusion policy (no user-facing inclusion matrix): copy all authoritative
  project content — project database, manuscript, assets, brief, annotations, knowledge originals
  and parsed artifacts, and Agent history; omit the derived `index.sqlite` (marked for rebuild),
  backups, recovery/temp directories, exports, and snapshots; do not carry `history.git` — the
  clone opens with version history uninitialized.
- Never leave two independently writable folders with the same `projectId`.
- Publish the clone through staging and full validation before opening or adding it to recent
  projects.

### Integration And Complexity Control

Reuse project snapshot, manifest-last publication, database backup, `ProjectFilesystem`,
migrations, and open validation. Do not implement clone as a raw folder copy and do not add
project watchers or multi-project concurrency. A dedicated ADR is required because this changes
the current restore-versus-clone identity boundary.

### Acceptance gate

Cover open projects with WAL data, Unicode and long paths, symlinks/junctions, cancellation,
`ENOSPC`, identity rewrite failure, version history absent in the clone, credential absence, and
opening source and clone sequentially without shared authority.

Local evidence: accepted ADR 036; 53 focused clone, project-manager, IPC, and recovery tests;
verified online backup of open WAL state; exact identity-column enumeration; source/clone
sequential-open coverage; and a passing focused Real-Electron independent-clone scenario.

## Checkpoint 47A: Built-In Project Templates

Planning status: implementation locally complete

### User outcome

The author can start a new project from a known Brief, outline skeleton, writing decisions, and
optional publication preset.

### Scope

- Ship a small reviewed application catalog of built-in templates as application resources.
- Create a new project through the normal bootstrap path, then apply validated template data as
  initial project state.
- Template manifests are bounded, versioned data — not executable skills or plugins — and are
  validated by shared Zod contracts. Do not reuse Writing Skills as project templates.

### Integration And Complexity Control

No dependency on CP46 and no app-database migration: built-ins ship with the application and are
applied through the existing project-creation authority. Unknown fields and malformed template
data fail closed.

### Acceptance gate

Cover template schema evolution, unknown fields, malformed or tampered built-in resources, CJK
content, and deterministic new-project identity. A built-in template must never carry manuscript
bodies, knowledge files, citations, credentials, project IDs, or private paths.

Local evidence: accepted ADR 037; strict versioned shared contracts; two reviewed built-ins;
focused schema, integrity, application, identity, and CJK coverage; and a passing focused
Real-Electron built-in-template scenario.

## Checkpoint 47B: User-Defined Project Templates

Planning status: implementation locally complete

### User outcome

The author can extract a reusable template from an existing project without copying old
manuscript content or identity.

### Scope

- Add an explicit project-to-template operation that extracts only approved reusable structure
  (Brief skeleton, outline, CP45 writing decisions, optional CP41B preset reference), reusing
  CP46 identity-sanitization rules.
- Exclude manuscript bodies, knowledge files, citations, Agent history, credentials, generated
  assets, version history, project IDs, and private absolute paths by default.
- Show a complete inclusion preview before saving a user template.
- Store user templates in a narrow application-global catalog with hash-verified files; the
  storage boundary (format, location, integrity rules) is designed and approved before
  implementation.

### Integration And Complexity Control

Build on CP46's sanitization and CP47A's application path. User templates require the app-global
catalog only after the storage boundary is designed; the catalog is bounded data with hash
verification, not a package manager.

### Acceptance gate

Cover duplicate names, missing optional presets, source-project deletion, malformed or tampered
user-template files, and deterministic new-project identity. A template must never carry project
content not shown in its inclusion preview.

Local evidence: accepted ADR 037; forward-only application migration v8; bounded canonical files
with SHA-256 verification; complete inclusion/exclusion preview; 61 focused template/clone tests;
and a passing focused Real-Electron extraction, source-deletion, and reuse scenario.

## Cross-Checkpoint Verification Strategy

Each checkpoint receives the smallest applicable gate plus focused tests for its authority:

- Pure matching, review, publication projection, and conversion logic: deterministic unit/golden
  fixtures.
- Main services and migrations: Electron-hosted tests with original-error logging and rollback
  coverage.
- IPC and capabilities: sender authorization, `projectSessionId`, bounds, stale-session, and safe
  error tests.
- Renderer flows: keyboard, focus, narrow-window, accessibility, save barriers, and exact
  navigation behavior.
- Cross-section mutations, Agent tasks, staged import, export, clone, and packaged rendering:
  fresh Real-Electron scenarios.
- Library-backed parsing/conversion: golden fixtures plus independent parser/reopen or round-trip
  verification under the Mature-Library Gate; a library call succeeding is never sufficient
  evidence.
- Native/runtime or format dependencies: `check:package` only where the repository gate requires
  it. `check:release` remains separately authorized.

Every implemented checkpoint must emit structured lifecycle logs at material boundaries, log the
original top-level `err` before sanitization, and avoid logging manuscript content, annotations,
prompts, generated image bytes, credentials, or private paths.

Final Phase 11 evidence: `check:fast`, the complete Electron-hosted gate and production build, all
25 recovery fixtures from 23 sources, clean scoped Impeccable and diff checks, and 38/38 fresh
Real-Electron scenarios passed without failures, skips, or flaky scenarios. The no-identity macOS
arm64 package gate verified Electron 43.1.0 / ABI 148, arm64 `better-sqlite3` and `sqlite-vec`, the
ASAR/resource inventory, all 12 packaged smoke scenarios, and 26/26 packaged E2E scenarios against
the unpacked App. The gate generated and structurally verified the 0.2026.8.16 App, DMG, and ZIP.

## Explicitly Deferred Beyond This Roadmap

- Multiple simultaneously open projects or multiple primary manuscripts.
- External-edit synchronization and project-wide file watching.
- Multi-agent/subagent workflows, generic plans/tasks, autonomous background writing, and
  long-term implicit memory.
- Generic plugins, executable Writing Skills, arbitrary filesystem/network/shell tools, and
  direct Agent writes.
- Realtime collaboration, comments with identities/mentions, Yjs, and cloud sync.
- Semantic manuscript indexing before measured search evidence requires it.
- DOCX and other non-LaTeX manuscript import formats (the CP36 contract must not preclude them).
- True image editing, masks, arbitrary remote-image ingestion, and provider-agnostic image
  plugins.
- Auto-updater, new distribution targets, hosted CI restoration, signing, notarization, and
  release promotion.

These may be reconsidered only from concrete usage evidence and a separately approved
architecture decision. They are not implied by this roadmap.
