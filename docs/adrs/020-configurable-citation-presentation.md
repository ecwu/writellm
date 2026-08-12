# ADR 020: Configurable Citation Presentation, References, Counting, And Export

Status: accepted for Checkpoint 28.6
Date: 2026-08-12

## Context

WriteLLM stores canonical readable citations such as `[Source: exact title, p. N]` and
`【来源：准确标题，第 N 页】` as ordinary BlockNote text. That representation is editable,
portable, and sufficient for the existing provenance-gated preview resolver, but it is visually
heavy in a manuscript and was incorrectly included in section word and character counts. Section
Markdown was also generated in the Renderer while whole-manuscript Markdown used the shared Main
converter, so the two export paths could not share one manuscript-wide citation order.

Persisting numeric reference IDs in revisions or changing LLM output would create a second source of
truth and make reordering, revision identity, and imported documents more fragile. Presentation,
counting, and lossy export are the boundaries that need different representations.

## Decision

Canonical citation text remains unchanged in BlockNote JSON, revisions, hashes, autosave, copy
semantics, Agent reads, and LLM prompts. An application setting in the existing `app_settings`
table selects `full`, `numbered`, or `icon` presentation. The ProseMirror extension implements the
compact forms with decorations and rebuilds them through a plugin transaction when the setting or
reference order changes. A caret inside a compact citation reveals its complete editable text.

Main/shared owns one parser and manuscript reference-index algorithm. Titles use NFC plus trim,
remain case-sensitive, and ignore page when grouping. The first occurrence in current outline and
body order assigns the number; numbers are derived, never persisted. The bounded index includes
current-revision occurrences by section, revision, block, and ordinal. The active section overlays
an in-memory occurrence snapshot so unsaved edits update numbering immediately.

References is a manuscript rail destination that keeps the active editor mounted and replaces the
contextual Outline list with the whole-manuscript reference list. Entries show number, canonical
title, and occurrence count. Activation tries occurrences in manuscript order through the existing
provenance-gated resolver. Resolved and ambiguous results reuse the current preview surfaces;
unlinked, missing, unready, and bounded-history cases fail closed with an explicit unavailable
state.

Count algorithm v2 replaces each valid canonical citation with boundary whitespace before applying
the existing Unicode word and non-whitespace character rules. Project migration 0028 rebuilds the
revision constraint to permit historical v1 and current v2 rows, recalculates every retained body,
and leaves pruned bodies at v1 because their text no longer exists. Current revisions and all new
revisions must use v2.

All Markdown export runs in Main/shared. Both whole-manuscript and single-section export derive one
index from the validated current assembly and emit only `[n]` in body content. A single-section
artifact therefore preserves global numbers and may contain gaps. No References appendix or hidden
mapping is emitted, and import treats `[n]` as ordinary text. The whole-manuscript loss report
records citation numbering explicitly.

## Consequences

Users can choose compact editing without changing manuscript identity or LLM behavior, and Outline,
whole-manuscript, preview, and Agent-visible revision counts consume one citation-free authority.
Reordering can change every displayed and exported number by design. Markdown export is explicitly
non-recoverable for citation titles and provenance. Historical pruned revision counts remain
truthfully marked v1 rather than being fabricated.

The checkpoint requires app-setting IPC, bounded reference-index IPC, project migration 0028, and
Renderer decoration/References state, but adds no app migration, project registry, provider change,
prompt change, durable job, or Renderer database/filesystem authority.
