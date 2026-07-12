# 数据模型：AI 写作任务与独立提案

**状态**：设计草案，所有跨 durable boundary 的最终 schema 选择为 `NEEDS DECISION`。  
**来源**：`spec.md` FR-001–FR-010、SC-002/SC-003/SC-004/SC-005；依赖 `004-block-editor`、`005-provider-settings`、`007-source-search-citations`；下游 `009-ai-proposal-review`、`010-version-history`。

## 建模原则

1. 任务记录“作者授权了什么”和“任务经历了什么”；提案记录“模型建议了什么”，二者独立保存。
2. `projectId`、`chapterId`、`blockId`、`sourceId`、`chunkId` 都是 opaque domain ID；不保存 renderer 传来的绝对路径，也不把显示名称当作身份。
3. 所有项目 JSON 至少带 `kind`、`schemaVersion`、`projectId` 和 `updatedAt`；未知 `schemaVersion` 进入迁移/不支持错误，不静默解析。
4. 任务执行基于提交时的 target/source snapshot；正文在任务运行期间可以继续编辑，任务结果必须带 base revision/hash 并在显示时判断 stale。
5. evidence 不等于自动引用。证据不足可以是一个成功任务的结果状态，但不能伪造 citation 或绕过 009 的人工审阅。
6. secret、完整 authorization header、外部 provider 原始凭据、绝对路径、可恢复的请求 token 不进入任何任务/提案 durable JSON、IPC DTO、Git trailer 或诊断消息。

## 实体总览

| 实体 | 身份 | 生命周期/归属 | 主要关系 |
|---|---|---|---|
| `WritingTask` AI 写作任务 | `taskId` | 项目内；提交后保留，即使失败/取消 | 1 个任务有 1..N 个 `TaskAttempt`，0..1 个 `WritingProposal` |
| `TaskContextSnapshot` 任务上下文 | `contextSnapshotId` 或 task 内嵌版本 | 创建任务时冻结；不可被后续正文/资料更新隐式替换 | 关联多个 `TargetBlockSnapshot` 和 `SourceReference` |
| `TargetBlockSnapshot` 目标块快照 | `(chapterId, blockId, targetRevision)` | 引用 004 的 block identity 和版本/hash | 属于一个 context；被 proposal change 引用 |
| `SourceReference` 资料范围引用 | `(sourceId, chunkId, sourceRevision)` | 引用 007 可检索/可引用的完成资料 | 属于一个 context；被 evidence 引用 |
| `TaskAttempt` 执行尝试 | `attemptId` | task 内追加；不可复用序号 | 关联 provider metadata、脱敏错误和结果摘要 |
| `WritingProposal` 修改提案 | `proposalId` | task 成功/可规范化完成后独立保存；由 009 消费 | 包含多个 `ProposalChange` |
| `ProposalChange` 提案变更 | `changeId` | proposal 内稳定身份；由 009 逐项审阅 | 关联一个或多个 target block、evidence 和 base hash |
| `EvidenceAssessment` 证据评估 | `assessmentId` 或 change 内嵌 | 随 proposal 保存；不生成新的 source | 关联 source refs、证据状态和作者判断提示 |

## `WritingTask`

```text
WritingTask {
  kind: "writellm.ai-writing-task"
  schemaVersion: string
  projectId: ProjectId
  taskId: OpaqueId
  operation: "generate" | "modify"
  instruction: string
  chapterId: OpaqueId
  targetBlockIds: OpaqueId[]
  context: TaskContextSnapshot
  provider: ProviderSelectionSnapshot
  lifecycle: TaskLifecycle
  attempts: TaskAttempt[]
  proposalId?: OpaqueId
  failure?: TaskFailure
  createdAt: ISO8601
  updatedAt: ISO8601
}
```

字段语义：

- `instruction` 是作者提交的目标/指令；不把 system prompt、provider 内部 prompt 或 renderer 的 UI 状态混入此字段。
- `operation` 只表达首版的生成/修改意图，不表达“接受并写入正文”。
- `targetBlockIds` 是用户明确选择的块；`context.targetBlocks` 保存提交时的 revision/hash，避免只用当前 block ID 推断上下文。
- `provider` 只保存配置摘要/配置 revision/model label 等非敏感快照。具体字段名随 005 的 provider contract 冻结，不能保存 key。
- `attempts` 为审计和重试使用；重试默认追加 attempt，而不是覆盖上一次错误。是否每次重试都创建新 `taskId` 为 `NEEDS DECISION`。
- `proposalId` 只在独立 proposal 持久化成功后设置；任务完成但 proposal 保存失败时不得显示为“有结果”。

