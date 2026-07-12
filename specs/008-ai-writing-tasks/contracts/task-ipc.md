# Task IPC Contract（候选契约）

**状态**：`NEEDS DECISION`。本文定义 main/preload/renderer 的最小边界，不代表已经修改 `src/shared/ipc.ts` 或批准任何 channel/package。实现前必须与 ADR-001、004/005/007 的契约及 009 的 proposal 输入一起冻结。

## 责任边界

```text
renderer UI
  └─ named typed methods/listener
preload bridge
  └─ 逐一映射、过滤 listener、返回 plain DTO
main task service
  ├─ 校验 sender / active project / target / source / revision
  ├─ 访问 005 main-owned provider config/secret capability
  ├─ 运行 task lifecycle + cancellation + retry
  ├─ 调用 ProviderAdapter，不把 SDK 暴露出去
  └─ 通过 ADR-001 writer 持久化 task/proposal
```

renderer 不得拥有 Node/Electron API、文件路径、API key、通用 IPC channel、provider client、任意 prompt execution 或“应用提案”方法。

## 命名方法（候选）

名字和 channel 前缀仍需冻结；下列名称只表达意图。

```ts
type AiWritingTaskApi = {
  createAiWritingTask(request: CreateAiWritingTaskRequest): Promise<TaskDetailDto>;
  getAiWritingTask(request: GetAiWritingTaskRequest): Promise<TaskDetailDto>;
  listAiWritingTasks(request: ListAiWritingTasksRequest): Promise<TaskSummaryDto[]>;
  getAiWritingProposal(request: GetAiWritingProposalRequest): Promise<ProposalDetailDto>;
  cancelAiWritingTask(request: TaskIdentityRequest): Promise<TaskSummaryDto>;
  retryAiWritingTask(request: TaskIdentityRequest): Promise<TaskSummaryDto>;
  onAiWritingTaskUpdated(listener: (event: AiWritingTaskUpdatedEvent) => void): () => void;
};
```

不提供：`invoke(channel, ...)`、`send(channel, ...)`、`readFile(path)`、`runProvider(request)`、`getSecret()`、`applyProposal()`、任意事件订阅器或原始 provider stream 转发。

## Request DTO

```ts
type ProjectId = string;
type OpaqueId = string;

type CreateAiWritingTaskRequest = {
  projectId: ProjectId;
  chapterId: OpaqueId;
  operation: 'generate' | 'modify';
  instruction: string;
  targetBlockIds: OpaqueId[];
  sourceRefs: Array<{
    sourceId: OpaqueId;
    chunkId: OpaqueId;
    sourceRevision: string;
  }>;
  expectedProjectRevision?: string;
  providerProfileId?: OpaqueId;
};

type TaskIdentityRequest = {
  projectId: ProjectId;
  taskId: OpaqueId;
};

type GetAiWritingTaskRequest = TaskIdentityRequest;
type GetAiWritingProposalRequest = {
  projectId: ProjectId;
  proposalId: OpaqueId;
};

type ListAiWritingTasksRequest = {
  projectId: ProjectId;
  chapterId?: OpaqueId;
  statuses?: Array<'queued' | 'running' | 'completed' | 'failed' | 'canceled' | 'interrupted'>;
  limit?: number;
  cursor?: string;
};
```

### Request 规则

- main 重新 trim/validate `instruction`、去重并限制 `targetBlockIds`/`sourceRefs`；不能信任 renderer 的 label、source name、current status 或 revision。
- `projectId` 必须与当前 BrowserWindow/session 的 active project 相符；project/session 绑定方法由 001 冻结。
- `sourceRefs` 是否允许空数组仍是 `NEEDS DECISION`：当前按 FR-003 的保守解释要求至少一条有效、作者明确选择的 source ref；“有资料但证据不足”仍可成功并标记 evidence insufficient。
- `providerProfileId` 是否由用户选择，还是总是使用当前 005 profile，需与 005 冻结；它不能是 secret 或任意 endpoint。
- `expectedProjectRevision` 是防止在 UI 刚提交时使用错误 workspace 的额外 guard；最终是否必需为 `NEEDS DECISION`。
- renderer 传入的对象必须可 structured-clone；拒绝 function、Promise、Symbol、绝对路径、超过大小上限的字段和未知敏感字段。

## Response DTO

所有 DTO 只包含持久化中可公开给 renderer 的字段；不返回 secret、完整 request/response body、raw headers 或绝对路径。

```ts
type TaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'interrupted';

type TaskSummaryDto = {
  projectId: ProjectId;
  taskId: OpaqueId;
  operation: 'generate' | 'modify';
  chapterId: OpaqueId;
  targetBlockCount: number;
  sourceRefCount: number;
  status: TaskStatus;
  cancelRequested: boolean;
  statusReason?: string;
  statusCode?: TaskErrorCode;
  proposalId?: OpaqueId;
  attemptNumber: number;
  createdAt: string;
  updatedAt: string;
};

type TaskDetailDto = TaskSummaryDto & {
  instruction: string;
  targetBlockIds: OpaqueId[];
  sourceRefs: Array<{
    sourceId: OpaqueId;
    chunkId: OpaqueId;
    sourceRevision: string;
    sourceNameSnapshot: string;
    location?: { page?: number; markdownPath?: string };
    availability: 'available' | 'stale' | 'missing' | 'not-searchable';
  }>;
  provider: {
    profileId?: OpaqueId;
    modelLabel?: string;
    configRevision: string;
  };
  attempts: Array<{
    attemptId: OpaqueId;
    ordinal: number;
    status: Exclude<TaskStatus, 'queued' | 'completed'>;
    startedAt: string;
    endedAt?: string;
    retryable?: boolean;
    error?: PublicTaskError;
  }>;
};

type ProposalDetailDto = {
  projectId: ProjectId;
  proposalId: OpaqueId;
  taskId: OpaqueId;
  baseProjectRevision: string;
  readOnly: true;
  summary: {
    changeCount: number;
    evidenceStatus: 'sufficient' | 'insufficient' | 'mixed' | 'unavailable';
    requiresAuthorJudgment: boolean;
  };
  changes: Array<{
    changeId: OpaqueId;
    targetBlockIds: OpaqueId[];
    originalText?: string;
    originalTextHash: string;
    suggestedText: string;
    intent: string;
    targetStatus: 'locatable' | 'stale' | 'unlocatable' | 'conflict';
    evidence: {
      status: 'sufficient' | 'insufficient' | 'unavailable' | 'not-applicable';
      sourceRefs: Array<{ sourceId: OpaqueId; chunkId: OpaqueId; location?: string }>;
      explanation: string;
      fabricatedCitation: false;
    };
    reviewHint: 'none' | 'needs-author-judgment' | 'needs-retry';
  }>;
  createdAt: string;
};
```

