# ADR 066: Agent Table Authoring And Portable Publication

Status: accepted for Checkpoint 74
Date: 2026-08-27

## Context

Native BlockNote tables already persist in section-content schema v5 and flow through section
revisions, proposal acceptance, and publication assembly, but the Agent cannot inspect table
geometry or propose bounded table edits. Existing Markdown, PDF, and LaTeX projections also omit
portable header, alignment, and width semantics. Replacing BlockNote or introducing a second table
authority would weaken the established revision and Renderer trust boundaries.

## Decision

Agent Harness Protocol v11 adds a paged `read_section` table view plus typed `insertTable` and
`editTable` section-change operations. Coordinates are zero-based logical occupancy-grid
coordinates and are valid only for the returned complete table-block hash. Main validates and
simulates operations in order, creates block IDs, normalizes native table cells, and turns the
result into the existing `section_patch`; proposal acceptance still appends exactly one section
revision. Limits are 100 rows, 30 columns, 1,000 physical cells, and 8,192 text characters per
cell, within the existing tool and manuscript byte budgets.

A shared pure transformer owns occupancy validation, anchor-versus-covered coordinates,
normalization, edits, and bounded structural summaries. The Agent may create only rectangular
tables with zero or one header row/column. Existing spans remain losslessly persisted. `setCell`
may edit only a span anchor; covered coordinates and all structural/header-geometry operations on
a spanned table fail closed. The compatibility canonical replacement remains gated by a current
canonical read, while policy prefers typed table operations.

Publication assembly advances to ephemeral schema v2. It retains header columns and per-cell text
alignment alongside existing headers, widths, and spans. Markdown remains lossy GFM pipe-table
interchange and records every unsupported geometry or presentation feature. PDF uses semantic
HTML tables with normalized widths and paged headers. LaTeX remains inert `longtable`, repeats
headers, preserves colspan, and reports rowspan fallback rather than adding `multirow`. No TeX
compiler, external converter, local service, dependency, migration, worker, or new IPC authority
is added.

Review presentation derives a bounded read-only `table_diff`. Logs contain only safe IDs,
operation kinds, dimensions, counts, durations, and original error objects; they never contain
cell content. The editor enables native headers but disables split/merge and cell color controls.

## Consequences

Section schema stays v5 and historical complex tables continue to open, save, and export. Table
captions, numbering, cross-references, Agent merge/split, colors, nested block cells, and lossless
LaTeX rowspan are deferred. Markdown is explicitly an interchange format, not a lossless table
authority. Stale table hashes conflict instead of retargeting cell coordinates.
