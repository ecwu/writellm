# ADR 033: Isolated Inert LaTeX Import

- Status: Accepted
- Date: 2026-08-13
- Checkpoint: 37A

## Context

Single-file LaTeX import must preserve useful document structure without treating LaTeX as a
program. The current BlockNote schema has native display math but not inline-math or footnote
nodes. Parsing untrusted syntax also lacks a formal worst-case time bound, so it cannot run on the
Main event loop.

The parser gate rechecked official package metadata and locally installed package documentation.
`@unified-latex/unified-latex-util-parse@1.8.4`, `latex-utensils@7.0.0`, and
`latex-parser@0.6.2` are MIT, pure JavaScript, and have no Electron native-runtime impact. The
exact-pinned unified-latex parser and `unified-latex-util-print-raw@1.8.4` are selected because the
maintained 1.8.4 AST retains positions, recognized macro/environment arguments, math nodes, and a
deterministic raw serializer. `latex-utensils` is analysis-oriented and would require a second
mapping representation; `latex-parser` has not published since 2022 and has weaker current
maintenance evidence. Context7 did not index unified-latex itself, so its current npm metadata and
the package's generated API reference were used after the mandatory Context7 lookup.

## Decision

Main extends ADR 032's same source capture, hash, plan capability, preview, apply, and cleanup
boundary to `.tex`. It sends only bounded UTF-8 source text, its SHA-256, and an opaque request ID
to a one-request utility child using the existing `background-worker.js` entrypoint. A five-second
Main timer kills that child on timeout or cancellation. The child never receives paths,
credentials, project state, network authority, or mutation authority. No TeX compiler, shell
escape, bibliography tool, macro-expansion processor, package hook, include resolver, or external
converter is invoked.

The worker adapter confines unified-latex types and returns only an application-owned bounded
syntax projection. Main mints proposed BlockNote IDs and final section/revision IDs. Part, chapter,
and section commands become proposed outline sections; lower headings remain editable heading
blocks. Paragraphs, common emphasis, lists, quotes, verbatim, and display math map to existing
BlockNote nodes.

Inline math remains visible editable `$...$` code-styled text with an exact loss record. Footnotes
remain visible as inert `[Footnote: ...]` text plus a loss. Citation commands without an exact
bibliography remain literal `\cite{...}`-style tokens and are explicitly unresolved; provenance is
never fabricated. Unknown macros, environments, packages, conditionals, file I/O commands, and
other unsupported subtrees are serialized with `printRaw` into bounded inert LaTeX code blocks
and recorded in the unsupported/loss report. Comments are retained as inert comment source.

## Consequences

- A hostile parser input can cost at most one bounded disposable utility process and the fixed
  timeout; Main and other long-lived worker requests remain responsive.
- Imported bodies stay ordinary editable `import` revisions and use CP36's atomic application.
- The representation is deliberately lossy but never silently drops an unmapped subtree.
- CP37B may add contained includes, images, tables, references, and bibliography resolution to the
  same adapter contract without widening the CP37A worker's authority.
