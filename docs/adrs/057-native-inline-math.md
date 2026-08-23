# ADR 057: Native Inline Math With Application-Owned Display Math

Status: accepted
Date: 2026-08-23

## Context

BlockNote 0.54.0 exposes an optional native inline Math spec with `$...$` and `\(...\)` input
rules, an editable source popup, and native JSON round-tripping. WriteLLM already owns display
LaTeX and Mermaid block contracts, persistence, rendering, import/export, and publication. ADR
056 deliberately did not admit any of the new optional specs during the dependency-only upgrade.

Keeping inline formulas as code-styled text would continue to make formula source searchable,
replaceable, countable, and easy for selection-based rewriting to flatten. Adopting BlockNote's
native display Math or Diagram at the same time would replace established application-owned
capabilities and persisted block contracts without a corresponding product gain.

## Decision

- Adopt exact-pinned `@blocknote/math-block@0.54.0` and register only
  `createReactInlineMathSpec()`. Do not register native `mathBlock` or Diagram.
- Keep application-owned display Math and Mermaid. BlockNote shares one ProseMirror node namespace
  between block and inline specs, so Renderer uses `displayMath` solely as the internal editor name
  for the existing display block. Load/save conversion maps that alias to canonical block
  `type: "math"`; no database, Agent, import/export, or historical JSON shape changes.
- Advance current section content to schema v4. Canonical inline formulas are strict atomic nodes
  `{ "type": "math", "content": string }` with no styles or props. Source is one line, contains no
  NUL, is at most 8,192 characters, and is at most 8 KiB UTF-8. Renderer blocks over-limit edits;
  shared contracts and Main validate again.
- Migration 0037 retains every historical revision, rebuilds the complete revision foreign-key
  dependency graph with the widened v1-v4 constraint, and appends an identical v4 current revision
  for each active section through compare-and-swap. Existing revision-bound proposals and review
  artifacts remain immutable and therefore become detectably stale through the existing rules.
- Ordinary text extraction, counts, search, replacement, and readable-citation parsing treat inline
  formulas as non-searchable structural separators. Agent reads project formulas as `$source$` and
  canonical block replacement may preserve or create them without a new IPC or tool.
- Markdown and LaTeX import create native inline formula nodes. Markdown emits `$source$`, DOCX
  reuses the OMML projection, PDF uses inline KaTeX, and LaTeX emits `\(source\)`. Unsafe,
  structurally invalid, or non-round-trippable source degrades to readable code text with an exact
  loss record instead of aborting a whole import or publication.
- KaTeX remains untrusted. Publication rejects capability-bearing commands and extreme dimensions,
  uses `trust: false`, and bounds expansion and rendered size. The Renderer relies on KaTeX's
  default false trust in the native BlockNote implementation and contains wide previews within the
  editor.

## Consequences

Inline formulas become first-class editable manuscript structure without replacing the richer
application display blocks or delegating authority to BlockNote exporters. Persisted v1-v3
revisions remain readable and unchanged; only active heads advance to v4. Formula source no longer
participates in ordinary prose operations, while whole-block Agent edits and explicit interchange
formats retain it.

The internal `displayMath` alias is a Renderer implementation detail and must never cross the
canonical save boundary. Characterization tests must cover simultaneous inline and display math,
canonical alias removal, stable block IDs, and no-op JSON/hash round trips.

ODT/email export, BlockNote XL exporters, native display Math, native Diagram, collaboration, and
BlockNote-owned persistence remain out of scope. This ADR supersedes only ADR 056's exclusion of
the native inline Math spec and older inline-math text-fallback behavior; all other ADR 056
boundaries remain in force.
