# 008 → 009 Task/Proposal Boundary（草案）

**状态**：依赖输入边界草案；008 的 producer DTO、完成态名称、持久化 owner 和具体 transport 为 NEEDS DECISION。009 不调用 external provider/worker。

## Producer responsibility (008)

008-ai-writing-tasks 在任务完成后提供一个独立的 proposal envelope，至少包含：

~~~ts
type CompletedTaskProposal = {
  kind: 'ai.proposal';
  schemaVersion: number;
  projectId: string;
  proposalId: string;
  taskId: string;
  baseProjectRevision: number | string;
  targetSnapshot: Array<{
    chapterId: string;
    blockId: string;
    blockFingerprint: string;
    blockType: string;
  }>;
  changes: Array<{
    changeId: string;
    operation: 'replace' | 'insert' | 'delete';
    target: unknown;
    original: unknown;
    suggested: unknown;
    intent: string;
    evidence: unknown[];
  }>;
};
~~~

字段最终以 data-model.md 和 008 的 accepted contract 为准。009 main 不信任 target/evidence 的 unknown shape，必须重新校验并向 004/007 owners 查询当前状态。

## Consumer responsibility (009)

- 读取已完成 proposal 并展示 diff/review controls；
- 对 change 进行 accepted/rejected/deferred decision；
- 在当前正文上重新做 revision/fingerprint/source validity preflight；
- 只应用 accepted change，并把成功的 model content event 交给 010；
- 不改变 task execution status，不重试 provider，不重新生成 suggestion。

## Invalid producer results

以下情况不能进入可应用 review：缺 project/task/proposal identity、schemaVersion 不支持、无 target、target fingerprint 缺失、suggested/operation 不匹配、evidence 缺 source/location、proposal 与 project 不匹配、task 未到允许 review 的完成态。main 返回 PROPOSAL_SCHEMA_INVALID 或更具体的 stable error code，并保留正文不变。

## External provider/worker boundary

009 不传递 provider name、endpoint、model credential、prompt、raw response 或 worker handle。009 接收的是已经脱离 provider 的 proposal DTO；provider SDK/HTTP protocol、离线 fallback、取消和重试由 005/008 负责。

如果未来 008 通过 worker stream 或 event 将 proposal 送入 009，仍需在 IPC/main boundary 转换成上述 versioned envelope；不得让 provider/worker 直接写 project content，也不得让 renderer 直接订阅任意 external channel。

## Dependency naming

`specs/008-ai-writing-tasks/spec.md` 的 Out of Scope/Assumptions 已统一使用
`009-ai-proposal-review`；本契约与 008 共享该依赖命名。
