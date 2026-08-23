# ADR 060: Native Block Math And Application-Owned Diagram

Status: accepted for Checkpoint 68
Date: 2026-08-23

## Context

ADR 057 introduced BlockNote native Inline Math while retaining application-owned display Math
and Mermaid blocks. BlockNote 0.54.0 now gives the editor a native `mathBlock` whose plain source
content, input rules, preview/source interaction, and keyboard behavior match the Inline Math
extension. Keeping a separate display-Math implementation would preserve two editing models for
the same mathematical language and duplicate maintenance around selection, source editing, and
BlockNote compatibility.

BlockNote's Diagram extension does not cover WriteLLM's durable caption and alternative-text
metadata, dynamic light/dark Mermaid theme, serialized rendering, strict Mermaid configuration,
sanitized SVG-as-image isolation, or last-valid-preview recovery. Those are application security
and publication semantics rather than interchangeable editor decoration.

## Decision

- Register BlockNote's native `mathBlock` alongside native Inline Math. Canonical block Math is
  `type: "mathBlock"`, has empty props, and stores bounded LaTeX as normalized plain content.
- Keep an application-owned `diagram` block. It stores normalized plain Mermaid content and only
  the durable props `engine: "mermaid"`, `caption`, and `altText`.
- Build Diagram source/preview interaction with BlockNote's `SourceBlockWithPreview`, while
  preserving WriteLLM's theme-aware serialized renderer, strict configuration, SVG sanitization,
  data-URL image isolation, last-valid preview, and shared image metadata interaction.
- Advance current section content to schema v5 with forward migration 0038. Immutable historical
  revisions and hashes remain untouched; each active v4 head receives a converted v5 revision and
  is advanced by compare-and-swap. A non-empty legacy Math caption becomes an adjacent italic
  paragraph instead of being discarded.
- Treat Math and Diagram source as structured boundaries for prose counting, search, replacement,
  readable references, and quick writing operations. Diagram caption remains prose; alternative
  text does not.
- Represent block Math to the Agent as `$$source$$` and Diagram as a Mermaid fence with explicit
  caption and alternative-text metadata. Existing typed mutation authority is extended; no IPC or
  Agent tool is added.
- Keep import, export, publication, proposal, and project authority application-owned. Do not add
  `@blocknote/diagram-block`, syntax highlighting, BlockNote XL publication, ODT/email export, or
  a new worker/process boundary.

## Consequences

Math editing converges on one BlockNote-native interaction model for inline and block formulas,
and the Renderer-only `displayMath` alias plus its bespoke slash item can be removed. Diagram uses
the same plain-content source model without surrendering metadata, theme behavior, safe rendering,
or publication semantics.

This ADR supersedes ADR 057 only where that decision retained application-owned display Math. ADR
057's native Inline Math contract and its prose-isolation and safety requirements remain in force.
