# WriteLLM v2 documentation entry point

Feature 的需求、设计、契约、验证和任务全部记录在
[`specs/`](../../specs/) 对应的 feature 目录中。跨 feature 的架构决策记录在
[`docs/adr/`](../adr/)；本目录不再承载产品需求或 feature implementation plan。

- [Feature specification registry](../../specs/README.md)：所有 active feature 的状态、依赖、ADR 门禁与规划入口。
- [Project foundation ADR 002](../adr/002-project-foundation.md)：001 的可移动项目、基础持久化、recent pointer 和 main-owned dialog 边界（当前为 Accepted）。
- [Content/history ADR 001](../adr/001-project-storage.md)：ADR-002 之上的 editor-native content、Git-backed history 和跨内容恢复边界（当前为 Proposed）。
- 原综合设计保存在 [`specs/_archive/001-ai-writing-workspace-umbrella`](../../specs/_archive/001-ai-writing-workspace-umbrella/) 供追溯，不再作为当前实现依据。