`originalText` 是否返回全量文本取决于 context retention 和 UI 需求；至少返回 hash。完整 model raw output 不作为 renderer DTO。

## Task update event（候选）

```ts
type AiWritingTaskUpdatedEvent = {
  projectId: ProjectId;
  task: TaskSummaryDto;
  reason: 'created' | 'status-changed' | 'attempt-failed' | 'proposal-ready' | 'recovered';
  proposalId?: OpaqueId;
};
```

- event 只推送可脱敏的 summary；renderer 需要 detail 时显式调用 `getAiWritingTask`/`getAiWritingProposal`。
- preload 必须验证 listener 输入、记录 unsubscribe，并在 window 销毁时清理；不能直接暴露底层 channel 字符串。
- 是否需要百分比/token streaming progress 暂不决定；若需要，单独增加有上限、无正文写入意义的 DTO，不把 partial suggestion 当 proposal。
- 重连/renderer remount 后以 `list` 或 `get` 的快照为准，不能依赖 event 永不丢失。

## Error DTO 与候选错误码

```ts
type TaskErrorCode =
  | 'IPC_INVALID_INPUT'
  | 'IPC_UNAUTHORIZED_SENDER'
  | 'PROJECT_NOT_OPEN'
  | 'PROJECT_SCHEMA_UNSUPPORTED'
  | 'TASK_TARGET_MISSING'
  | 'TASK_TARGET_STALE'
  | 'TASK_INSTRUCTION_EMPTY'
  | 'TASK_SOURCE_RANGE_INVALID'
  | 'TASK_SOURCE_UNAVAILABLE'
  | 'TASK_ALREADY_TERMINAL'
  | 'TASK_CANCELLED'
  | 'TASK_INTERRUPTED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_SECRET_UNAVAILABLE'
  | 'PROVIDER_UNREACHABLE'
  | 'PROVIDER_AUTH_FAILED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_RESPONSE_INVALID'
  | 'PROPOSAL_TARGET_UNLOCATABLE'
  | 'STORAGE_WRITE_FAILED'
  | 'STORAGE_RECOVERY_REQUIRED';

type PublicTaskError = {
  code: TaskErrorCode;
  message: string;
  retryable: boolean;
  diagnosticId?: string;
  retryAfterMs?: number;
};
```

`message` 必须是脱敏、可理解的摘要；`diagnosticId` 只能关联本地安全日志。provider HTTP status 是否暴露、是否保留 `retryAfterMs`、错误码最终命名和错误对象是否用 `{ok,data}` envelope 均为 `NEEDS DECISION`。

IPC failure semantics：

- invalid input、unauthorized sender、project mismatch 在任务创建前拒绝，不创建半成品 task。
- provider timeout/unreachable/rate limit 等由 task service 写入 failed attempt；是否自动 retry 由已冻结 policy 决定。
- `cancel` 对 queued/running 发出取消请求；对已 canceled 的 task 可幂等返回 summary，对 completed/已产生 proposal 的 task 返回 `TASK_ALREADY_TERMINAL`，具体是否都幂等为 `NEEDS DECISION`。
- `retry` 必须是显式调用；失败/取消/中断才可 retry，completed 不可 retry 覆盖 proposal；任何 retry 先写新 attempt/queued 状态，再开始 provider call。
- storage write/commit 未确认成功时不能向 renderer 返回 completed/proposal-ready；返回 storage error 并保留 recovery 状态。

## Main 端安全校验

每个 handler 和 listener 必须：

1. 检查 `event.sender` 是否是受信任的主窗口、是否来自预期 frame/session。
2. 通过 active project service 将 `projectId` 映射到当前项目，不接受 renderer 的路径。
3. 重新读取/校验 block、source chunk、project schemaVersion 和 revision/hash。
4. 使用白名单字段和大小上限解析 DTO；unknown fields 不能承载执行指令或 secret。
5. 只把非敏感 DTO 返回 renderer；错误和 provider 诊断统一脱敏。
6. 取消、窗口关闭、项目切换和应用退出都要解除 listener/AbortController，且不将未完成任务伪装成成功。

## 冻结前必须回答的问题

- [Decision] channel 前缀、`{ok,data,error}` envelope、错误序列化与版本策略是什么？
- [Decision] `sourceRefs=[]` 是否允许？如果允许，FR-003 和 evidence insufficient 的接受标准如何改写？
- [Decision] task update 是否只发 status，还是需要 progress/partial result？
- [Decision] renderer 重启/项目切换时，哪个 API 负责快照恢复？
- [Decision] cancel/retry 的幂等、并发和应用退出语义是什么？
- [Decision] providerProfile 选择和 configRevision 如何与 005 对接？
