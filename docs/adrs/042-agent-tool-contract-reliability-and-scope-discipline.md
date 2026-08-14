# ADR 042: Agent Tool Contract Reliability And Scope Discipline

Status: accepted for Checkpoint 50
Date: 2026-08-13

## Context

The screenshot run in the reported Agent conversation made 69 tool attempts: 27 failed before
Main dispatch and ten returned an explicit execution error. Subsequent continuation runs raised the
conversation total to 187 attempts, 69 preflight failures, and twelve execution errors. Sixty-eight
of those 81 failures belonged to `submit_section_change`, twelve to `submit_outline_change`, and
one to `read_writing_skill`.

The project database provides broader, though uneven, evidence. It contains 347 attempts across
14 of the 20 currently registered model-visible tools. `submit_section_change` failed 68 of 90
attempts, `submit_outline_change` failed 14 of 23, historical contract-v3 `generate_image` calls
failed 11 of 19, and `read_writing_skill` failed two of nine. The other ten exercised tools had no
recorded failure. Six tools have no hands-on sample in this database, so absence of an error is not
evidence that their model contract is sound.

The generated model-visible envelope itself exposes a systemic risk. Its 20 tools serialize to
55,220 bytes. `submit_section_change` alone occupies 25,140 bytes because a rare canonical-block
branch embeds the recursive BlockNote schema. Across the envelope, 366 section properties and all
other tool fields have zero field-level descriptions. Important Zod refinements disappear during
JSON Schema conversion, including:

- `read_section` view-specific requirements;
- the non-empty `read_citations` request invariant;
- `search_knowledge` page ordering;
- paired review-issue ID/version requirements;
- writing-task plan-state invariants;
- non-empty Brief, outline-update, and writing-rule changes; and
- section/image anchor-placement compatibility.

Pi validates the generated JSON Schema before dispatch, while Main later parses the authoritative
Zod contract. When those schemas express different languages, a call may pass provider/Pi
preflight and fail in Main, or a required-but-defaultable field may fail before Main can normalize
it. This is an all-tool contract problem, not only a section-edit prompt problem.

The runtime evidence also contains tool-specific defects. Outline normalization calculates a move
position while the moving node is still present, but the simulator removes it first. Section
insertion requires an explicit nullable anchor even for an empty body. Image generation requires
anchor/placement fields even for iteration, although iteration placement is determined by the
source figure and disposition. Writing Skill failures state a sequencing prerequisite without a
machine-readable recovery target. Tool errors already carry structured recovery inside the Main
response, but conflict recovery generically recommends `get_writing_context` even when the exact
refresh tool is `read_section`, `read_outline`, `list_review_issues`, or `get_writing_task`; the
Renderer then hides most of that behind a generic failure marker.

Both application and project databases pass integrity checks, and successful calls occur beside
the failures. The evidence is therefore inconsistent with a provider-wide, model-wide, or SQLite
failure. It combines contract fidelity, implementation, state guidance, continuation scope, and
failure-presentation problems.

## Decision

Checkpoint 50 audits and hardens all 20 entries in `AGENT_MODEL_VISIBLE_TOOL_SPECS` as one bounded
tool-contract checkpoint. It keeps the existing tool names and authorities; it adds no generic
edit tool or alias.

### Common model contract

The existing Pi-shaped `AgentModelVisibleToolSpec` and worker spread assembly stay unchanged. Each
tool description uses at most four short sentences in this order: bounded purpose and absent
authority, output and empty-result semantics, key prerequisite or runtime invariant, then
pagination or recovery. Descriptions contain no JSON call examples. Only non-obvious ID, hash,
version, cursor, mode, placement, and virtual-URI fields receive one-line descriptions naming the
exact result field from which the value is copied. Cross-tool sequencing remains in the ADR 017
application policy instead of a new structured-guidance type or compiler.

Model-visible JSON Schema is intentionally simpler and no stricter than authoritative Main Zod.
The compatibility requirement is one-way: every standard minimal and boundary-valid call accepted
by Main must pass Pi preflight, while a call rejected by Main may pass preflight and receive a
precise domain error. High-load mutually exclusive modes may use one flat union; simple non-empty,
pairing, ordering, state, and version invariants stay in Main and in description prose. Nested
unions are not introduced merely to mirror `refine` or `superRefine`. Defaults are never advertised
as required, while strict object boundaries and basic type, enum, count, and byte limits remain.
Ordinary normalization uses Zod defaults, including nullable insertion anchors. A per-tool
`prepareArguments` shim is allowed only for an observed stable model quirk and must have a dedicated
input/output fixture; no shim is added speculatively.

