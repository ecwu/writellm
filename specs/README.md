# WriteLLM v2 specifications

原来的 `001-ai-writing-workspace` 将完整产品旅程、工作台、资料库、AI 提案和版本历史放在同一个 feature 中，现已拆成以下独立 specification：

| 顺序 | Feature | 用户价值 | 主要依赖 | 第一版计划 |
|---|---|---|---|---|
| 001 | [project-foundation](./001-project-foundation/spec.md) | 创建、打开、移动和管理可移动项目 | 现有 Electron foundation | [plan](./001-project-foundation/plan.md) |
| 002 | [workspace-shell](./002-workspace-shell/spec.md) | 提供稳定、可访问的写作工作台外壳 | 001 | [plan](./002-workspace-shell/plan.md) |
| 003 | [writing-orientation](./003-writing-orientation/spec.md) | 记录写作动机和文章大纲 | 001、002 | [plan](./003-writing-orientation/plan.md) |
| 004 | [block-editor](./004-block-editor/spec.md) | 从大纲创建章节并编辑 Block | 001、002、003 | [plan](./004-block-editor/plan.md) |
| 005 | [provider-settings](./005-provider-settings/spec.md) | 配置 AI provider 和受保护的密钥状态 | 001、002 | [plan](./005-provider-settings/plan.md) |
| 006 | [source-library-processing](./006-source-library-processing/spec.md) | 导入 PDF 并完成资料处理 | 001、002 | [plan](./006-source-library-processing/plan.md) |
| 007 | [source-search-citations](./007-source-search-citations/spec.md) | 检索资料并插入可追溯引用 | 004、006 | [plan](./007-source-search-citations/plan.md) |
| 008 | [ai-writing-tasks](./008-ai-writing-tasks/spec.md) | 提交限定范围的 AI 任务并获得提案 | 004、005、007 | [plan](./008-ai-writing-tasks/plan.md) |
| 009 | [ai-proposal-review](./009-ai-proposal-review/spec.md) | 审阅并安全应用 AI 提案 | 004、007、008 | [plan](./009-ai-proposal-review/plan.md) |
| 010 | [version-history](./010-version-history/spec.md) | 查看、比较和恢复已保存版本 | 001、003、004、007、009 | [plan](./010-version-history/plan.md) |

## Sequencing

先完成 001–004，形成“创建项目 → 规划 → 写出章节”的最小写作闭环；005 独立建立 AI 配置安全边界；006–007 形成资料和引用闭环；008–009 形成 AI 提案闭环；010 作为跨内容类型的历史能力逐步接入。

每个 feature 应分别运行 `/speckit-clarify`、`/speckit-plan`、`/speckit-tasks`，不要再为整个产品生成一个共享的 `tasks.md`。

## 状态流转与实现门禁

- Feature 的 `spec.md` 和 `plan.md` 状态流转为：`Draft → Accepted`。
- ADR 状态流转为：`Proposed → Accepted`。
- `research.md`、`data-model.md`、`contracts/`、`quickstart.md` 和
  `checklists/` 是支持性设计材料，不单独授权实现；其中的候选或
  `NEEDS DECISION` 不能视为已批准方案。
- 只有当前 feature 的 `spec.md`、`plan.md` 和所需 ADR 都为 `Accepted` 后，
  才能生成该 feature 的 `tasks.md` 并开始实现。

本轮已为 001–010 生成第一版 `plan.md`、`research.md`、`data-model.md`、`quickstart.md`、契约文档和 `checklists/plan-decisions.md`；未生成 `tasks.md`，也未批准任何新增库或包。每个 `plan-decisions.md` 都保留了待用户确认的选型、ADR、schema、IPC、性能、可访问性和恢复边界。

原综合设计已移到 [`_archive/001-ai-writing-workspace-umbrella`](./_archive/001-ai-writing-workspace-umbrella/)，仅用于追溯拆分来源；当前实现依据以本目录下的新 specs 为准。
