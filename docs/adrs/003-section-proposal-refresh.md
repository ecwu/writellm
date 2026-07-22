# ADR 003: Refresh Stale Section Proposals Without Applying Old Bases

Status: accepted
Date: 2026-07-22

## Context

Several Agent proposals may target different blocks in one section while sharing the same
`baseRevisionId`. Applying one proposal advances the section revision and makes every sibling
proposal stale, even when its target is unchanged. Treating every stale proposal as a terminal
failure prevents independent edits from being reviewed and applied.

## Decision

A stale section proposal is never applied directly. Main compares its retained base document with
the current document using operation-aware three-way checks. A refreshable proposal produces a new
pending proposal based on the current revision, while the old proposal becomes `superseded`. The
replacement must be reviewed and approved separately, and final application still requires an
exact current-revision match.

Conflicting proposals become `conflicted`. Field updates that the current document already satisfies
become `satisfied` without creating a revision. Replacement proposals retain the original Agent run,
tool call, model request, and citation provenance and form a linear immutable chain through
`replaces_proposal_id`. Proposal payloads are immutable; only their decision status, decision time,
and safe terminal reason transition when they are superseded, conflicted, or satisfied.

Only section proposals receive this refresh behavior. Brief and outline proposals retain their
existing version-conflict rules.

## Consequences

Pending section proposal base bodies are protected from revision-body pruning. The renderer may
label a proposal as outdated by comparing its base revision with the current workspace revision,
but Main remains authoritative and repeats every check inside the proposal transaction. No stale
proposal is silently rebased and applied in one user action.