The usage contracts stay compact. The serialized 20-tool envelope may not exceed 48 KiB and no
single tool may exceed 8 KiB. To meet that budget without weakening Main validation,
`replaceCanonicalBlock.block` becomes an opaque bounded JSON object in the model schema, described
as the exact canonical block returned by `read_section`; Main still validates it against the full
BlockNote contract and still requires a current-run canonical read. The current recursive schema
is not sent to every model request.

### Read and context tools

`get_writing_context`, `read_outline`, `search_manuscript`, `search_knowledge`,
`inspect_change`, `check_draft`, `list_review_issues`, and `get_writing_task` keep their current
behavior. Their contracts make `{}` defaults, optional filters, pagination, null/empty success,
and snapshot provenance explicit. `check_draft` is diagnostic-only and cannot authorize a fix.

`read_section` uses one flat union for paginated or selected-block summary, one-block canonical
read, and one-block canonical-fragment pagination. Its result explicitly identifies `blockId`,
`blockHash`, and `revisionId` as the only valid source for subsequent section preconditions.

`read_citations` keeps flat `citationIds` and `requests` fields with at most one shallow
`anyOf: [{required: [citationIds]}, {required: [requests]}]`; Main enforces actual non-empty arrays,
duplicates, combined count, and pagination bounds. `search_knowledge` keeps flat `pageFrom` and
`pageTo`; Main reports the safe actual range and exact correction when ordering is invalid. No hits
or unavailable reranking remain successful bounded outcomes, not permission to invent evidence.

`read_writing_skill` keeps the authorized virtual-URI boundary. A phase mismatch returns a safe
recovery containing the exact authorized entrypoint/reference URI that may be read next; it does
not expose filesystem paths. Skill content may constrain authorized work but cannot widen the
user's mutation scope.

### Review and writing-task tools

`record_review_issues` keeps one flat candidate shape; Main requires an existing issue ID and
expected version together and directs conflicts to `list_review_issues`. `update_review_issues` documents the exact
claim/release/resolve/reopen transition matrix and refreshes through `list_review_issues` on a
version conflict. Review diagnostics and issue state do not grant manuscript mutation authority.

`create_writing_task` requires unique client references in Main and describes the duplicate
position plus Main-assigned task/step IDs returned on success. `update_writing_task` retains one
flat retained/new-step union, while Main enforces status reasons, the single-active-step invariant,
and preservation of every existing step ID from the latest `get_writing_task` result. A null task is a successful
`get_writing_task` outcome, not a reason to create one unless the user request is genuinely
multi-step.

### Proposal and generation tools

All proposal tools state that Main binds schema/manuscript/base versions, that citation IDs must
come from expanded citations in the current run, and that `resolvesReviewIssues` may contain only
currently claimed exact issue IDs/versions. An applied or satisfied structured result is the only
manuscript success signal.

`submit_brief_change` keeps a flat partial changes object and Main rejects an empty change with an
actionable error. `submit_writing_rules_change` retains its existing operation union. Writing-rule
update/remove operations use exact current IDs, while non-empty update, uniqueness, and active
budget constraints remain authoritative Main checks with bounded actionable errors.

`submit_outline_change` retains SectionRef/clientRef operations and uses sequential provisional
state. A move removes and compacts the target in its source siblings before resolving
`first`/`last`/`before`/`after`; delete also compacts before the next operation. Every normalized
placement must be accepted by the authoritative simulator.

For `submit_section_change`, omitted insertion anchors normalize to `null`. Root insertion accepts
only `start`/`end`; `before`/`after`, replacement, removal, and movement require exact current-run
block preconditions. One sentence describes the empty-section rule without a JSON example.
Fabricated, cross-section, deleted, and stale blocks remain rejected.

`generate_image` has two explicit model-visible modes. New insertion uses an optional-null anchor
with the same root/anchored placement rule as section insertion. Iteration requires only the exact
generated source-block precondition and `replace`/`insert_after` disposition; it does not require a
second meaningless anchor/placement pair. Main still reuses retained prompt/asset lineage and
validates provider, source figure, revision, and proposal authority. Contract-v8 tests
freeze provider rejection as `unavailable`, never `Agent read tool failed`.

