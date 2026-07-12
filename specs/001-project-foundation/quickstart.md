# Quickstart: 可移动项目与启动工作区基础

本文件是实现后的端到端验证指南，不是实现代码或完整测试套件。它验证
[data-model.md](./data-model.md) 与 [contracts/contract.md](./contracts/contract.md)
的行为。

## Prerequisites

1. 使用 Bun 1.3.14 安装与 `bun.lock` 精确一致的依赖。产品实现开始前，lockfile 必须
   已冻结 plan 中确认的 TypeScript 7.0.2、Electron 43.1.0、React/React DOM 19.2.7、
   Vite 8.1.4 及相关直接开发依赖。
2. `spec.md`、`plan.md`、[ADR-002](../../docs/adr/002-project-foundation.md) 和 project
   IPC contract 均已接受。ADR-001 的内容/Git history 条款不是本 feature 前置条件。
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
通过；compiled Electron 能走 6-method project IPC 和真实双进程单实例路径；既有
foundation smoke 不回归。依赖升级必须先单独满足同一组命令，再开始产品功能实现。

开发模式：

```text
bun run dev:electron
```

预期：启动页显示新建和打开入口；没有 recent 时显示空状态；loading/错误状态不
伪造“已打开项目”。

## Scenario 1: First launch and create

1. 使用空的临时 `userData` 启动。
2. 在启动页输入合法项目名称，选择父目录并确认新建。
3. 检查临时父目录下的 `<name>.writellm/project.json` 和空 `workspace/` 必需目录。
4. 退出并重新启动应用。

Expected:

- 首次启动同时显示新建和打开入口，recent 空状态可理解。
- manifest 的 `projectId`、name、schemaVersion 和 required directory 有效；
  `createdAt` 与 `updatedAt` 相同。
- 创建后进入空工作区；recent 只有一条 available record。
- 重启后该记录仍在，项目身份不变；项目内没有 workspace state 文件。

## Scenario 2: Open and move/relink

1. 记录有效 `.writellm` folder 的完整 tree hash，再从启动页使用 Open Project 选择它。
2. 关闭应用，将整个 folder 移动或重命名到同一或另一父目录。
3. 从原 recent record 选择 Relink，再选择新位置。
4. 先使用原位置的 projectId，再用另一个有效项目测试 mismatch。
5. 将同一项目移到第三个位置，直接使用 Open Project 打开，而不是从原记录 Relink。

Expected:

- 选择有效项目时打开成功，不依赖固定工作目录。
- relink 只有同一 stable `projectId` 才更新原 record。
- mismatch 返回 `PROJECT_ID_MISMATCH`，原 record/path/status 不被替换。
- 普通 Open 相同 projectId 更新原 record 的路径与时间，保留 recentId，列表中仍只有一条。
- 每次 open/relink 前后的项目 tree hash 和 manifest 两个时间戳完全不变。
- 移动后的项目仍显示原 projectId、名称并进入空工作区。

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
4. 在当前平台分别使用本地文件系统接受和拒绝的名称；另选一个只在其他平台保留的名称。
5. 选择缺少 manifest、未知 schema、错误 projectId 或缺少 `workspace/` 的普通目录。
6. 在 cleanup receipt、root reservation、tokenized manifest temp、workspace 创建和
   manifest publish 阶段终止应用，重启后检查 receipt 与未完成目录处理。

Expected:

- cancel 不创建文件、不修改 recent、不显示成功。
- collision 返回 `PROJECT_EXISTS`，既有项目字节和 recent 不变。
- 应用只拒绝不安全路径输入或当前目标文件系统拒绝的名称，不预先套用其他平台规则。
- invalid project 只返回稳定诊断，renderer 不进入工作区，磁盘目录不被写入或修复。
- 崩溃遗留的未完成根目录不会出现在 recent 或 open 结果中；启动时不扫描任意父目录，
  只清理 receipt/token 匹配、没有有效 manifest 且不含未知文件的目录，其他情况保留
  并显示安全 warning。cleanup receipt 不支持继续创建。

## Scenario 5: Storage and failure boundary

1. 注入 cleanup receipt、root reservation、workspace mkdir、manifest publish、receipt
   removal 和 recent index 写入失败。
2. 在项目创建的各 stage 中终止操作，随后重启并重新列出 recent。
3. 注入 recent index 损坏或缺失。

Expected:

- 失败结果使用 stable error code；启动页不显示成功状态。
- 没有半成品最终 `.writellm` project 被 recent index 识别为有效。
- recent index 故障最多造成空列表/安全 warning，不损坏项目目录。
- 缺失 index 按空列表处理；损坏 index 不立即覆盖，成功 create/open 后才原子替换为有效 index。

## Scenario 6: Single active instance

1. 用隔离的临时 `userData` 启动真实 compiled Electron primary，等待窗口 ready。
2. 最小化或隐藏 primary，再以相同应用根和 `userData` 启动 secondary。
3. 记录两个进程的 lifecycle markers、窗口数量和 recent/project 写入。

Expected:

- secondary 在短超时内退出，不注册 IPC、不初始化 recent storage、不创建窗口。
- primary 恰好收到一次 `second-instance`，恢复/显示并请求聚焦原窗口。
- primary PID 不变且始终只有一个窗口；project 与 recent 没有并发写入。
- Linux headless runtime 使用 Xvfb；Wayland 环境验证 restore/show/focus 请求，不把窗口
  管理器拒绝实际焦点误报为业务失败。

## Runtime and contract checks

- 断言 `window.writellm` 恰好只暴露 contract 中的 6 个 named methods，不包含旧的
  runtime-info、workspace save、generic IPC、Node 对象、absolute path 或 `deleteProject`。
- 在 compiled Electron 中从 renderer 发非法 name/recentId/projectId，断言 main
  重新校验并返回稳定错误，而不是抛出 raw exception。
- 断言 dialog cancel 使用 `{ status: "canceled" }`，不是 storage failure。
- 断言每个 operation 的成功结果都对应已落盘并可再次验证的 project/recent state。
