# AI 提案审阅数据模型

本模型只定义 009 的逻辑实体、关系和不变量，不规定最终 validator、数据库、文件序列化库或 provider SDK。具体 JSON 文件名和 envelope 见 [contracts/proposal-storage.md](./contracts/proposal-storage.md)，且必须服从 `001-project-foundation` 与 `docs/adr/001-project-storage.md` 的最终决定。

## Model principles

- `Proposal` 是 008 生成的独立建议集合，不是正文的替代品。
- `ProposalChange` 是最小审阅/应用单元；正文只接受明确列出的 change IDs。
- `Block`、`Citation`、`Task`、`ProjectRevision` 的真相分别属于 004、007、008、001/010；009 只保存引用和 precondition，不复制完整 owner entity。
- 所有跨边界/持久化日期使用 ISO 8601 UTC 字符串；ID 使用不透明字符串，renderer 不自行解释路径或 filesystem identity。
- 所有可变持久化实体带 `kind`、`schemaVersion`、`projectId`；未知 schemaVersion 不得静默降级。

## Entities

### 1. Proposal（修改提案）

| 字段 | 类型/约束 | 说明 |
|---|---|---|
| `kind` | 固定字面量 `ai.proposal` | 持久化 envelope discriminator；最终命名 **NEEDS DECISION** |
| `schemaVersion` | 正整数 | 与 project schema policy 对齐；迁移策略 **NEEDS DECISION** |
| `proposalId` | 非空、不透明、项目内唯一 | proposal identity；不能由文件路径推导 |
| `projectId` | 非空、不透明 | 关联 001 project；main 必须与打开的 project 一致 |
| `taskId` | 非空、不透明 | 关联 008 的已完成 task；009 不重跑 task |
| `createdAt` | UTC timestamp | 生成时间 |
| `baseProjectRevision` | 非负整数或明确 opaque revision | 生成时 project content revision |
| `baseSnapshotHash` | hash string | target Block/canonical snapshot 的摘要；算法 **NEEDS DECISION** |
| `targetSummary` | 非空数组 | 允许 UI 展示的章节/Block 摘要，不含绝对路径 |
| `changes` | `ProposalChange[]`，至少 1 项 | 提案变更集合 |
| `sourceSummary` | `EvidenceSummary` | 资料依据数量、证据不足数量、source snapshot revision |
| `reviewStatus` | 派生状态 | 见 Proposal lifecycle；不得仅由 renderer 改写 |
| `updatedAt` | UTC timestamp | 最近一次 proposal/review 记录变化 |

### 2. ProposalChange（提案变更）

| 字段 | 类型/约束 | 说明 |
|---|---|---|
| `changeId` | proposal 内唯一、不透明 | 单项 accept/reject/defer/apply 的 key |
| `operation` | `replace | insert | delete` | v1 最小操作集合；`move/split/merge` 需额外决定，不可暗加 |
| `target` | `TargetRef` | 一个章节中的一个或多个稳定 Block；insert 可带 anchor |
| `original` | `TextSnapshot` | proposal 生成时看到的文本/Block fingerprint |
| `suggested` | `TextSnapshot` 或 null | delete 可为 null；必须限制最大长度，数值 **NEEDS DECISION** |
| `intent` | 非空短文本 + 可选结构化标签 | AI 任务对该变更的意图；展示为不可信文本 |
| `evidence` | `EvidenceRef[]` | 引用 007 的 source/citation identity、位置和 snapshot hash |
| `evidenceQuality` | `supported | insufficient | invalid | unavailable` | 不能把证据不足当作已验证事实 |
| `reviewState` | `pending | accepted | rejected | deferred | applied | blocked` | 审阅状态，见状态机 |
| `blockedReason` | 可选 `stale | overlap | target_missing | source_invalid | recovery_required` | `blocked` 必须有 reason 和可理解 message key |
| `reviewedAt` | 可选 UTC timestamp | 作者明确处理时间 |
| `appliedAt` | 可选 UTC timestamp | 正文成功保存时间；只有 apply commit 成功才写入 |

`accepted` 表示作者做出的 durable decision；它不等于正文已经写入。`applied` 只能在 canonical content、proposal state 和 history handoff 作为同一保存事务成功后出现。

### 3. TargetRef（正文目标）

| 字段 | 类型/约束 | 说明 |
|---|---|---|
| `chapterId` | 非空、不透明 | 由 004 owner 定义 |
| `blockIds` | 非空、去重数组 | stable Block identity；顺序是 proposal 生成时的顺序 |
| `anchor` | 可选 `{ beforeBlockId?, afterBlockId? }` | 只供 insert/重定位校验；不能让 renderer 传任意路径 |
| `baseBlockFingerprints` | `blockId -> fingerprint` map | 每个目标 Block 的生成时摘要 |
| `baseOrderFingerprint` | 可选 fingerprint | 检测 block 顺序变化 |

