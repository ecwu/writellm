# Proposal Review IPC Contract（草案）

**状态**：接口形状待接受；channel 命名、validator、confirmation token 和具体版本为 NEEDS DECISION。
**边界**：renderer ↔ preload ↔ main；实现必须遵守 AGENTS.md、constitution 的 least privilege 和 named typed IPC。

## Contract rules

- preload 只暴露本文件列出的 named methods；不暴露 ipcRenderer、generic invoke/send/on、文件 API、Git API 或 provider API。
- renderer request 只携带项目/提案/change identity、用户 decision、revision 和有限 token；不携带绝对路径、任意 patch、filesystem handle、secret 或 stack trace。
- main 每次重新验证 sender/frame、当前打开 project、projectId/proposalId/changeId、schemaVersion、状态转换、revision、target/source ownership 和输入大小。
- renderer 看到的是脱敏/结构化 DTO。绝对路径只留在 main/userData，proposal 内容按不可信文本处理，不把原始 HTML 当作可执行 markup。
- IPC response 必须是可序列化 plain data；不能依赖跨 bridge 的自定义 Error class。具体 channel prefix 参考现有 writellm:runtime-info，最终命名 NEEDS DECISION。

## Methods

### getProposalReview

~~~ts
type GetProposalReviewRequest = {
  projectId: string;
  proposalId: string;
};

type GetProposalReviewResponse =
  | { ok: true; snapshot: ProposalReviewSnapshot }
  | { ok: false; error: ProposalReviewError };
~~~

用途：读取当前 proposal、change review state、diff segments、target summary、source validity 和当前 content revision。读取必须由 main 从 project storage/source owner 重新加载，不能返回 renderer 传入的原始对象作为真相。

### decideProposalChanges

~~~ts
type DecideProposalChangesRequest = {
  projectId: string;
  proposalId: string;
  decisions: Array<{
    changeId: string;
    decision: 'accepted' | 'rejected' | 'deferred';
  }>;
  clientObservedProposalRevision: number | string;
  clientObservedContentRevision: number | string;
};

type DecideProposalChangesResponse =
  | { ok: true; snapshot: ProposalReviewSnapshot }
  | { ok: false; error: ProposalReviewError };
~~~

用途：持久化作者对单项或一组 change 的审阅决定。accepted 只表示作者决定，正文尚未改变；后续 apply 仍必须通过 preflight。拒绝/暂缓只改变 proposal review state，不增加正文 content revision。

### previewProposalApply

~~~ts
type PreviewProposalApplyRequest = {
  projectId: string;
  proposalId: string;
  changeIds: string[];
  expectedContentRevision: number | string;
};

type PreviewProposalApplyResponse =
  | { ok: true; preview: ApplyPreflight }
  | { ok: false; error: ProposalReviewError };
~~~

用途：main 在当前 project state 上重新计算 safe/stale/conflict/target/source 结果。preview 不是写入授权；除非未来决策冻结 one-time token，否则不能把 preview 的结果直接重传当作 apply 的可信依据。

### applyAcceptedProposalChanges

~~~ts
type ApplyAcceptedProposalChangesRequest = {
  projectId: string;
  proposalId: string;
  changeIds: string[];
  expectedContentRevision: number | string;
  preflightToken?: string;
};

type ApplyAcceptedProposalChangesResponse =
  | { ok: true; result: ApplyResult }
  | { ok: false; error: ProposalReviewError; result?: ApplyResult };
~~~

main 必须重新读取并校验：所有 changeIds 当前均为 accepted、仍属于 proposal、target/source/fingerprint/revision 仍满足条件。批次内任一 change 失败时，不提交该批次任何正文变更；response 显式列出 applied/pending/blocked。成功时只改变 selected change 涉及的 Block，并保留 task/proposal/source reference。

### getProposalRecoveryStatus（是否暴露待决定）

~~~ts
type GetProposalRecoveryStatusRequest = { projectId: string };