## `TaskContextSnapshot`

```text
TaskContextSnapshot {
  contextVersion: string
  capturedAt: ISO8601
  projectRevision: string
  targetBlocks: TargetBlockSnapshot[]
  sourceRefs: SourceReference[]
  contextHash: string
  payloadRetention: "references-and-hashes" | "exact-selected-content" | "NEEDS_DECISION"
}
```

`contextHash` 必须覆盖有序的 target/source IDs、revision 和用于 provider 输入的内容摘要。它用于证明任务使用的是提交时范围，不是证明模型一定正确使用了证据。

`payloadRetention` 是尚未冻结的持久化选择：

- 最小方案保存 IDs、revisions、location 和 content hash，文件小且减少重复正文。
- 可复现方案保存提交时选定的 block/source 文本快照或受控引用，审计更强但文件体积、隐私和资料删除语义更复杂。
- 无论选择哪一项，都不得把未经审查的完整 provider request/response 和 secret 写入 log 或 Git。

## `TargetBlockSnapshot`

```text
TargetBlockSnapshot {
  chapterId: OpaqueId
  blockId: OpaqueId
  blockRevision: string
  contentHash: string
  blockType: string
  sourceOrder?: number
}
```

`blockType` 和 `sourceOrder` 只用于结果定位/展示；真正身份是 block ID，真正过期判断使用 `blockRevision` 与 `contentHash`。不要在 task 中保存章节文件绝对路径。

## `SourceReference`

```text
SourceReference {
  sourceId: OpaqueId
  chunkId: OpaqueId
  sourceRevision: string
  sourceNameSnapshot: string
  location: {
    page?: number
    markdownPath?: string
    startOffset?: number
    endOffset?: number
  }
  availability: "available" | "stale" | "missing" | "not-searchable"
}
```

- 只有 007 标记为可用且来自 006 已完成处理的 source/chunk 才能成为有效任务上下文。
- `sourceNameSnapshot` 只用于历史显示；source 身份仍由 sourceId/chunkId/revision 决定。
- 资料被删除/替换后，已有 task 仍保留当时范围，但打开结果必须显示 stale/missing；不得把同名的新资料静默重绑。
- 当前 `spec.md` FR-003 的文字要求“有效资料范围”，规划默认解释为至少一条有效 `SourceReference`。如果产品允许无资料任务来表达“证据不足”，必须先更新 spec 和 contract；这是一个 `NEEDS DECISION`，不是数据模型的默默假设。

## `ProviderSelectionSnapshot`

```text
ProviderSelectionSnapshot {
  providerProfileId?: OpaqueId
  endpointLabel?: string
  modelLabel?: string
  configRevision: string
  capabilities?: string[]
}
```

这是 005 配置的非敏感快照。`endpointLabel` 必须经过脱敏/规范化，不能把带 query credential 的 URL 保存；`capabilities` 不应成为 provider-specific durable contract，除非在 provider ADR 中冻结。

## `TaskLifecycle` 与状态机

```text
TaskLifecycle {
  status: "queued" | "running" | "completed" | "failed" | "canceled" | "interrupted"
  cancelRequested: boolean
  statusReason?: string
  statusCode?: TaskErrorCode
  statusAt: ISO8601
}
```

`queued` 对应 spec 的等待，`running` 对应执行中，`completed` 对应已完成；`failed`、`canceled`、`interrupted` 用于 FR-005 之外的失败边界和 edge cases。UI 可以显示“取消中”，但 durable 状态是否增加 `cancelling` 为 `NEEDS DECISION`；在没有冻结前，用 `running + cancelRequested=true` 表示请求已发出。

允许的转换：

```text
queued ───────► running ───────► completed
   │                │                 │
   └────► canceled  ├────► failed     └── terminal in this feature
                    ├────► canceled
                    └────► interrupted

failed / canceled / interrupted ──(explicit retry)──► queued (new attempt)
```

