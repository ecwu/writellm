# Data Model: Pi agent writing tasks

**Status**: Draft; durable schema/version and Pi session retention require acceptance before tasks generation.

## Product entities

### `WritingTask`

```ts
type WritingTask = {
  kind: 'writing-task'; schemaVersion: 1;
  projectId: string; taskId: string; chapterId: string;
  instruction: string;
  selectedBlockIds: string[];
  selectedSourceRefs: Array<{ sourceId: string; chunkId: string }>;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled' | 'interrupted';
  sourceTaskId?: string;
  authorizationSnapshot?: AuthorizationSnapshot;
  providerSnapshot?: ProviderSnapshot;
  sessionRef?: string;
  readAudit: ToolReadAudit[];
  proposalId?: string;
  outcome?: 'proposal-ready' | 'no-safe-proposal';
  error?: PublicTaskError;
  generation: number;
  createdAt: string; startedAt?: string; endedAt?: string;
};
```

`generation` is incremented when cancellation/recovery closes a run. Every async tool/event/write captures it; mismatches are late and ignored.

### `AuthorizationSnapshot`

Created at queued → running after resolving current IDs:

```ts
type AuthorizationSnapshot = {
  blockIds: string[];
  sourceRefs: Array<{ sourceId: string; chunkId: string }>;
  establishedAt: string;
  projectRevision: string;
};
```

It defines what may be read, not what was read. Text is absent.

### `ToolReadAudit`

```ts
type ToolReadAudit = {
  kind: 'block' | 'source-chunk';
  id: string;
  parentId?: string;
  revision: string;
  contentHash: string;
  firstReadAt: string;
  lastReadAt: string;
  changedSinceStart: boolean;
};
```

Evidence and authorized proposal targets must be subsets of successful audit entries.

### `ProviderSnapshot`

Contains provider/model display labels and 005 `configRevision`; no endpoint query, headers, credential or vendor request options.

### `WritingProposal`

```ts
type WritingProposal = {
  kind: 'writing-proposal'; schemaVersion: 1;
  projectId: string; proposalId: string; taskId: string;
  outcome: 'proposal-ready' | 'no-safe-proposal';
  summary: string;
  changes: ProposalChange[];
  groups: ChangeGroup[];
  createdAt: string;
};
type ProposalChange = {
  changeId: string;
  kind: 'modify' | 'insert' | 'delete';
  scope: 'authorized' | 'extension';
  targetBlockIds: string[];
  anchor?: { blockId: string; placement: 'before' | 'after' | 'inside-end' };
  baseRevisions: Array<{ blockId: string; revision: string; contentHash: string }>;
  suggestedText?: string;
  intent: string;
  evidence: { status: 'sufficient' | 'insufficient' | 'not-applicable'; refs: Array<{ sourceId: string; chunkId: string; revision: string }>; explanation: string };
  impacts: Array<{ kind: 'descendant' | 'reference'; id: string; label: string }>;
  applicability: 'applicable' | 'stale' | 'unlocatable' | 'impact-unknown' | 'needs-author-judgment';
  groupId?: string;
};
```

Proposal IDs and normalized fields are generated/recomputed by main, not trusted from model arguments. No entity has a body-write state.

### Pi session

Each task has one append-only Pi session containing prompts, assistant/tool messages and harness state required for deterministic ordering. `sessionRef` is internal and never IPC. Runtime tools/model/auth are recreated by the host; they are not serialized as implementations.

Product state and proposal remain canonical. Session corruption can fail/interupt a task but cannot alter an existing proposal or body.

## State transitions

```text
queued -> running -> completed
   |         |  \-> failed
   |         |  \-> canceled
   |         \----> interrupted (startup recovery)
   \--------------> canceled
```

All terminal states are immutable. Retry creates another `queued` task. `completed` requires a durable `finish_task` outcome; an ended Pi run or final assistant message is insufficient.

## Persistence

```text
ai/tasks/<taskId>.json
ai/proposals/<proposalId>.json
ai/sessions/<taskId>.jsonl   # exact adapter/schema subject to ADR gate
runtime/pending/<transactionId>.json
```

Writes use ADR-001 serialization/temp+rename/recovery. Proposal + completed task commit atomically as one logical transaction. Session writes are ordered before the related terminal product commit. Unknown versions fail closed.

## Validation invariants

- Selection IDs are non-empty/unique and source refs are author-selected.
- Authorization snapshot contains no content and cannot expand after start.
- Read audit cannot be created from model arguments; only successful tools write it.
- Proposal authorized targets/evidence must match audit revisions.
- Scope extension is explicit and cannot pretend unauthorized content was read.
- Delete impact is system-computed; unknown impact is non-applicable.
- Canceled/interrupted generation cannot write session/proposal/task completion.
- Transcript/provider output never becomes proposal without the proposal and finish tools.
