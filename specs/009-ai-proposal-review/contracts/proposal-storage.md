# Proposal Review Storage Contract（草案）

**状态**：逻辑 owner 和事务顺序已为规划需要定义；实际文件命名、JSON/JSONL、Git adapter、validator、atomic write helper/SQLite 选择和 ADR 状态为 NEEDS DECISION。

## Storage ownership

- project storage/main 是唯一读写 authority；renderer/preload 不接触 .writellm 路径。
- 009 只拥有 proposal review state、apply metadata 和 recovery intent；canonical chapter/Block 属于 004/001 storage owner，source/citation 属于 007，history timeline 属于 010。
- 逻辑 proposal 位置候选为 ai/proposals/<proposalId>.json，逻辑 pending 位置候选为 runtime/pending/<transactionId>.json；实际路径必须由 ADR-001 接受后的 storage contract 冻结。

## Envelope

每个持久化 JSON envelope 至少包含：

~~~ts
type StorageEnvelope<T> = {
  kind: string;
  schemaVersion: number;
  projectId: string;
  revision: number | string;
  updatedAt: string;
  data: T;
};
~~~

未知 kind 或 schema version 必须返回可理解的 unsupported/migration error；不允许把未知字段丢掉后覆盖原文件。未知字段是否保留、schemaVersion 是整数还是 semver、migration registry 和 backup policy 为 NEEDS DECISION。

## Proposal review write classes

### Review-only write

拒绝/暂缓/接受 decision 的持久化只更新 proposal review state 或 review record，不改变 canonical content。main 必须：

1. 读取当前 proposal；
2. 校验 change IDs、旧 proposal revision 和状态转换；
3. 生成同目录 temp；
4. 完整写入、必要时 flush、rename；
5. 返回新 proposal revision。

是否把 accepted decision 和 proposal payload 写同一文件，或单独写 review log，属于 schema decision；两者都不能绕过 pending/recovery policy。

### Content apply write

一个 ApplyBatch 逻辑上更新：

1. selected canonical chapter/content 文件；
2. proposal change states (applied 或明确 blocked/pending result)；
3. content/project revision metadata；
4. 010 所需的 model/task/proposal/source association；
5. project-local history/Git metadata（若 ADR 继续采用该方向）。

它们必须由 project storage owner 作为一个可恢复事务协调。单文件 atomic rename 不足以证明跨文件成功。

## Pending transaction phases

~~~text
prepared
  -> files_replaced
  -> history_committed
  -> cleanup_pending
  -> completed (pending record removed)

任何阶段失败
  -> retryable（before/after hashes 可判定）
  -> ambiguous（无法判定）
  -> STORAGE_RECOVERY_REQUIRED
~~~

pending record 至少记录 project/proposal/change IDs、expected/next revision、logical file refs、before/after hashes、phase、attempts、last safe error code 和 created/updated timestamps。不得记录 renderer path、provider secret、完整 command argv 或 raw error stack。

恢复规则：

- 启动/open project 时 main 检查 pending record 与当前文件 hashes/revision；
- 只在 before/after 状态可判定时自动 retry 或 cleanup；
- 若文件混合了未知状态，保留当前可读正文并返回 STORAGE_RECOVERY_REQUIRED；
- recovery 成功前，不能向 renderer 报告 applied，也不能把 pending change 标成 applied；
- recovery 操作必须幂等，且尝试次数/用户可见诊断受限。

## History handoff

成功 apply 后向 010 提供逻辑事件，而不是在 009 内创建第二份时间线：

~~~ts
type ProposalAppliedEvent = {
  projectId: string;
  contentRevision: number | string;
  actor: 'model';
  event: 'content';
  taskId: string;
  proposalId: string;
  appliedChangeIds: string[];
  affectedChapterIds: string[];
  affectedBlockIds: string[];
  sourceRefs: string[];
};
~~~

只有 content transaction 和 history handoff 都成功，ProposalAppliedEvent 才能被当作已保存事件。事件字段、Git trailer 名称、是否同步 commit、失败后的 cleanup/retry owner 为 NEEDS DECISION。

## Candidate implementation adapters

storage contract 不绑定实现。候选记录见 research.md：

- Node fs/promises + temp/rename + pending journal；
- write-file-atomic/atomically + 009 coordinator；
- SQLite transaction + 文件/Git adapter。

最终实现必须通过同一个 contract test suite 验证：单文件失败、跨文件失败、crash after replace、history handoff failure、restart recovery、unknown schema 和外部编辑。