- `completed` 不因 009 审阅而改变；review 状态属于下游 proposal domain。
- retry 必须显式操作、检查 task 尚未被删除/损坏、重新读取 provider 配置和当前 source availability，并记录新 attempt。
- 不允许 `failed -> completed` 的无记录跳转、不允许重复 cancel 伪装成成功、不允许一个 task 同时拥有两个 running attempt。
- 应用退出/崩溃时，`running` 不能直接显示为 completed；启动恢复时根据 pending/attempt heartbeat 选择 `interrupted` 或可重试的 `queued`，规则需在 ADR 中冻结。

## `TaskAttempt` 与错误

```text
TaskAttempt {
  attemptId: OpaqueId
  ordinal: number
  status: "running" | "completed" | "failed" | "canceled" | "interrupted"
  startedAt: ISO8601
  endedAt?: ISO8601
  providerRequestId?: string
  modelLabel?: string
  usage?: { inputTokens?: number; outputTokens?: number }
  error?: TaskFailure
  resultHash?: string
}

TaskFailure {
  code: TaskErrorCode
  userMessage: string
  retryable: boolean
  providerStatus?: number
  retryAfterMs?: number
  diagnosticId?: string
}
```

`providerRequestId` 只有在 provider 返回且不含 secret 时才保存；完整 response body、request headers、key、authorization 和 prompt debug dump 不保存。`userMessage` 必须可理解，`diagnosticId` 只指向本地脱敏日志。

建议的错误码集合（**候选契约，冻结前均为 NEEDS DECISION**）：

```text
IPC_INVALID_INPUT
IPC_UNAUTHORIZED_SENDER
PROJECT_NOT_OPEN
PROJECT_SCHEMA_UNSUPPORTED
TASK_TARGET_MISSING
TASK_TARGET_STALE
TASK_INSTRUCTION_EMPTY
TASK_SOURCE_RANGE_INVALID
TASK_SOURCE_UNAVAILABLE
TASK_ALREADY_TERMINAL
TASK_CANCELLED
TASK_INTERRUPTED
PROVIDER_NOT_CONFIGURED
PROVIDER_SECRET_UNAVAILABLE
PROVIDER_UNREACHABLE
PROVIDER_AUTH_FAILED
PROVIDER_RATE_LIMITED
PROVIDER_TIMEOUT
PROVIDER_RESPONSE_INVALID
PROPOSAL_TARGET_UNLOCATABLE
STORAGE_WRITE_FAILED
STORAGE_RECOVERY_REQUIRED
```

实现前要冻结错误码命名、是否向 renderer 暴露 provider HTTP status、retryable 规则和用户文案。错误码不能用异常 message 的 substring 作为跨边界协议。

## `WritingProposal`

```text
WritingProposal {
  kind: "writellm.ai-writing-proposal"
  schemaVersion: string
  projectId: ProjectId
  proposalId: OpaqueId
  taskId: OpaqueId
  createdAt: ISO8601
  baseProjectRevision: string
  changes: ProposalChange[]
  summary: {
    changeCount: number
    evidenceStatus: "sufficient" | "insufficient" | "mixed" | "unavailable"
    requiresAuthorJudgment: boolean
  }
  readOnly: true
}
```

proposal 只读是本 feature 的边界，不是 UI 上一个可绕过的 flag；main 的 contract 不提供 `applyProposal`。

## `ProposalChange` 与证据

```text
ProposalChange {
  changeId: OpaqueId
  targetBlockIds: OpaqueId[]
  baseTargetSnapshots: TargetBlockSnapshot[]
  originalText?: string
  originalTextHash: string
  suggestedText: string
  intent: string
  evidence: EvidenceAssessment
  targetStatus: "locatable" | "stale" | "unlocatable" | "conflict"
  reviewHint: "none" | "needs-author-judgment" | "needs-retry"
}

EvidenceAssessment {
  status: "sufficient" | "insufficient" | "unavailable" | "not-applicable"
  sourceRefs: SourceReference[]
  explanation: string
  fabricatedCitation: false
}
```

