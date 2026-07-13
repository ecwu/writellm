# WriteLLM v2 specification registry

这是所有 active feature 的规划入口。开始澄清、设计、拆任务或实现前，先读本页；
具体需求和决定仍以链接到的 `spec.md`、`plan.md` 和 ADR 为准。本页只提供状态摘要，
不替代这些 source of truth。

## Feature registry

| ID | Feature / 用户价值 | 硬依赖 | Spec | Plan | ADR gate | Tasks | 实现 |
|---|---|---|---|---|---|---|---|
| 001 | [Project foundation](./001-project-foundation/spec.md)：创建、打开和管理可移动项目 | — | Accepted | [Accepted](./001-project-foundation/plan.md) | [ADR-002](../docs/adr/002-project-foundation.md) Accepted | [45/45](./001-project-foundation/tasks.md) | Complete |
| 011 | [UI foundation](./011-ui-foundation/spec.md)：共享主题、排版和 UI primitives | 001 | Accepted | [Accepted](./011-ui-foundation/plan.md) | [ADR-003](../docs/adr/003-ui-foundation.md) Accepted | [52/52](./011-ui-foundation/tasks.md) | Complete |
| 002 | [Workspace shell](./002-workspace-shell/spec.md)：稳定、可访问的写作工作台外壳 | 001, 011 | Accepted | [Accepted](./002-workspace-shell/plan.md) | ADR-001 not required；ADR-003 Accepted | [34/34](./002-workspace-shell/tasks.md) | Complete |
| 003 | [Writing orientation](./003-writing-orientation/spec.md)：写作动机和文章大纲 | 001, 002, 011 | Accepted | [Accepted](./003-writing-orientation/plan.md) | [ADR-001](../docs/adr/001-project-storage.md) Accepted | [41/41](./003-writing-orientation/tasks.md) | Complete |
| 004 | [Block editor](./004-block-editor/spec.md)：从大纲创建章节并编辑 Block | 001, 002, 003, 011 | Accepted | [Accepted](./004-block-editor/plan.md) | ADR-001 Accepted；ADR-003 Accepted | [50/50](./004-block-editor/tasks.md) | Complete |
| 012 | [Icon and usability refresh](./012-icon-usability-refresh/spec.md)：统一推荐图标体系并提升所有已实现界面的易用性 | 001, 002, 003, 004, 011 | Accepted | [Accepted](./012-icon-usability-refresh/plan.md) | ADR-003 Accepted；new ADR not required | [50/50](./012-icon-usability-refresh/tasks.md) | Complete |
| 005 | [Provider settings](./005-provider-settings/spec.md)：配置 Pi Agent harness provider、模型能力和受保护的密钥状态 | 001, 002, 011 | Accepted | [Accepted](./005-provider-settings/plan.md) | [ADR-004](../docs/adr/004-provider-settings-security.md) Accepted；ADR-003 Accepted | [46/46](./005-provider-settings/tasks.md) | Complete |
| 006 | [Knowledge ingestion](./006-source-library-processing/spec.md)：批量导入 PDF，在后台解析、持久化内容块并建立索引 | 001, 002, 011 | Accepted | [Accepted](./006-source-library-processing/plan.md) | ADR-001 Accepted；ADR-003 Accepted；[ADR-005](../docs/adr/005-source-ingestion-services-security.md) Accepted | [78/78](./006-source-library-processing/tasks.md) | Complete |
| 007 | [Search and citations](./007-source-search-citations/spec.md)：检索资料并插入可追溯引用 | 004, 006, 011 | Draft | [Draft](./007-source-search-citations/plan.md) | ADR-001 Accepted；ADR-003 Accepted | Missing | Not started |
| 008 | [AI writing tasks](./008-ai-writing-tasks/spec.md)：提交限定范围的 AI 任务并获得提案 | 004, 005, 007, 011 | Draft | [Draft](./008-ai-writing-tasks/plan.md) | ADR-001 Accepted；ADR-003 Accepted | Missing | Not started |
| 009 | [Proposal review](./009-ai-proposal-review/spec.md)：审阅并安全应用 AI 提案 | 004, 007, 008, 011 | Draft | [Draft](./009-ai-proposal-review/plan.md) | ADR-001 Accepted；ADR-003 Accepted | Missing | Not started |
| 010 | [Version history](./010-version-history/spec.md)：查看、比较和恢复已保存版本 | 001, 003, 004, 007, 009, 011 | Draft | [Draft](./010-version-history/plan.md) | ADR-001 Accepted；ADR-003 Accepted | Missing | Not started |
| 013 | [Workspace navigation redesign](./013-workspace-navigation-redesign/spec.md)：以 Sections、Knowledge Base 和全局 Settings 重组分栏工作区 | 002, 003, 004, 005, 006, 011, 012 | Accepted | [Accepted](./013-workspace-navigation-redesign/plan.md) | ADR-003 Accepted；new ADR not required；006 contract + ADR-005 amendment required | Missing | Not started |

