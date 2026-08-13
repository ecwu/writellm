# ADR 024: Agent-Native Review Fixtures

Status: accepted for Checkpoints 32, 45, and 33; implementation authorized; protocol superseded to v6 by ADR 025
Date: 2026-08-12

## Context

WriteLLM already has one ordinary Agent conversation loop, immutable per-model-request writing
snapshots, deterministic `check_draft`, bounded evidence tools, and revision-checked manuscript
proposals. The post-CP31 roadmap originally described a separate Review Center execution surface,
one-off semantic review results, and a structured writing-decision editor. That split would make
review, rule extraction, and repair look like separate Agent products even though they need the
same model selection, context, cancellation, proposal, approval, and continuation boundaries.

The author instead wants review state to be a set of project-local fixtures for the existing Agent:
deterministic checks, durable actionable problems, and explicit writing rules. A normal
conversation must be able to inspect and update those fixtures while manuscript changes remain
ordinary typed proposals. The Renderer may visualize the fixtures, but it must not own another
review engine or launch a hidden/special model flow.

## Decision

### 1. Ordinary Agent conversations remain the only model execution surface

There is no review session type, review provider, nested model call, hidden extraction request,
durable review job, or independent report table. The application adds a static `REVIEW_POLICY` to
the ordinary Agent system prompt. A user request such as “check and fix the manuscript” stays in
the current conversation and uses the same provider/model, Thinking, Writing Skill, approval,
stop/steer, immutable snapshot, and continuation behavior as any other turn.

### 2. Deterministic review is a pure snapshot read

`check_draft` remains a read-only Agent tool. Its pure review core receives one immutable writing
snapshot and never rereads live revisions. Results use P0-P3, stable check IDs, bounded evidence,
exact section/revision/block locations, and explicit `passed`, `failed`, `skipped`, or `unavailable`
check outcomes. It neither persists a problem nor changes manuscript or collaboration state.

P0 is reserved for an integrity/safety failure or a severe source claim supported by explicit
evidence. Ordinary correctness, consistency, and prose problems are P1-P3. A run returns at most
200 findings.

### 3. Review issues are bounded collaboration metadata, not manuscript authority or tasks

Project SQLite adds `review_issues` and append-only `review_issue_events`. An issue has a stable ID,
P0-P3 priority, bounded category/title/description/evidence, one exact optional section/revision/
block anchor, source Agent lineage, `open | in_progress | resolved | dismissed` status, an optional
assignee conversation, an optimistic version, and an optional resolving proposal. Anchors that no
longer resolve are shown as orphaned; Main never guesses a replacement.

The Agent receives `list_review_issues`, `record_review_issues`, and `update_review_issues`.
Recording/updating issues is direct bounded metadata mutation, not a manuscript write and not a
proposal. The Agent must list existing active issues before recording; Main performs exact
fingerprint deduplication and no fuzzy semantic merge. One call records at most 50 issues, one call
updates at most 20, and one run creates at most 100 new issues. All updates require the current
issue version.

Assignment is advisory and auditable, not a lock. Another conversation may reassign an issue using
the current version. Stale writers fail with a conflict. This checkpoint adds no task plan, step,
scheduler, background recovery loop, or CP34 task identity; a later checkpoint may add only an
optional task relation.

### 4. Writing rules are reviewed Brief state, not implicit memory

The current Brief's bounded `extensible` data gains one application-owned `writingRulesV1`
namespace. It contains at most 100 strict rules, at most 50 active rules, and at most 32 KiB of
active serialized data. A rule has a stable ID, category, instruction, optional preferred and
discouraged forms, optional rationale, and active state.

Active rules are injected in full as `TRUSTED_WRITING_RULES` below static application policy. They
cannot grant tools, weaken security/citation/truthfulness policy, or silently win a conflict. The
Agent submits rule changes through `submit_writing_rules_change`, a normal revision-checked
proposal bound to the source Brief version. It supports add, update, activate/deactivate, and
remove operations. No separate extraction model call exists. Ordinary `submit_brief_change` may
not alter the reserved namespace.

### 5. Repair stays proposal-based and issue reconciliation is subordinate

Existing manuscript proposal arguments gain optional `resolvesReviewIssues` entries containing an
issue ID, expected version, and bounded resolution summary. Main validates that the issue is
currently assigned to the proposing conversation and records the immutable relation with the
proposal. Only an authoritative `applied` or `satisfied` proposal may resolve linked issues.

Issue reconciliation is subordinate metadata: an issue version race, dismissal, reassignment, or
fixture failure never rolls back or blocks an otherwise valid manuscript proposal. The proposal
result reports the unresolved metadata warning. Undo reopens an issue only when that same proposal
is still its current resolver and no later user/Agent transition superseded it. A no-manuscript-
change resolution uses `update_review_issues` with an explicit reason.

### 6. The Workbench is a passive projection

The workspace gains a responsive auxiliary Workbench with Issues and Writing Rules tabs. It can
filter, navigate, edit user-owned fixture state, and show lineage/history. It has no review button,
model invocation, duplicated deterministic rule, or direct database authority. Renderer inputs and
outputs are bounded shared contracts; Main authorizes the sender and active `projectSessionId`.

## Consequences

Agent Harness Protocol v5 extends v4 with three bounded fixture tools and one typed rule proposal
tool. Tool dispatch distinguishes snapshot reads, fixture mutations, and proposal/effect tools.
The Renderer remains untrusted, manuscript writes remain typed proposals, and the existing three
worker roles are unchanged.

The new issue tables are authoritative project collaboration state and therefore participate in
database backup, project snapshots, history restore, and project portability. They are not stored
in `app.sqlite` and are not used as recovery state for Agent runs.
