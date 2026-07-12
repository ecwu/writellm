# Quickstart: Block 章节编辑器

## Prerequisites

Bun 1.3.4、现有 Electron foundation、local fixture/fake adapter。真实 provider、PDF parser、Git runtime 或 embedding 不作为默认前置。

## Scenarios

章节创建；基础 block 操作；常见 Markdown 语法输入/粘贴；Markdown 导出提示；重开后
identity/order/citation 保持；重复/缺失标识需人工检查；stale save 不覆盖当前内容。

建议顺序：bun run typecheck → bun run test → bun run test:smoke。为取消、失败、冲突、权限、过期和恢复准备 fixture，并记录未决技术选择造成的 blocker。