`Gated` 表示 tasks 已存在，但实现门禁尚未满足；它不等于可以开始实现。

## 规划前检查

1. 找到目标 feature，确认所有“硬依赖”已经达到该 feature 所需阶段。
2. 阅读目标 `spec.md`；若不是 `Accepted`，只能继续澄清或评审。
3. 阅读目标 `plan.md` 和 `checklists/plan-decisions.md`，处理所有未决项。
4. 检查 ADR gate；跨持久化、IPC、系统或流程边界的决定必须已有 Accepted ADR，
   或在 plan 中明确记录为不需要 ADR。
5. 只有 spec、plan 和所需 ADR 全部 Accepted 后，才可生成 `tasks.md` 并实现。
6. 规划或状态变化时，同一变更中更新本表；不得只更新摘要而不更新 source of truth。

建议按单个 feature 运行 `/speckit-clarify` → `/speckit-plan` →
`/speckit-tasks`。不要为整个产品生成共享 `tasks.md`。

## 状态词汇

| 项目 | 允许值 |
|---|---|
| Spec / Plan | `Draft` → `Accepted`；不再适用时使用 `Superseded` 或 `Archived` |
| ADR | `Proposed` → `Accepted`；确认不需要时写 `Not required` 并给出依据 |
| Tasks | `Missing`、`Gated`、`Ready`，或完成数 `x/y` |
| 实现 | `Not started`、`In progress`、`Complete` |

没有显式写明 `Accepted` 的文档按 `Draft` 处理。`tasks.md` 的存在或任务全部勾选，
都不能反向证明 spec、plan 或 ADR 已接受。

## ADR registry

| ADR | 决定 | 状态 | 主要影响 |
|---|---|---|---|
| [ADR-001](../docs/adr/001-project-storage.md) | `.writellm` 内容格式与 Git-backed history | Accepted | 003–010 的内容持久化、事务和历史边界；消费 feature 分阶段冻结自身 contract |
| [ADR-002](../docs/adr/002-project-foundation.md) | 可移动项目、recent pointer 和 main-owned dialog | Accepted | 001；为后续项目内能力提供基础边界 |
| [ADR-003](../docs/adr/003-ui-foundation.md) | Source-owned renderer UI 与外观基础 | Accepted | 011，以及 002–010 的 renderer UI |
| [ADR-004](../docs/adr/004-provider-settings-security.md) | application-global provider 配置、受保护 secret 与验证边界 | Accepted | 005；后续 AI feature 只消费其 redacted availability contract |
| [ADR-005](../docs/adr/005-source-ingestion-services-security.md) | 用户配置的资料摄取服务、受保护凭据与数据出境边界 | Accepted | 006 的 MinerU 解析、SiliconFlow embedding、网络传输和后台重试边界 |

ADR 文件位于 [`docs/adr/`](../docs/adr/)。新增 ADR 时使用下一个稳定编号，并在
ADR、受影响 feature 的 plan 和本表之间建立双向链接。

## 关系与归档

- `硬依赖`：未满足时不能实现目标 feature；普通关联不应放入该列。
- 跨 feature 的 producer/consumer、共享 contract 或受影响关系，应写入双方 plan 或 contract。
- 被替代的综合设计保存在
  [`_archive/001-ai-writing-workspace-umbrella`](./_archive/001-ai-writing-workspace-umbrella/)，
  仅用于追溯，不是当前实现依据。