type GetProposalRecoveryStatusResponse =
  | { ok: true; status: 'none' | 'recoverable' | 'ambiguous'; transactionId?: string }
  | { ok: false; error: ProposalReviewError };
~~~

应用启动/open 时 recovery 更适合由 main 自动检测；是否需要 renderer 显式读取此方法、是否允许用户选择 retry/cleanup、方法名称和权限为 NEEDS DECISION。renderer 不得提交任意 transactionId 或 recovery action。

## DTO minimum shapes

ProposalReviewSnapshot 复用 data-model.md 中的 Proposal、ProposalChange、EvidenceRef、ApplyPreflight；额外只允许：

- currentContentRevision；
- proposalRevision；
- changes[] 的可渲染 diff segments 和 state labels；
- warnings[]/errors[] 的 stable code + safe message key；
- canDecide、canApply 等由 main 根据当前状态派生的 booleans。

ApplyResult 至少带：status、appliedChangeIds、pendingChangeIds、blockedChangeIds、可选 newContentRevision、可选 historyEventRef、可选 recoveryTransactionId。禁止返回项目绝对路径、密钥、完整 Git argv、provider response 或内部 stack trace。

## Stable error codes

| Code | 触发条件 | renderer 可采取的语义 |
|---|---|---|
| PROJECT_NOT_OPEN | 当前 session 没有该 project | 要求回到项目入口 |
| PROJECT_ID_MISMATCH | request 与打开 project 不符 | 丢弃请求并刷新 |
| PROPOSAL_NOT_FOUND | proposal 不存在或不属于 project | 显示无法审阅 |
| PROPOSAL_SCHEMA_INVALID | envelope/schemaVersion/required fields 无效 | 显示需重新生成/迁移 |
| INVALID_DECISION | 非法状态转换或 change ID 重复 | 保留当前 snapshot |
| STALE_PROPOSAL | project/block revision 或 fingerprint 已变化 | 显示过期，要求重新确认/生成 |
| CONFLICTING_CHANGES | selected changes overlap/duplicate/anchor 冲突 | 转人工判断，不自动合并 |
| TARGET_NOT_FOUND | Block/chapter 已删或 identity 无法定位 | 转人工判断 |
| SOURCE_INVALID | citation/source stale/missing/unverified | 显示证据风险，按最终策略阻止或需确认 |
| CONTENT_REVISION_MISMATCH | client expected revision 不是当前 revision | 刷新并重新 preview |
| VALIDATION_FAILED | 输入长度、类型、字符或数量超限 | 显示字段级安全提示 |
| STORAGE_WRITE_FAILED | 临时写入/rename/fsync 失败 | 不报告保存成功，提供 retry |
| HISTORY_HANDOFF_FAILED | 正文已写但 history commit/handoff 不可判定 | 进入 recovery，不静默继续 |
| STORAGE_RECOVERY_REQUIRED | pending transaction 状态 ambiguous | 显示恢复入口，禁止覆盖当前内容 |
| IPC_SENDER_REJECTED | 未授权 frame/window 发起调用 | 记录安全诊断，renderer 只收到安全错误 |
| INTERNAL_UNAVAILABLE | 未分类故障 | safe message；日志只在 main 侧保留脱敏诊断 |

error code 命名、是否向 renderer 暴露所有 code、重试/刷新映射和 versioning 为 NEEDS DECISION；上表是第一版候选集合，不是已冻结 API。

## Security acceptance notes

- preload 方法必须逐一调用固定 channel；不得根据 renderer 传入的 channel 字符串转发。
- main handler 必须校验 event.senderFrame/对应 window；不能只校验 projectId。
- 所有 path resolution、Git command、pending journal、hash 计算和 history commit 留在 main/storage owner。
- proposal 的 intent/suggested text/evidence excerpt 作为 untrusted content 展示；不拼接为 HTML/JS。
- 错误消息不回显 request 的 secret-like 内容、完整路径或 provider raw response。
