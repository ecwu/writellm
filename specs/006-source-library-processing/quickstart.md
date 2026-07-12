# Quickstart: PDF 资料导入与处理

## Prerequisites

Bun 1.3.14、现有 Electron foundation、local fixture/fake adapter。真实 provider、PDF parser、Git runtime 或 embedding 不作为默认前置。

## Scenarios

有效/无效 PDF；阶段状态可恢复；仅有 text+embedding+location 才可检索；失败保留 partial artifacts 并可重试。

建议顺序：bun run typecheck → bun run test → bun run test:smoke。为取消、失败、冲突、权限、过期和恢复准备 fixture，并记录未决技术选择造成的 blocker。