- `originalText` 是否全量保存与 `payloadRetention` 一致；至少必须有 `originalTextHash`，以支持过期保护。
- `suggestedText` 是独立提案文本；它不能被写入 `content/`，也不能替换 `004` 的 block record。
- provider 没有依据时使用 `insufficient`，`sourceRefs=[]`，`fabricatedCitation=false`，并将 `requiresAuthorJudgment=true`。
- provider 返回指向不存在 block 的 change 时，整个任务可标为 `PROVIDER_RESPONSE_INVALID`，或保留 proposal 但将该 change 标记 `unlocatable`；最终策略必须冻结，不能自动应用。

## 持久化布局与写入规则

遵循 ADR-001 的项目根目录约束，建议的 canonical 布局为：

```text
<project>.writellm/
├── project.json
├── content/                       # 004 canonical BlockNote JSON wrapper；Markdown 仅为 interop projection
├── sources/                       # 006/007 source artifacts and refs
├── ai/
│   ├── tasks/<taskId>.json        # WritingTask + attempts + context refs
│   └── proposals/<proposalId>.json# WritingProposal, independent of content
└── runtime/
    └── pending/<transactionId>.json
```

- `ai/tasks` 与 `ai/proposals` 是否额外维护 index/cache，`NEEDS DECISION`；cache 不能成为项目真相。
- task/proposal JSON 用同目录 temp + rename；跨文件更新写 pending transaction，Git task event commit 成功后清理 pending。
- 失败/取消 task 可以产生 `WriteLLM-Event: task` 事件 commit，但 `WriteLLM-Content-Change` 必须为 false，不能增加正文 revision。
- provider secret 属于 app-level 005 配置，不在 `.writellm/ai`，也不随项目移动。
- schema migration 必须先识别 `kind/projectId/schemaVersion`；未知版本返回 `PROJECT_SCHEMA_UNSUPPORTED` 或 `STORAGE_RECOVERY_REQUIRED`，不尝试猜测。

## 关系与其他 feature 的边界

| 关系 | 本 feature 可以读取/创建 | 本 feature 不可以做 |
|---|---|---|
| 004 block editor | 读取已打开项目的 block、revision/hash、稳定 ID | 写 block、移动 block、合并正文、改变 content revision |
| 005 provider settings | 读取非敏感 provider profile/config revision；通过 main-owned capability 短暂取得 secret | 保存/展示 key、把 key 放入 task、替换 provider 设置 |
| 006 processing | 读取资料可用状态和 source revision | 导入/解析 PDF、改变 chunk 或 embedding |
| 007 search/citations | 接收作者明确选择的 source/chunk refs 和位置快照 | 自行扩大资料范围、创建引用、自动补 citation |
| 009 proposal review | 产出稳定 proposal/change/evidence DTO | 接受/拒绝/应用 proposal 或写回正文 |
| 010 version history | 提供 task/proposal IDs 与 actor/event metadata | 将未接受 suggestion 当作正文历史，或自行做 restore |

## 校验清单（模型层面的要求）

- `projectId` 必须与 main 当前打开项目一致；任务不能跨项目读取 block/source。
- `targetBlockIds` 非空、去重、属于同一选定 chapter，且每个 block 仍可读取；删除/重复/缺少稳定 ID 时拒绝提交。
- `instruction.trim()` 必须非空；最大长度、控制字符和是否允许 markdown/system-like 指令需冻结为 `NEEDS DECISION`。
- `sourceRefs` 必须来自作者明确选择、可用且带 location/revision 的 007 DTO；是否允许空数组必须先解决 FR-003 与“证据不足”场景的张力。
- provider profile/config revision 必须存在、完整且不含 secret；endpoint/model label 在 main 中重新校验。
- 所有 renderer-originated DTO 使用 plain structured-clone data；拒绝 function、Promise、Symbol、绝对路径、未知 command 或超出大小上限的嵌套对象。
- task transition 必须由 main 的状态机产生；renderer 不能直接提交新 status。
- provider result 经过大小限制、schema 校验、target mapping、evidence mapping 和错误脱敏后才能持久化。
- `suggestedText`、原文快照、source excerpt 的最大长度/总大小和 prompt/context retention 仍是 `NEEDS DECISION`。
- 任何 storage write/commit 失败都不得将 durable 状态或 UI DTO 报告为成功；需保留 pending/recovery 信息。
