# Quickstart: 工作台外壳端到端验证

本文件是实现后的运行/验证指南，不是实现步骤或完整测试套件。它使用仓库已有 Bun scripts；本次规划不安装依赖、不修改 package.json，也不假设外部 provider 可用。

## 前置条件

1. 已在仓库根目录完成依赖安装，且 `bun.lock` 与接受后的 package 变更一致；本次规划不执行联网安装。
2. `002-workspace-shell/spec.md`、`001-project-foundation` 依赖 contract 和 [ADR-001](../../docs/adr/001-project-storage.md) 已被接受，或明确记录暂缓实现的边界。
3. 有一个由 001 定义的 temporary `.writellm` fixture，包含可被打开的最小 manifest 和 editor context stub。当前仓库没有这个 fixture，需要在 implementation 阶段准备。
4. 有 deterministic editor slot，可以记录临时内容、selection 和 scroll position，但不把正文实现复制到 shell。
5. 有 project/save-status/error stub，可产生 `saving`、`saved`、`error`、`needs-action`、`recovery-required` 和 retry/recover action；不需要真实 provider 或凭据。
6. 具备可运行 Electron 的图形/display 环境；CI 若无 display，需由最终选定的 runtime harness/虚拟 display 方案明确提供。Wayland 的 native resize 限制必须单独记录。

## 基线命令

在仓库根目录运行：

```text
bun run typecheck
bun run test
bun run build
bun run test:smoke
```

预期：TypeScript 通过；已有 foundation IPC contract test 通过；Electron/preload 编译成功；`test:smoke` 能检查 compiled shared IPC 和 preload 的显式方法。若出现失败，应先区分 foundation regression、shell renderer failure 和依赖未安装，不应把失败归因给外部服务。

开发模式可运行：

```text
bun run dev:electron
```

预期：Electron 打开安全配置的开发窗口；renderer 能在项目 ready fixture 或明确的 empty/needs-action 状态下进入 shell，不显示未验证的“已保存”。退出前观察 console 是否有 preload、ARIA 或 unhandled rejection 错误。

## 场景 1：进入稳定工作台

1. 用有效 project fixture 启动并打开项目。
2. 记录顶部项目导航、左侧工具入口、中心 editor slot、底部 status region 的 accessible roles/names。
3. 在 editor slot 输入临时文本，记录 selection 和 scroll position。
4. 打开一个 panel，再切换到另一个 panel，再关闭。

预期：

- 四个 shell region 在同一次工作台会话中持续存在；panel 切换不卸载或重建 editor slot。
- 同时只有一个 active panel。
- 临时内容、selection、scroll position 和 status context 保持；关闭后 focus 回 trigger 或合理 editor fallback。

## 场景 2：键盘和 modal 边界

1. 仅使用键盘聚焦并打开 panel，使用 `Tab`/`Shift+Tab` 浏览入口，使用 `Escape` 关闭。
2. 从 panel 入口打开 modal；记录初始焦点。
3. 在 modal 内使用 `Tab` 和 `Shift+Tab`，尝试聚焦背景编辑器。
4. 分别使用 Escape、显式 Close 和允许时的外部点击关闭。
5. 在 editor 长滚动内容上重复一次，并观察 modal 内容超出窗口时的滚动。

预期：

- 每个 icon-only control 有可访问名称或等价文字提示。
- modal 有 dialog role、accessible name、明确关闭机制；焦点进入并保持在 modal 内，背景不可误操作。
- close 后焦点按 contract 返回 trigger 或 fallback；不掉到 body，不丢编辑内容。
- 背景滚动锁和 modal 自身滚动规则一致，内容可读。

## 场景 3：保存和错误状态展示

用 status stub 按顺序发出：`unsaved → saving → saved`，再发出 `error → retryable` 和 `needs-action → recoverable`。

预期：

- `saving` 不显示为已保存；`saved` 只在 owner 明确成功后出现。
- error/needs-action 同时有可读文字/语义标记，不只依靠颜色。
- 错误摘要不含绝对路径、secret、raw stack 或完整文件内容。
- retry/recover action 以 owner 白名单 actionId 返回，不由 shell 绕过 contract 直写项目。
- panel/modal 打开时，重要状态仍可发现，但 live-region 不应打断正常编辑流；具体 politeness 以最终 decision 为准。

## 场景 4：最小窗口和响应式

在真实 Electron 窗口分别使用默认 1200×800 和最小 960×640；若平台支持，手动尝试继续缩小。

预期：

- 主要 editor 区、至少一个工具入口、项目导航和保存错误入口仍可访问。
- 窄窗口下图标入口仍有文字或可理解提示，不仅剩无标签图标。
- 长 panel/modal 不导致整个背景不可读；滚动容器边界明确。
- 不要求通过 renderer 直接调用 Electron API；任何 native bounds 变化都遵守 main-owned decision。

## 场景 5：跨进程和恢复失败边界

1. 在 compiled app 中运行 project-ready snapshot；检查 renderer 只看到安全摘要。
2. 模拟 preload/main method rejection、invalid project revision、save failure 和 recovery required。
3. 关闭并重新打开 fixture，模拟 pending transaction 或 external change 摘要。

预期：

- 只有 shared contract 中列出的 named typed methods 可见；不存在 generic IPC 或 Node/Electron 对象。
- main 重新校验 renderer 输入；错误转为稳定 code 和安全 message。
- shell 不把失败显示为已保存，不覆盖 project truth；显示明确的重试/恢复/重新加载入口。
- pending/recovery/external change 的最终 storage behavior 由 001/ADR-001 决定；shell 只展示结果和 action。

## 当前仍需准备的能力

| 能力 | 当前状态 | 准备前不得假设 |
|---|---|---|
| Project fixture | 当前没有实现 | 不能把 foundation placeholder 当作有效项目 |
| Editor context fixture | 当前没有实现 | 不能用 shell 文本替代 004 的编辑器语义 |
| Save/error event stub | 当前没有实现 | 不能用固定颜色或静态文案证明状态边界 |
| DOM/a11y harness | Bun test 已存在；RTL/user-event 为候选 | 选择和版本需 `NEEDS DECISION` |
| Electron E2E harness | 当前只有 `scripts/electron-smoke.mjs` 的编译 contract smoke | 需要真实窗口交互时，Playwright Electron 或替代方案需决策 |
| External service/credentials | 本 feature 不需要 | provider 连通性不属于本 quickstart；使用 stub |
| Offline strategy | shell 可本地运行；owner 不可用时展示 needs-action | 远程同步/外部 worker 不在 scope |
| Performance/a11y thresholds | SC-002/SC-005 已给出；首屏/切换时延和辅助技术矩阵未给出 | 需在 plan-decisions checklist 明确，不自行发明 SLA |

