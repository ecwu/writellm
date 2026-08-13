# ADR 030: XeLaTeX Publication Profile

- Status: Accepted
- Date: 2026-08-13
- Checkpoint: 40

## Context

Checkpoint 40 needs one editable LaTeX project derived from the Checkpoint 38 publication
assembly (whose contract lives in `architecture.md`; it has no standalone ADR). The product must
not require, invoke, or bundle a TeX compiler, accept arbitrary
templates/preambles, fabricate bibliography metadata, or allow manuscript text to inject LaTeX
commands. CJK/Latin text, figures, formulas, tables, links, citations, deterministic output, and
explicit conversion loss all need one fixed profile.

## Decision

WriteLLM emits one `manuscript.tex` targeting XeLaTeX and the standard `ctexart` class. The
application-owned preamble is fixed and uses `geometry`, `graphicx`, `hyperref`, `booktabs`,
`longtable`, `enumitem`, `listings`, and `caption`. `ctexart` owns CJK font selection while normal
Unicode text remains in the source. A4/Letter and bounded margins come only from the typed CP38
options; manuscript content cannot alter the preamble.

One pure Main converter maps publication nodes directly to strings. Text, URL arguments, safe
labels, table cells, captions, and listing terminators use context-specific escaping. Formula
source is emitted only after bounded KaTeX validation and an application denylist rejects
document/file/macro-definition primitives; otherwise readable escaped source and a loss record are
emitted. Figures reference only already-captured hashed package assets. Mermaid is retained as a
source listing and recorded as a fallback.

Canonical citations remain deterministic numeric markers plus a generated readable References
section. The current reference index does not contain sufficient author/date/identifier fields for
a reversible BibTeX record, so the converter does not create a `.bib` file and records that loss;
it never invents fields.

The existing Main-owned export barrier, verified asset capture, create-only staging, manifest,
hash inventory, read-back validation, and atomic rename remain the only publication boundary.
Generated output is deterministic UTF-8 with LF line endings. Tests independently parse the full
document with exact-pinned `@unified-latex/unified-latex-util-parse@1.8.4`; an explicitly
provisioned manual compiler is optional evidence and never a product dependency.

## Consequences

- Users receive a portable editable project with one declared engine and no hidden compiler work.
- Custom templates, custom preambles, split-per-section output, compiler discovery, and automatic
  package installation remain out of scope.
- Some constructs intentionally become readable fallbacks, always represented in the loss report.
- Future richer bibliography export requires authoritative structured metadata and a separate
  architecture decision.
