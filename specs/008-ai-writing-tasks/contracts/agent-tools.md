# Agent tool contract

**Status**: Draft for feature review. These are main-internal `AgentTool` contracts, not renderer IPC and not generic filesystem tools.

## Shared rules

- Every tool uses a TypeBox object schema with `additionalProperties: false`.
- `taskId` is injected by the tool closure, never selected by the model.
- Tool execution revalidates the active task generation token and `AbortSignal` before reads and before durable writes.
- IDs are opaque domain IDs; absolute/relative paths, provider options, secrets and raw SQL/shell input are rejected.
- Expected failures throw a typed main-only tool error; the agent receives a bounded safe message. Tool `details` never contains full content or secrets.
- All tools use `executionMode: "sequential"` so proposal validation observes deterministic read/audit state.

## `read_task_brief`

Parameters: `{}`.

Returns task instruction, authorized block/source IDs, operation limits, proposal schema summary and remaining call/byte budget. It does not return block or source text.

## `read_blocks`

Parameters:

```ts
{ blockIds: string[] }
```

Every ID must be in `authorizationSnapshot.blockIds`. The result contains block ID, chapter ID, type, text, start revision/hash and current freshness. Successful reads append/merge `ToolReadAudit` entries. Results are bounded and may require pagination by ID batch; truncation is explicit.

## `read_sources`

Parameters:

```ts
{ refs: Array<{ sourceId: string; chunkId: string }> }
```

Every pair must be authorized. Results contain text, source revision, source label and stable location metadata from 007. Successful reads append/merge audit entries. The agent may cite only refs successfully returned by this tool.

## `submit_proposal`

Parameters (conceptual shape; exact limits live with shared constants):

```ts
{
  summary: string;
  changes: Array<{
    clientChangeId: string;
    kind: 'modify' | 'insert' | 'delete';
    scope: 'authorized' | 'extension';
    targetBlockIds: string[];
    anchor?: { blockId: string; placement: 'before' | 'after' | 'inside-end' };
    suggestedText?: string;
    intent: string;
    evidenceRefs: Array<{ sourceId: string; chunkId: string }>;
    groupId?: string;
  }>;
  groups: Array<{ groupId: string; memberClientChangeIds: string[]; reason: string }>;
}
```

Validation and normalization:

1. Authorized targets must be successfully read blocks and match read revision/hash.
2. Evidence refs must be successfully read source chunks; missing evidence is represented by an empty array plus explicit author-judgment reason.
3. Extension suggestions cannot name an unauthorized target as if it were read; they carry only an authorized anchor and boundary explanation.
4. Delete impacts are recomputed against 004/007 state. Incomplete impact discovery makes the change non-applicable.
5. Groups must be closed, non-overlapping and reference existing changes.
6. At most one proposal is accepted per task. A second call replaces only the in-memory draft before `finish_task`; every accepted call is auditable.
7. This tool writes proposal data only. No block/content mutation API is reachable from 008.

Returns normalized counts and validation warnings, not the full proposal.

## `finish_task`

Parameters:

```ts
{ outcome: 'proposal-ready' | 'no-safe-proposal'; reason?: string }
```

For `proposal-ready`, a valid proposal draft must exist. The tool atomically persists proposal + completed task through the ADR-001 writer, returns `terminate: true`, and closes the task generation. `no-safe-proposal` persists a completed empty outcome with an author-visible reason and also terminates. Final assistant text cannot change either result.

## Budgets

The runner enforces maximum turns, tool calls, per-read items, cumulative returned bytes, proposal changes and proposal bytes. Budget exhaustion produces a failed or explicit no-safe-proposal result; it never falls back to parsing assistant prose.
