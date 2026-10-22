# ADR 092: Documentation Evidence Archive

Status: accepted under the user's documentation simplification request
Date: 2026-10-22

## Context

The `docs/` tree reached 1.9 MB. ADRs, the decision history, made up about 570 KB. Most of the rest
was verification evidence:

- The history log (584 KB) repeated test counts, durations, report paths, artifact digests, and
  failed attempts.
- Phase files (576 KB) mixed plans and decisions with the same evidence.
- `architecture.md` (112 KB) is required reading before every task.

Git already keeps every past version, so retaining all evidence in the working tree mainly adds
reading cost. AGENTS.md required the history log to be append-only and forbade rewriting existing
entries.

## Decision

Keep decision history in full, and archive verification evidence at a pinned commit.

- ADRs are unchanged and remain the decision history.
- Commit `493f02a26ccb18172de7390f5b3c5df9f2026905` on `main` is the evidence archive. It holds the
  complete history log and Phase files as they stood before this change.
- History log entries longer than 30 lines become short summaries. Each summary keeps its original
  heading and ends with a `Full record` link to the pinned original. Shorter entries stay verbatim.
- In Phase files, plans, scope, decisions, and acceptance criteria stay. `Local evidence`,
  `Completion evidence`, and similar sections and paragraphs become links to the pinned original.
  The Checkpoint 26.9 CI attempt narrative becomes an outcome summary.
- `architecture.md` condenses feature detail that the cited ADRs already state: Agent composer
  layout, autocomplete timing, import and publication internals, Writing Skills composition, and
  tool-mode prose. Security, storage, process, and data rules stay. Rules that exist only in the
  architecture also stay.
- File names and headings stay, so existing links and anchors keep resolving.

### Rules for new records

The history log stays append-only after this one-time summary pass. A future archive pass requires
a new decision. New entries record:

- what changed and why, with the issue and ADR links;
- the commits and tags;
- the gates run, with counts, duration, retries, and platform limits;
- open risks and known failures.

Command transcripts, report paths, per-scenario lists, bisect tables, artifact sizes, and digests
belong in commit messages, issues, pull requests, or `.cache/verification/`, not the log. Phase
files follow the same rule for their evidence sections.

## Alternatives

- **Split by month or archive directory, no summaries:** rejected. Size stays the same, and readers
  still meet the full evidence when they search.
- **Delete evidence and rely on git history alone:** rejected. Readers lose a browsable pointer
  from each entry to its full record.
- **Rewrite the architecture as a short rules list:** rejected for now. Several current rules
  appear only in the architecture. Moving them requires a per-domain review, not a size target.

## Migration impact

Documentation only. No code, test, or build change. The pinned commit is already on `origin/main`,
so archive links resolve on GitHub without a new tag.

## Verification

- A link check covers every relative Markdown link and heading anchor in the repository.
- A second check resolves every pinned `Full record` and `archived record` anchor against the
  files at the pinned commit.
