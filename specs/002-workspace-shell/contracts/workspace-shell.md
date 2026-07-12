# Contract: Renderer Workspace Shell

**Status**: Draft / `Decision: NEEDS DECISION`

**Scope**: renderer 内部的工作台布局与交互 contract。它不是跨进程 API，也不批准任何组件库。

## Shell regions

稳定 DOM 结构应提供以下语义区域，具体元素可以调整但语义不能丢失：

| Region | 责任 | 业务边界 |
|---|---|---|
| Project navigation | 项目名称/导航入口和项目级 action slot | 项目 open/close/delete 由 001/main owner；shell 不读路径 |
| Tool rail | 面板入口、accessible name、active/disabled 状态 | 只注册 feature-owned panel，不实现 feature 业务 |
| Workspace canvas | 稳定的主要编辑内容 slot | 004/003 等 owner 提供内容；面板切换不得卸载/重建该 slot |
| Status region | save/error/needs-action 的文字/语义展示、live update 和 action slot | 状态由 owner 提供；shell 不宣称保存成功 |
| Panel host | 同一时刻一个 active panel 的 container | panel 可在 renderer 内切换，不能创建原生窗口 |
| Modal host | modal overlay/content 的 focus/inert/scroll 生命周期 | modal owner 提供内容和 commit/cancel 语义 |

## Renderer-facing types（概念 contract）

```text
type WorkspaceShellProps = {
  project: ProjectSummary;          // 001-owned, exact DTO NEEDS DECISION
  editorSlot: ReactNode;            // 004/owner-owned, stable identity
  panels: readonly PanelDescriptor[];
  modals: readonly ModalDescriptor[];
  status: WorkspaceStatus;
  onAction(action: WorkspaceAction): void;
};

type WorkspaceShellEvents =
  | { type: 'panel.open'; panelId: PanelId; triggerId: string }
  | { type: 'panel.close'; reason: 'trigger' | 'escape' | 'outside' }
  | { type: 'modal.open'; modalId: ModalId; triggerId: string }
  | { type: 'modal.close'; reason: 'explicit' | 'escape' | 'outside' }
  | { type: 'owner.action'; action: WorkspaceAction };
```

以上是语义形状，不是已批准的文件导出名。`ProjectSummary`、`PanelId`、`ModalId`、`WorkspaceStatus` 和 `WorkspaceAction` 的最终位置与版本策略为 `NEEDS DECISION`。

## Interaction guarantees

1. `panel.open` 同时只保留一个 panel；切换 panel 不能改变 `editorSlot` 的内容、selection 或 scroll context。
2. panel 由同一 trigger 再次打开时关闭，并按 `focusOrigin` 恢复；如果 trigger 不存在，返回 editor 或合理 region。
3. modal 打开后，dialog 内拥有焦点；Tab/Shift+Tab 不越出 modal；Escape、外部点击和显式关闭按 `dismissPolicy` 处理。
4. modal 关闭后焦点回 trigger，或在 trigger 不存在/流程需要时回到明确 fallback。
5. 背景必须不可误操作且符合 `aria-modal`/inert 语义；视觉遮罩不能替代行为。
6. 所有 icon-only controls 有 accessible name；status 有可读文字或语义等价物，不只依赖颜色。
7. 宽/窄布局都必须保留主要编辑区、工具入口和错误入口；具体断点/尺寸须在决策中冻结。

## Owner/action boundary

- shell 可以发出 opaque `actionId`，但不把它解释成任意 IPC channel、path 或 file command。
- owner 决定 retry/recover/open-owner 的实际动作，并把新的安全 `WorkspaceStatus` 返回 shell。
- owner 的业务失败不能通过抛出 raw exception 直接进入 DOM；必须转换为可显示的安全错误摘要。

## Accessibility baseline

行为以 [WAI-ARIA APG Modal Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) 为最低基线：dialog 有 accessible name；打开时焦点进入；Tab 循环在 modal 内；Escape 可关闭（除非明确禁止）；关闭后回到 trigger 或有理由的 fallback；背景 inert。具体 primitives、测试工具和高对比/减少动画策略为 `Decision: NEEDS DECISION`。

## Non-goals

- 不定义章节 Block、写作动机、大纲、资料、AI task、proposal、provider secret 或 history 的 DTO。
- 不定义 native multi-window modal；当前 modal 是 renderer overlay，原生 child window 能力不在范围内。
- 不承诺面板/模态跨重启恢复；若需求新增，必须同步 data-model、storage ADR 和 IPC contract。
