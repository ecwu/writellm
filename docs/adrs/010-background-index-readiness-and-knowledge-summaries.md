# ADR 010: Background Index Readiness And Knowledge Summaries

Status: accepted
Date: 2026-07-30

## Context

A real project with 29 active normalized sources accumulated a 1.0 GiB derived index containing
19 index generations. Project-open logs repeatedly measured 14–15 seconds, while the authoritative
project database opened in about 120 milliseconds. A direct `PRAGMA quick_check` of the derived
index took about 10 seconds. Separately, the Knowledge workspace read, hashed, parsed, validated,
and transferred every active normalized document once per second even when no source was selected.

## Decision

The authoritative project database, lock, migrations, integrity checks, and manuscript
materialization repair remain the blocking project-open gate. Main publishes the project session
and manuscript workspace before the rebuildable Index worker finishes initialization. Knowledge
search reports explicit preparing, available, or unavailable readiness and cannot serve requests
until initialization succeeds.

The Index worker records clean shutdown. Clean reopens retain application/schema validation and
active source/chunk fingerprint verification but skip the full-file structural scan. Legacy,
unknown, and unclean opens run the full scan in the background. Index cleanup retains the active
generation plus the three newest non-active generations and removes related or orphaned FTS and
sqlite-vec storage. No automatic `VACUUM` is added because it is synchronous and cannot be
cancelled safely during project close.

The Knowledge list becomes a bounded database summary containing source lifecycle, active
revision, and aggregate block/asset counts. Full normalized artifacts are loaded only for the
selected source. Polling runs only while corresponding work is active.

## Consequences

Manuscript editing is available independently of derived-index size. Search can be temporarily
unavailable after an unclean exit or while rebuilding, but no authoritative content is lost.
Existing indexes receive one conservative background scan before they can establish the clean
reopen marker. Freed SQLite pages may remain in the file until reused; this change bounds future
growth but does not perform an uninterruptible compaction.
