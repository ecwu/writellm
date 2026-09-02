# ADR 068: Agent Interaction Mode Ceilings

Status: accepted for Checkpoint 76; implementation authorized
Date: 2026-08-30

## Context

ADR 067 reduced the initial writing envelope by letting the model activate bounded tool groups.
That mechanism optimizes context after Main has already authorized an ordinary writing run. It
cannot represent a user's stronger instruction that a particular run may only inspect the
manuscript or may plan without proposing manuscript changes: a writing run that starts without an
active group still has `activate_tool_groups` and can widen its own active set.

ADR 067 rejected UI-selected modes because making every ordinary request depend on a manual choice
would add product state and friction. The requested interaction does not require that tradeoff.
New conversations continue to default to Write, while Ask and Plan are explicit user-selected
ceilings that reduce authority. The selected value remains directly beside Send, may be changed
before each run, and persists until the user changes it. A run snapshots the value and cannot
widen it.

Notebook, an ungrouped Write run, and Ask are not interchangeable. Notebook is transient and can
only inspect selected Knowledge sources. Ask is a durable writing conversation that can inspect
the manuscript and project Knowledge but has no activation capability. Write retains the existing
activation mechanism and proposal boundary.

## Decision

### 1. Keep the outer profiles and add one writing-only interaction mode

`writing` and `notebook_knowledge` remain the only outer Main-authorized tool profiles. Durable
writing sessions add a sticky `ask`, `plan`, or `write` interaction mode; Notebook has no mode.
New and migrated writing sessions default to `write`. Every writing run stores an immutable mode
snapshot.

One application-owned policy computes the effective model-visible and executable tool set from
the outer profile, interaction-mode ceiling, and active writing groups. Worker advertises that
set, and Main rejects every call outside it.

### 2. Freeze the three writing ceilings

- Ask exposes `get_writing_context`, `read_outline`, `read_section`, `search_manuscript`,
  `search_knowledge`, and `read_citations`.
- Plan exposes the Ask tools plus `read_writing_skill`, `ask_user`, `inspect_change`,
  `check_draft`, `list_review_issues`, `get_writing_task`, `create_writing_task`, and
  `update_writing_task`.
- Write preserves the nine Protocol v12 core tools and the seven run-local activation groups.

Ask and Plan never expose `activate_tool_groups`. Plan may change only Writing Task collaboration
metadata; it cannot record or update Review Issues or create Brief, Writing Rule, Outline,
Section, table, or image proposals. Approval policy never enlarges a mode ceiling.

### 3. Snapshot mode at the run boundary

The session value may change only when no live run, clarification waiter, compaction, generation,
or reserved steer/follow-up remains. Pending proposals do not block changing the next ordinary
run. Steering and follow-up messages inherit their live run's snapshot.

Approval and rejection continuations inherit the originating proposal run's Write authority even
if the session has since selected Ask or Plan. Quick actions and Writing Task resume require Write.
After a continuation, the user's sticky session selection remains unchanged.

Agent Harness Protocol and the tool contract advance from 12 to 13. Run start and every model-call
authorization carry the immutable mode. Agent event schema remains version 3; run records own
historical mode projection.

### 4. Compose one provider-neutral mode policy layer

Application safety and tool authority remain first in prompt precedence. A bounded application
mode block follows them and precedes collaboration, writing, citation, Skill, trusted requirement,
and manuscript-data layers. Initial calls, tool continuations, compaction recovery, and overflow
restarts rebuild the exact same run-mode policy and envelope. Full prompts and private content
remain excluded from logs.

### 5. Put the sticky selector beside Send

The idle composer keeps its single footer row: Add, approval, elastic model/effort, interaction
mode, and Send. The mode trigger uses a shadcn Dropdown Menu Radio Group with Ask, Plan, and Write
plus short truthful descriptions. It stays visible but disabled while a run is live. Ask and Plan
leave the approval selector visible but disabled and retain its stored value for the next Write
run. The configured desktop composer keeps Add, approval, mode, and Send complete while
model/effort truncates first when space is needed.

## Consequences

The default Write path and Protocol v12 demand groups remain intact. Users gain an enforceable,
auditable read-only or plan-only ceiling without a classifier, provider fork, new worker, durable
job, generic permission engine, or direct manuscript write. Project migration 0039 adds only the
session default and run snapshot columns. Notebook authority and persistence remain unchanged.

Checkpoint 76 does not extend Writing Task schema version 1. Detailed plan fields, stale target
reconciliation, and Plan-to-Write task handoff remain separately gated Checkpoint 77 work.

## Alternatives Rejected

- Rely only on `activate_tool_groups`: the model, rather than the user, still controls whether a
  writing run widens its active set.
- Use prompt text without an enforced ceiling: this is neither auditable nor fail closed.
- Require a choice for every message: this adds the friction ADR 067 rejected; a sticky Write
  default preserves ordinary behavior.
- Add three outer profiles or a generic permission engine: both duplicate the existing profile and
  active-set authority.
- Add a classifier call: it hides an authority decision and adds latency and cost.
- Implement only Plan: it does not provide durable manuscript-aware question answering with a hard
  read-only ceiling.