校验规则：`beforeBlockId` 与 `afterBlockId` 至少一个存在且不能相同；anchor 必须属于同一 chapter 的当前/基线 Block 集合；`blockIds` 不能包含未知或重复 ID。实际 Block 类型、identity comment codec 和 revision 字段由 004/001 owner 冻结。

### 4. TextSnapshot（文本快照）

| 字段 | 类型/约束 | 说明 |
|---|---|---|
| `text` | UTF-8 string 或 null | 原文/建议；不能包含未授权的 filesystem/path metadata |
| `textFingerprint` | 非空 fingerprint | main 重新读取当前 Block 时比较 |
| `blockType` | 非空枚举或 opaque string | 例如 paragraph/heading；最终枚举属于 004 |
| `normalizedLineEnding` | `lf | crlf | unknown` | 用于显示/规范化比较，不能偷偷改变正文 |
| `length` | 非负整数 | main 校验与规模阈值使用；不能只相信客户端传值 |

### 5. EvidenceRef（资料依据引用）

| 字段 | 类型/约束 | 说明 |
|---|---|---|
| `citationId` | 可选、不透明 | 007 citation identity；存在时 main 向 007 owner 校验 |
| `sourceId` | 非空、不透明 | 资料 identity |
| `sourceRevision` | 非负整数或 opaque revision | 生成/审阅时的 source revision |
| `location` | 结构化位置 | Markdown offset/page/section 等；不接受任意路径 |
| `excerpt` | 可选短文本 | UI context，受长度限制；不是 source truth |
| `validity` | `valid | stale | missing | unverified` | 当前 source/citation 状态 |
| `snapshotHash` | 可选 fingerprint | 检测资料替换/失效 |

`validity != valid` 时可以展示，但在 apply 前必须根据 009 spec 的规则阻止静默当作完整依据；最终是 block 还是仅 warning 需在 checklist 中决定。

### 6. ReviewDecision（审阅决定）

这是 IPC command 的逻辑 DTO，可不作为独立文件保存。

```text
{
  proposalId,
  changeId,
  decision: accepted | rejected | deferred,
  clientObservedProposalRevision,
  clientObservedContentRevision
}
```

main 只接受当前打开 project/proposal 中存在的 `changeId`；`clientObserved*` 只作乐观并发提示，真相必须重新读取。拒绝/暂缓不改变正文，但仍需原子保存 review state。

### 7. ApplyBatch（应用批次）

| 字段 | 类型/约束 | 说明 |
|---|---|---|
| `transactionId` | main 生成、项目内唯一 | pending/recovery key；renderer 不自定义持久化路径 |
| `proposalId` | 非空 | 单 proposal v1；跨 proposal batch **NEEDS DECISION** |
| `changeIds` | 非空、去重数组 | 只允许当前 `accepted` change |
| `expectedContentRevision` | 必填 | 防止旧 UI 覆盖新正文 |
| `preflightToken` | 可选不透明 token | 若需要“重新确认”机制，其绑定 revision/TTL **NEEDS DECISION** |
| `preflight` | `ApplyPreflight` | main 计算的安全性结果，不相信 renderer 重传的结果 |
| `result` | `ApplyResult` | 成功/失败都需可解释列出 applied/pending/blocked |

### 8. ApplyPreflight / ApplyResult

`ApplyPreflight` 至少包含：

- current project/content revision；
- per-change `safe | stale | conflict | target_missing | source_invalid`；
- overlap groups；
- affected chapter/block IDs；
- proposed next content fingerprint；
- 可显示 warning/error keys。

`ApplyResult` 至少包含：

- `status`: `applied | rejected | blocked | recovery_required`；
- `appliedChangeIds`；
- `pendingChangeIds`；
- `blockedChangeIds` 与 reason；
- `newContentRevision`（仅 `applied` 时存在）；
- `historyEventRef`（仅成功 history handoff 后存在）；
- `recoveryTransactionId`（需要恢复时存在）；
- 不包含绝对路径、secret、原始 Git command 或任意内部 stack trace。

### 9. PendingTransaction（恢复记录）

| 字段 | 类型/约束 | 说明 |
|---|---|---|
| `kind` | 固定 transaction discriminator | 最终命名 **NEEDS DECISION** |
| `transactionId` | 非空 | 由 main 生成 |
| `projectId` | 非空 | 与当前 project 绑定 |
| `proposalId`/`changeIds` | 非空 | 记录来源 |
| `expectedRevision`/`nextRevision` | 必填 | recovery 前提 |
| `files` | 受限 logical file refs + before/after hashes | 不把任意 renderer path 作为输入 |
| `phase` | `prepared | files_replaced | history_committed | cleanup_pending | ambiguous` | 每阶段必须幂等或可判定 |
| `createdAt`/`updatedAt` | UTC timestamp | recovery diagnostics |
| `attempts` | 非负整数 | 防止无限静默重试 |
| `lastErrorCode` | 可选 stable code | 不保存 secret/stack trace |

