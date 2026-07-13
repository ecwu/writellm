# AI writing task IPC contract

**Status**: Draft. This is the named renderer/preload/main boundary; Pi harness, tools, transcript, paths and credentials never cross it.

## API

```ts
type AiWritingTaskApi = {
  create(request: CreateWritingTaskRequest): Promise<TaskDetailDto>;
  get(request: TaskIdentityRequest): Promise<TaskDetailDto>;
  list(request: ListWritingTasksRequest): Promise<TaskSummaryDto[]>;
  getProposal(request: ProposalIdentityRequest): Promise<ProposalDetailDto>;
  cancel(request: TaskIdentityRequest): Promise<TaskSummaryDto>;
  retry(request: TaskIdentityRequest): Promise<TaskSummaryDto>;
  onUpdated(listener: (event: TaskUpdatedEvent) => void): () => void;
};
```

No generic invoke/event, `readFile`, `runPrompt`, `runTool`, `getSession`, `getSecret`, `applyProposal` or transcript streaming method exists.

## Requests

```ts
type CreateWritingTaskRequest = {
  projectId: string;
  chapterId: string;
  instruction: string;
  targetBlockIds: string[];
  sourceRefs: Array<{ sourceId: string; chunkId: string }>;
};
type TaskIdentityRequest = { projectId: string; taskId: string };
type ProposalIdentityRequest = { projectId: string; proposalId: string };
type ListWritingTasksRequest = {
  projectId: string;
  chapterId?: string;
  statuses?: TaskStatus[];
  limit?: number;
  cursor?: string;
};
```

Main validates the sender/current project, trims and bounds instruction, deduplicates IDs, resolves all IDs through 004/007 and checks 005 readiness. Renderer cannot select provider profile/options. Submission records selection only; content is later obtained by agent tools.

## Responses

```ts
type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled' | 'interrupted';
type TaskSummaryDto = {
  projectId: string;
  taskId: string;
  chapterId: string;
  status: TaskStatus;
  statusCode?: TaskErrorCode;
  statusReason?: string;
  proposalId?: string;
  sourceTaskId?: string;
  targetBlockCount: number;
  sourceRefCount: number;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
};
type TaskDetailDto = TaskSummaryDto & {
  instruction: string;
  targetBlockIds: string[];
  sourceRefs: Array<{ sourceId: string; chunkId: string; label: string }>;
  provider: { providerLabel: string; modelLabel: string; configRevision: string };
  readAudit: { blockCount: number; sourceChunkCount: number; hasChangedInputs: boolean };
};
type ProposalDetailDto = {
  projectId: string;
  proposalId: string;
  taskId: string;
  readOnly: true;
  outcome: 'proposal-ready' | 'no-safe-proposal';
  summary: string;
  changes: ProposalChangeDto[];
  createdAt: string;
};
```

DTOs omit sessionId, transcript, prompts, tool args/results, raw provider response/request IDs, usage, absolute paths, secrets and full source excerpts. Proposal changes expose only the content and evidence metadata needed by 009.

## Updates

```ts
type TaskUpdatedEvent = {
  projectId: string;
  task: TaskSummaryDto;
  reason: 'created' | 'started' | 'completed' | 'failed' | 'canceled' | 'interrupted';
};
```

Events follow durable commit and contain summaries only. Event delivery is not durable; remount/project reopen uses `list/get`. Preload owns listener filtering/unsubscribe.

## Stable errors

```ts
type TaskErrorCode =
  | 'IPC_INVALID_INPUT' | 'IPC_UNAUTHORIZED_SENDER' | 'PROJECT_NOT_OPEN'
  | 'TASK_TARGET_MISSING' | 'TASK_SOURCE_UNAVAILABLE' | 'TASK_ALREADY_TERMINAL'
  | 'PROVIDER_NOT_READY' | 'PROVIDER_AUTH_FAILED' | 'PROVIDER_UNREACHABLE' | 'PROVIDER_TIMEOUT'
  | 'AGENT_TOOL_ARGUMENTS_INVALID' | 'AGENT_UNAUTHORIZED_READ'
  | 'AGENT_BUDGET_EXHAUSTED' | 'AGENT_NO_TERMINAL_TOOL'
  | 'AGENT_SESSION_WRITE_FAILED' | 'PROPOSAL_INVALID'
  | 'STORAGE_WRITE_FAILED' | 'STORAGE_RECOVERY_REQUIRED';
```

Messages are localized/safe summaries with optional local diagnostic ID. Raw Pi/provider/tool errors are never serialized.

## Cancellation and retry

- Cancel queued/running is idempotent and returns canceled after its barrier is durable.
- A canceled task never returns to completed, even if Pi emits late events.
- Retry is allowed only for failed/canceled/interrupted tasks and creates a new task with `sourceTaskId`; the old record is immutable.
- Window close/project switch removes UI listeners but does not implicitly cancel main-owned work. App shutdown leaves active work recoverable as interrupted.
