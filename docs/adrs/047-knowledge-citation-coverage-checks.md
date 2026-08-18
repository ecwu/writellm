# ADR 047: Knowledge Citation Coverage Checks

Status: accepted for Checkpoint 52
Date: 2026-08-18

## Context

WriteLLM already derives a manuscript-wide reference index from canonical readable citation text
and already knows the exact source set of the active Knowledge index generation. The Agent's
`unused_resources` draft check is not the right user-facing authority: it also covers manuscript
assets, uses every stored Knowledge item, and returns issue-shaped findings rather than a stable
article-level coverage view.

The author wants a read-only Checks workspace now and may later expose the same result through a
dedicated Agent tool or use it to exclude already cited articles from Knowledge retrieval. The
initial page must therefore retain stable Knowledge identities without changing manuscript citation
storage or creating a second persistence authority.

## Decision

Main owns one derived `KnowledgeCitationCoverageService`. It combines a coherent snapshot of the
current manuscript revisions with the source set of the active, current index generation. If the
index is unavailable or its active generation does not match the latest source fingerprint, the
service returns an explicit unavailable or preparing state and never serves an older denominator.
Text indexing is sufficient; vector-embedding readiness is not required.

Coverage recognizes only the existing canonical English and Chinese citation syntax. Titles use
the established NFC-plus-trim, case-sensitive normalization and ignore page when grouping. A
unique title match marks one indexed Knowledge article cited and retains its occurrence count. A
title shared by multiple indexed articles marks those articles ambiguous; they stay in the
denominator but not the numerator. A citation title with no indexed match is a separate unmatched
citation and does not enter the denominator. With no indexed articles, coverage is null rather
than zero.

Renderer access is a bounded, project-session-scoped, paginated Knowledge IPC projection. Cursor
identity binds the active index generation, current manuscript revision fingerprint, filter, and
query; changed snapshots reject continuation and restart at the first page. Rows expose only safe
article identity, display metadata, coverage status, and occurrence counts. They never expose
normalized artifact paths, source blocks, page locations, document text, or database handles.

The Renderer adds an independent Checks workspace using the established shadcn `sidebar-09`
shell. The first contextual destination is Citation coverage. It is read-only, article-grained,
and provides summary counts, coverage progress, filtering, title search, pagination, explicit
preparing/unavailable/empty states, and refresh. Opening it from the editor first flushes the active
section so the page never presents a known-unsaved draft as authoritative.

## Consequences

Coverage is current, deterministic, local, and rebuildable without a migration or durable job.
Stable `knowledgeItemId` rows provide the identity needed by a later dedicated Agent tool or an
`excludedKnowledgeItemIds` retrieval filter, but neither capability is added in Checkpoint 52.
The existing `check_draft.unused_resources` behavior remains unchanged.

