# 写作方向 Storage Contract（草案）

**状态**: `NEEDS DECISION`

**边界**: main 进程的 writing-orientation repository 只依赖 001/ADR-001 提供的 project session/storage/history 能力；renderer、preload 和 003 UI 不拥有文件路径或 Git authority。

## 逻辑文件与 ownership

| 逻辑资源 | 当前候选 | 真相来源/owner | 备注 |
|---|---|---|---|
| 写作方向 canonical document | `content/writing-orientation.json` | 003 domain + 001 storage adapter | 路径和是否拆分 motivation/outline `NEEDS DECISION` |
| project identity | `project.json` | 001 | 003 只消费 `projectId`、schema/revision 摘要 |
| 最近编辑位置 | `ui-state.json` 中的 002 contribution | 002 | 003 不直接维护完整 UI state |
| pending transaction | `runtime/pending/<transactionId>.json` | ADR-001/main storage | 记录目标 revision、文件 hash、替换阶段 |
| history | `.git` + structured commit | ADR-001/main Git adapter | Git runtime/包 `NEEDS DECISION` |

## 提议的 adapter 语义

### `readWritingOrientation(projectSession)`

输入只能是 main-owned project session，不是 renderer 给出的 path。

返回：

- 已验证的 `WritingOrientationDocument`；如果文件不存在，返回一个空的初始化文档（前提是 001 认为项目结构完整）。
- `PersistenceSnapshot`。
- 002 的 `WritingOrientationLocationContribution`（如果可用）。
- chapter link projection 或“未安装/未准备”的明确状态。

失败：未知 schema、manifest 不匹配、external change、pending 无法恢复时返回对应稳定错误，不把坏文件当成空文档。

### `commitWritingOrientation(projectSession, request)`

输入：

- main 校验过的 motivation + ordered outline snapshot；
- authoritative `baseRevision`；
- `clientMutationId`；
- 可选 location contribution；
- actor/event/change metadata（建议 `human` / `content` / `WriteLLM-Project-Revision`，具体 trailers 依 ADR-001）。

提议流程：

1. 将目标文档编码为包含 `kind`、`schemaVersion`、`projectId`、next revision 和 `updatedAt` 的 JSON。
2. 在 `runtime/pending/` 写入 transaction intent，包括目标文件、旧/新 hash、base/next revision 和阶段。
3. 为每个目标文件在同一目录写临时文件，完整写入后按 ADR-001 约定 rename；禁止直接 truncate canonical file。
4. 重新计算 hash，调用 main-owned Git adapter 记录成功内容变化；不把用户配置、绝对路径、secret 放进 commit metadata。
5. commit 成功后清理 pending，并返回 durable document/revision；清理失败要保留可重试状态而不是伪装成功。

以上是流程约束，不指定是 Node fs、`write-file-atomic` 还是 `atomically`，也不指定 Git implementation。

### `recoverWritingOrientation(projectSession)`

启动或 open 时由 main 调用：

- 无 pending 且 hashes/revision 一致：正常读取。
- 文件已替换但 commit 未完成：按 ADR-001 的重试规则继续或返回明确 `recovery_required`，不得无条件覆盖。
- pending 与 canonical hash 无法对应、外部变更或 schema unknown：保留原文件、返回 `STORAGE_RECOVERY_REQUIRED` / `EXTERNAL_CHANGE`，等待用户/迁移流程。
- recovery 成功后的 cleanup 与 Git history 事件必须可重复执行且不制造重复 outline item。

## 一致性与并发

- 每项目单写入队列；同一项目的 save/delete/recovery 不并行修改 canonical files。
- request 以 `baseRevision` 做 optimistic concurrency；过期保存不能覆盖较新内容。
- `clientMutationId` 用于识别重复提交；重复提交的精确 replay/return semantics `NEEDS DECISION`。
- renderer 的 dirty draft 不是 durable truth；main 返回成功 revision 前不得将状态标记为 saved。
- 003 不保证未发送到 main 的 renderer 草稿在应用崩溃后恢复；是否增加 crash draft 载体需单独决策。

## 迁移与兼容

- 所有 JSON 文档必须有 `kind` 和 `schemaVersion`。
- 已支持旧版本时，迁移要在临时/transaction 流程中完成并保留可回滚材料；迁移策略、支持窗口和是否自动 commit `NEEDS DECISION`。
- 未知版本默认阻止写入并给出可理解提示，不降级成空动机/空大纲。
- 未知字段是否 round-trip 保留依赖共同 codec；在 schema validator 决策前不能承诺。

## 外部依赖边界

本 feature 不调用 provider、worker、网络 API 或凭据。未来 AI/资料 feature 只能把写作方向作为 typed read-only context 读取，不能通过本 contract 获得文件路径、Git、secret 或任意写权限。

## 未决项

- **Decision: NEEDS DECISION** — canonical document 的具体路径、拆分方式、schemaVersion 和 revision scope。
- **Decision: NEEDS DECISION** — atomic writer、fsync/retry、文件锁、跨文件 transaction 的实现和测试阈值。
- **Decision: NEEDS DECISION** — bundled Git executable、isomorphic-git 或其他受控 adapter，以及每个平台 packaging/licensing/update policy。
- **Decision: NEEDS DECISION** — location 与 content 是否同事务；003/002 谁负责恢复光标/焦点/滚动位置。
- **Decision: NEEDS DECISION** — migration、external change、pending recovery 的用户操作和可回滚边界。