## Relationships

```text
Project (001)
  ├── contentRevision ──> Canonical Block/Chapter (004)
  ├── Proposal (009 review of 008 output)
  │     ├── belongsTo Task (008)
  │     ├── contains ProposalChange[*]
  │     │     ├── targets Chapter/Block (004)
  │     │     └── cites EvidenceRef[*] -> Source/Citation (007)
  │     └── ApplyBatch -> PendingTransaction
  └── successful ApplyBatch -> ProposalAppliedEvent -> Version History (010)
```

关系边界：

- 009 不拥有 Task 的执行状态、prompt、provider、secret 或 raw response；只保存 `taskId` 和完成 proposal 的关联。
- 009 不拥有 Source/Citation 内容；只保存引用 identity、位置和 snapshot/validity。
- 009 不拥有 History timeline UI；成功 apply 后提供事件所需关联，由 010 记录模型来源。
- 009 不改变未选中的 chapter/block；目标之外的内容 fingerprint 必须在 integration fixture 中可比较。

## State machines

### ProposalChange review state

```text
pending ──accepted──> accepted ──successful atomic apply──> applied
   │                    │
   ├─rejected──────────> rejected
   ├─deferred──────────> deferred
   └─analysis failure──> blocked

accepted ──current revision/target/source changes──> blocked
blocked ──new snapshot/review decision──> pending
```

约束：

1. `rejected`、`deferred`、`applied` 是 durable result；不接受 renderer 直接把 `blocked` 改成 applied。
2. `accepted` 不能绕过 preflight；应用前仍需比较当前 revision/fingerprint。
3. `blocked` 必须显示具体 reason；不能以“稍后重试”隐藏 stale/conflict/source invalid。
4. 批次内任何 selected change 失败时，本批次 `appliedChangeIds` 为空；所有 selected change 保持 `accepted` 或转为有 reason 的 `blocked`，由 contract 明确返回。

### Proposal review status（派生）

建议由 main 从 change states 派生，而不是让客户端提交：

- `pending_review`：至少一个 pending，且没有任何 durable decision；
- `in_progress`：存在 accepted/deferred/rejected 但仍有 pending；
- `partially_applied`：至少一个 applied 且仍有 pending/accepted/blocked；
- `applied`：所有可应用 change 都 applied，且没有 pending/accepted；
- `needs_attention`：存在 blocked 或 recovery_required；
- `closed`：维护者接受后如需关闭的策略，**NEEDS DECISION**。

## Validation and invariants

### Identity and ownership

- `projectId`、`proposalId`、`taskId`、`changeId`、`chapterId`、`blockId` 非空且长度/字符集由 owner contract 冻结。
- 每个 ID 必须在 main 从当前 project/proposal/source store 重新查到；renderer 传来的对象不能创造新 owner entity。
- proposal 的 task 必须属于同一 project，且 task 状态为 008 允许进入 review 的完成态；“完成态”名称 **NEEDS DECISION**。

### Text and operation

- `replace` 必须有 target、original、suggested；`delete` 必须有 original；`insert` 必须有合法 anchor 或明确的 target block。
- original fingerprint 必须匹配 proposal 生成快照；建议文本不能超出已冻结的长度/总 payload 限制。
- 任何 change 的 target blocks 在 proposal 内重复、相交或 anchor 互相矛盾时，先标记 conflict，不自动排序合并。
- Markdown identity comments 被删除、复制、重复时，target 必须变成 `blocked/target_missing` 或 `conflict`，不能静默绑定相邻 Block。

### Evidence and source validity

- `sourceId`、location、citationId（若有）必须满足 007 的可引用条件；缺文本/位置/检索表示的证据不能变成 `valid`。
- source revision/hash 变化时，main 重新查询 validity；review DTO 可以显示 stale，但 apply 的允许条件必须由决策清单冻结。
- excerpt 只作显示快照，不能代替 source truth，也不能包含完整敏感文件路径。

### Save/recovery

- 正文 revision 只在 canonical content 和关联 proposal/history metadata 成功提交后递增。
- 异常、取消、冲突、磁盘写入失败、history handoff 失败均不能返回成功正文状态。
- pending transaction 的 before/after hashes、phase 和 attempts 足以决定 retry、cleanup 或 `STORAGE_RECOVERY_REQUIRED`；若不能决定，不覆盖当前文件。
- migration 不能把未知 schema 直接当作当前 schema 写回；迁移版本、备份和 rollback 规则 **NEEDS DECISION**。

