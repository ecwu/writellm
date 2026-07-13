# Plan decision checklist: Pi writing agent

**Updated**: 2026-07-13

**Purpose**: Review the revised 008 plan before acceptance/tasks generation.

## Resolved by this revision

- [x] One WritingTask is executed by one Pi `AgentHarness`; no one-shot provider adapter.
- [x] Body/source content reaches the model only through authorized read tools.
- [x] Changes enter the product only through `submit_proposal` + `finish_task`; final prose/JSON is ignored.
- [x] No generic filesystem, shell, provider, prompt, transcript or body-write capability is exposed.
- [x] Tool arguments use TypeBox exact schemas and all tool executions are sequential/audited.
- [x] Product task/proposal records remain canonical; Pi session is internal durable agent state.
- [x] Task authorization is fixed at run start; actual tool reads record revision/hash.
- [x] Cancel uses a durable generation barrier plus harness abort; late results are discarded.
- [x] Retry creates a new task/session; running work after restart becomes interrupted and is not replayed.
- [x] v1 uses 005's pinned Pi/model/auth path, faux-provider tests and no hidden provider retries.
- [x] Planned Pi hooks/session facade/auto-retry/stream recovery are not implementation dependencies.

## Acceptance blockers

- [ ] 008 `spec.md` is reviewed and Accepted, including FR-019/FR-020.
- [ ] 006/007 contracts are accepted and expose source content/location/revision by stable IDs.
- [ ] 004 contract exposes block content/revision/hash and delete descendant/reference impact lookup.
- [ ] Maintainers decide whether `ai/sessions/<taskId>.jsonl` and transcript retention require a new ADR; decision is recorded in plan and registry.
- [ ] Durable schema versions, retention/deletion policy and maximum transcript/tool-result size are frozen.
- [ ] Exact limits are frozen: instruction length, selected IDs, turns, tool calls, cumulative read bytes, proposal changes/bytes and timeout.
- [ ] Public error copy/localization and diagnostic retention are accepted.
- [ ] 009 accepts the revised proposal shape, especially scope extension, stale base, groups and impact disclosure.
- [ ] Privacy UX states what selected body/source content may be sent to the configured external model.
- [ ] Registry Plan/ADR status is updated in the same change when this plan is accepted.

## Implementation gate

- [ ] No `tasks.md` or product implementation begins until every repository gate above is satisfied.
