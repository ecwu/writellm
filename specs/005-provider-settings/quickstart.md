# Quickstart: AI Provider 设置与密钥状态

## Prerequisites

Bun 1.3.4、现有 Electron foundation、local fixture/fake adapter。真实 provider、PDF parser、Git runtime 或 embedding 不作为默认前置。

## Scenarios

保存/替换只显示 configured；验证错误不泄密；未提交内容不显示为已保存；secret backend 不可用时不写明文。

建议顺序：bun run typecheck → bun run test → bun run test:smoke。为取消、失败、冲突、权限、过期和恢复准备 fixture，并记录未决技术选择造成的 blocker。
