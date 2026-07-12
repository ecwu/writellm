# Quickstart: 项目版本历史与恢复

## Prerequisites

Bun 1.3.4、现有 Electron foundation、local fixture/fake adapter。真实 provider、PDF parser、Git runtime 或 embedding 不作为默认前置。

## Scenarios

人工与模型成功保存均有记录；失败/取消不产生正文记录；任意两版本可比较；恢复生成新人工记录且不删除旧历史。

建议顺序：bun run typecheck → bun run test → bun run test:smoke。为取消、失败、冲突、权限、过期和恢复准备 fixture，并记录未决技术选择造成的 blocker。