### Scope and recovery

Application policy outranks Writing Skills and diagnostic tools. A Skill, `check_draft`, review
issue, writing task, or tool recovery may constrain or advise work but cannot introduce a new
artifact, mutation kind, or manuscript region. Approval authorizes only the reviewed proposal.
Main owns the approval-continuation instruction, removes the unconditional `check_draft` request,
and continues only unresolved work already requested by the user.

Structured error recovery becomes tool-aware. Section conflicts point to `read_section`, outline
conflicts to `read_outline`, review conflicts to `list_review_issues`, task conflicts to
`get_writing_task`, proposal inspection misses to the authoritative proposal result, pagination
failures to restart the same read, and transient retrieval/generation failures to at most one
retry. No recovery may instruct the model to guess an identifier or repeat indefinitely.

### Diagnostics and presentation

The existing `tool_preflight_failed` event gains an optional app-owned message of at most 1,000
characters, safe code — `invalid_arguments`, `unknown_tool`, or `preparation_failed` — and at most
16 schema paths derived from the registered schema and argument shape. Existing
`tool_result.error` persistence gains optional safe category and recovery fields.
Neither payload stores argument values, dependency validation strings, prompts/responses,
manuscript text, credentials, or private paths. Old events remain readable.

The Renderer projects preflight failures and displays the safe code, message, and one bounded
recovery action for dispatched failures instead of only `Proposal could not be prepared`.
Structured logs record correlated safe IDs, tool name, phase, code, recovery action, path count,
and duration.

Checkpoint 50 does not add a generalized hard-abort or retry state machine. Pi-local malformed
arguments occur before the Main bridge; a graceful cross-provider turn-stop is a separate protocol
decision. This checkpoint removes model-schema false rejections for standard valid calls, fixes
the known state/implementation defects, provides exact one-retry recovery, exposes residual
failures, and then measures whether a circuit breaker is still justified.

## Consequences

Every registered tool receives a tested usage and recovery contract, including the six tools not
exercised in current hands-on data. The highest-risk section schema becomes substantially smaller,
outline and image modes become internally consistent, stateful Skill/review/task tools become
recoverable, and read-tool empty/pagination behavior becomes explicit. Prompt growth is bounded
and provider-neutral.

This amends ADR 005's preflight/result event payload, ADR 015's approval continuation wording, and
ADR 017's application prompt/tool-envelope policy. It preserves typed proposal review, project
capabilities, Main authority, the Renderer sandbox, optimistic concurrency, event authority, and
provider-neutral prompts. It adds no migration, table, generic tool, provider fork, model-specific
prompt, dependency, worker role, background job, package/release action, or hosted CI work.

The Agent tool contract version advances from 7 to 8 while every descriptor and result-meta union
continues accepting versions 2 through 8 and persisted payload defaults continue accepting version
1. The Agent tool-result schema version and event schema version do not change. No migration is
needed because persisted `tool_call.args` and `tool_result.result` are opaque `z.record` values and
historical replay does not reparse them through the current per-tool schema; v1-v7 records remain
readable after field flattening and the v8 change.

## Alternatives Rejected

- Repair only `submit_section_change`. The same lost-refinement and missing-field-guidance pattern
  exists throughout the 20-tool envelope.
- Treat failures as model quality alone. This does not explain the deterministic outline defect,
  schema-language mismatch, irrelevant image iteration fields, or generic recovery mapping.
- Strengthen only the system prompt. Prompt text cannot repair normalizer/simulator disagreement or
  eliminate model-schema false rejection or repair Main's runtime recovery.
- Mirror every Main refinement in JSON Schema. This recreates the complex preflight language that
  caused the observed loop; Pi-style broad shape validation plus precise Main errors is simpler and
  more recoverable.
- Add simpler alias tools for section append or image iteration. Aliases duplicate authority and
  make tool routing more ambiguous; the existing typed contracts should be corrected.
- Send the full recursive BlockNote schema. It consumes nearly half of the current tool envelope
  for a rare operation even though Main must validate the returned canonical object anyway.
- Relax block/version preconditions or let Main infer targets. That can apply changes to unintended
  manuscript state and breaks optimistic concurrency.
- Persist raw validation/provider errors. They may contain private argument values or unstable
  dependency text.
- Add a global retry circuit breaker now. The accepted protocol lacks a graceful Pi-preflight stop
  contract, and the measurable contract defects should be removed before adding another state
  machine.
