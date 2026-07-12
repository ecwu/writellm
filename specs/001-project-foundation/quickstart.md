# Quickstart: 可移动项目与启动工作区基础

本文件是实现后的端到端验证指南，不是实现代码或完整测试套件。它验证
[data-model.md](./data-model.md) 与 [contracts/contract.md](./contracts/contract.md)
的行为。

## Prerequisites

1. 在仓库根目录安装与 `bun.lock` 一致的依赖；本次 plan 不修改依赖。
2. 已接受 `spec.md`、`plan.md`、project storage ADR 和 project IPC contract。
3. 有可运行的 Electron display 环境；runtime smoke 使用临时父目录，不使用用户真实项目。
4. 有 filesystem/dialog test seams，可确定性地模拟选择、取消、权限/写入失败和重启。

## Baseline commands

```text
bun run typecheck
bun run test
bun run build
bun run test:smoke
```

预期：shared/main/preload/renderer 类型通过；project unit/contract/integration tests
通过；compiled Electron 能走显式 project IPC；既有 foundation IPC 测试不回归。

开发模式：

```text
bun run dev:electron
```

预期：启动页显示新建和打开入口；没有 recent 时显示空状态；loading/错误状态不
伪造“已打开项目”。

## Scenario 1: First launch and create

1. 使用空的临时 `userData` 启动。
2. 在启动页输入合法项目名称，选择父目录并确认新建。
3. 检查临时父目录下的 `<name>.writellm/project.json`、`workspace/state.json`。
4. 退出并重新启动应用。

Expected:

- 首次启动同时显示新建和打开入口，recent 空状态可理解。
- manifest 的 `projectId`、name、schemaVersion 和 required directory 有效。
- 创建后进入空工作区；recent 只有一条 available record。
- 重启后该记录仍在，项目身份和空工作区状态不变。

## Scenario 2: Open and move/relink

1. 在启动页使用 Open Project 选择一个有效 `.writellm` folder。
2. 关闭应用，将整个 folder 移动或重命名到同一或另一父目录。
3. 从原 recent record 选择 Relink，再选择新位置。
4. 先使用原位置的 projectId，再用另一个有效项目测试 mismatch。

Expected:

- 选择有效项目时打开成功，不依赖固定工作目录。
- relink 只有同一 stable `projectId` 才更新原 record。
- mismatch 返回 `PROJECT_ID_MISMATCH`，原 record/path/status 不被替换。
- 移动后的项目仍显示原 projectId、名称和空工作区。

## Scenario 3: Recent list and safe removal

1. 依次创建/打开 6 个有效项目。
2. 重启应用并观察启动页顺序。
3. 外部删除或改名其中一个项目，再次启动。
4. 选择 Remove Recent；重新检查文件系统。

Expected:

- recent 最多显示 5 条，按 last opened time 倒序。
- 失效记录保留并标为 missing/invalid/inaccessible，不静默消失。
- remove 只删除 recent record，不删除、移动或修改项目文件夹。

## Scenario 4: Cancellation, collision and invalid project

逐项模拟：

1. 在 create 的名称/父目录阶段取消。
2. 在 open/relink native dialog 取消。
3. 在同一父目录用同名项目再次 create。
4. 选择缺少 manifest、未知 schema、错误 projectId 或缺少 workspace/state 的普通目录。

Expected:

- cancel 不创建文件、不修改 recent、不显示成功。
- collision 返回 `PROJECT_EXISTS`，既有项目字节和 recent 不变。
- invalid project 只返回稳定诊断，renderer 不进入工作区，磁盘目录不被写入或修复。

## Scenario 5: Storage and failure boundary

1. 注入 manifest/state 写入失败、recent index 写入失败和 rename 失败。
2. 在临时项目创建的各 stage 中终止操作，随后重启并重新列出 recent。
3. 注入 recent index 损坏或缺失。
4. 注入 `saveProjectWorkspace` 失败。

Expected:

- 失败结果使用 stable error code；启动页不显示成功状态。
- 没有半成品最终 `.writellm` project 被 recent index 识别为有效。
- recent index 故障最多造成空列表/安全 warning，不损坏项目目录。
- workspace save 失败不伪造 last-edited state；成功后才更新 state.json。

## Runtime and contract checks

- 断言 `window.writellm` 只暴露 contract 中的 named methods，不包含 generic IPC、Node
  对象、absolute path 或 `deleteProject`。
- 在 compiled Electron 中从 renderer 发非法 name/recentId/projectId，断言 main
  重新校验并返回稳定错误，而不是抛出 raw exception。
- 断言 dialog cancel 使用 `{ status: "canceled" }`，不是 storage failure。
- 断言每个 operation 的成功结果都对应已落盘并可再次验证的 project/recent state。
