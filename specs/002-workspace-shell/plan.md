# Implementation Plan: 写作工作台外壳

**Branch**: `002-workspace-shell` | **Date**: 2026-07-12 | **Spec**: [spec.md](./spec.md)

**Status**: Accepted — maintainer accepted 2026-07-12; 011 implementation confirmed complete

## Summary

在已实现的 001 项目入口与已接受的 011 UI foundation 之上，建立 renderer-only 的单窗口工作台外壳。001 的四条成功路径把既有 `ProjectSnapshot { projectId, displayName }` 交给工作台；工作台提供项目导航、工具入口、持续挂载的主要工作区槽位、最多一个活动工具面板和 owner-provided 状态区域。返回启动页只切换 renderer surface 并复用 001 能力。

002 不新增 IPC、持久化 schema、项目验证、保存/恢复协议或 UI primitive。活动面板与焦点返回键只存在于当前 renderer 会话；Dialog、Tooltip、ScrollArea、StatusNotice、主题、Typeset 与测试 harness 全部消费 011 的已接受契约。

## Technical Context

**Language/Version**: TypeScript 7.0.2；React/React DOM 19.2.7；Electron 43.1.0；Bun 1.3.14。

**Primary Dependencies**: 当前 `package.json` 的精确冻结依赖；002 使用 React built-ins 和 011 已接受的 source-owned shadcn/Rhea + Base UI、Tailwind CSS v4、semantic tokens 与 Typeset。002 不新增状态库、overlay 库、路由库或 browser automation 依赖。

**Storage**: 无。`surface`、`activePanelId`、`panelFocusReturnKey` 是 renderer 内存状态；布局由 CSS 推导。不得写入 project、recent index、appearance preferences、localStorage 或新文件。

**Testing**: Bun + Happy DOM + React Testing Library + user-event；011 的 dedicated compiled Electron UI fixture 使用原生键盘输入与 DOM inspection。保留 `bun run typecheck`、`bun run test`、`bun run build`、`bun run test:smoke` 及 001/011 回归。

**Target Platform**: Electron 单窗口桌面应用，macOS、Windows、Linux；默认 1200×800，最小 960×640，并验证 200% 文本缩放。

**Project Type**: sandboxed Electron main/preload + React renderer。

**Performance Goals**: 100 次面板打开/切换/关闭中主要工作区 DOM 节点、内容、选区与滚动 100% 保持；不新增未经 spec 接受的毫秒级 SLA。

**Constraints**: 保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；001 的六方法 `window.writellm` 与 011 的两方法 appearance namespace 不变；同时最多一个工具面板；未知/失败状态不得显示为成功；960×640 与 200% 下关键区域可达。

**Scale/Scope**: 单项目会话、一个持续工作区槽位、一个可选工具面板、一个状态摘要。后续 feature 提供槽位内容、面板内容、状态与动作。

## Constitution Check — pre-research gate

| Principle | Status | Evidence |
|---|---|---|
| I. Secure Desktop Boundary | PASS | 002 是 renderer composition，不增加 Electron、Node、路径或文件能力。 |
| II. Typed, Minimal IPC | PASS | 直接消费 001 已接受的 `ProjectSnapshot`；项目六方法和 appearance 两方法保持不变，无 shell IPC。 |
| III. Specification-Driven, Minimal Evolution | PASS | spec 与 plan 已接受；设计采用满足范围的最小 reducer、CSS layout 与 011 公共能力。 |
| IV. Verification at the Failure Boundary | PASS WITH PLAN | reducer/DOM 行为在 DOM harness 验证；真实焦点、inert、键盘、主题与窗口行为在 compiled Electron UI fixture 验证。 |

**Gate conclusion**: 无 Constitution exception 或技术未知项。spec/plan 已接受且 011 已实现；开始 002 实施前确认 001 migration regression 通过。

## Research Decisions

[research.md](./research.md) 已解决全部技术输入：使用现有 ProjectSnapshot 交接、React 内存 reducer、持续挂载的 workspace slot、确定性的 panel/focus 规则、CSS reflow、owner-provided 状态投影、011 UI/harness，以及零新增 IPC/持久化。

## Project Structure

### Documentation

```text
specs/002-workspace-shell/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── workspace-shell.md
│   └── workspace-ipc.md
└── checklists/
    ├── requirements.md
    └── plan-decisions.md
```

### Planned source delta

```text
src/renderer/
├── App.tsx                         # launch/workspace surface owner
├── launch/                         # 001 behavior preserved
└── workspace/
    ├── WorkspaceShell.tsx
    ├── workspaceSession.ts         # pure reducer and public renderer types
    └── components/
        ├── ProjectNavigation.tsx
        ├── ToolRail.tsx
        ├── WorkspaceSlot.tsx
        ├── ToolPanelHost.tsx
        └── WorkspaceStatusRegion.tsx

test/
├── unit/workspace/
├── integration/workspace/
└── runtime/ui/                     # extend 011 compiled UI fixture
```

**Structure Decision**: shell 只属于 renderer feature composition。共享 primitive/pattern 继续由 011 拥有；001 main/preload/shared project implementation 不因 002 改动。

## Implementation Design

### Phase 1 — Surface handoff and stable shell

1. 将 renderer 顶层 surface 表达为 `launch | workspace(ProjectSnapshot)`；001 create/open/recent/relink 只有成功 union 才进入 workspace，cancel/error 保留启动页。
2. 返回启动页时清除 shell session 并重新使用现有 `LaunchPage({ api: window.writellm })`；不重新验证、打开或修改项目。
3. 建立 project navigation、tool rail、workspace slot、panel host 与 status region。workspace slot 在同一 project session 内持续挂载，panel 是其 sibling。
4. 只渲染已注册且当前可用的 panel trigger；未注册未来工具完全隐藏，不提供禁用或可交互占位入口。
5. 使用 Button、Tooltip、ScrollArea、StatusNotice、EmptyState 等 011 公共能力与 semantic tokens；feature 只拥有布局、copy 与业务组合。

### Phase 2 — Panel and focus orchestration

1. reducer 只处理进入/离开 workspace、activate/toggle/close panel；`activePanelId` 保证最多一个活动面板。
2. 当前 trigger 再次激活时关闭；另一 trigger 原子替换；快速输入以最后一次已提交 id 为准；显式关闭与 Escape 使用幂等 close event。
3. v1 panel 不因外部点击关闭，避免与 trigger/Escape 产生双重关闭。Dialog 打开时由 011 Dialog 优先消费 Escape 与背景交互。
4. 关闭 panel 后优先聚焦仍连接且可用的 trigger；否则聚焦有名称、`tabIndex=-1` 的 workspace fallback，绝不落到 `body`。
5. 普通非模态 panel 打开时焦点保留在 trigger；下一次 Tab 按正常顺序进入 panel。Dialog 仍由 011 将焦点移入模态。
6. panel 状态区分 hover preview 与 pinned open：hover 进入已注册 trigger 时显示临时 preview，指针离开 trigger 与 preview region 后经 200ms grace period 收回；点击/键盘激活转为 pinned，pinned 不响应 blur/pointer-leave timer。

### Phase 3 — Responsive and appearance composition

1. 宽布局使用 rail + flexible workspace + bounded panel column；所有网格子项 `min-width: 0`，长内容独立滚动。
2. 受限布局把 rail reflow 为水平 toolbar，并把 panel 变成有界的 stacked region；不引入 Sidebar、Sheet、Tabs 或 JS breakpoint。
3. header/status 可换行，panel close path 与重要状态始终可达；在 960×640、200% 缩放验证无阻断裁切。
4. 主题与排版消费 011 AppearanceProvider、semantic tokens 与 Typeset；运行时 theme/reduced-motion 变化不得 remount project、panel 或 workspace slot。

### Phase 4 — Owner-provided status

1. shell 接收安全的 `OwnerStatusSummary`，只呈现 `in-progress | complete | error | needs-action | unknown | owner-unavailable` 与 severity/message。
2. 动作仅在 owner 提供 renderer callback 时显示并原样交回 owner；shell 不推断保存、重试、恢复或 IPC method。
3. 通过 StatusNotice/Alert 提供可见文字与适当 polite/urgent 语义；unknown/owner-unavailable 不映射为 success。
4. 面板或 Dialog 打开时重要错误仍保持可发现；copy 不得包含路径、secret、raw exception 或项目内容。
5. 多 owner 只展示一个主状态，使用 `error > needs-action > owner-unavailable > unknown > in-progress > complete`，同级按最新 accepted sequence 与 sourceId 稳定决胜。

### Phase 5 — Failure-boundary verification

1. 覆盖四种成功交接、cancel/error 不进入、返回后 001 能力及副作用不变。
2. 覆盖 open/switch/toggle/Escape/explicit/rapid panel events，100 次循环验证节点、内容、selection、scroll 与 focus return。
3. 覆盖所有状态、动作有无、重复/乱序输入、安全退化，以及 region/control names、键盘路径和 visible focus。
4. 在 compiled Electron UI fixture 覆盖 Dialog/Tooltip、inert、原生 Tab/Escape、1200×800、960×640、200%、System/Light/Dark 与 reduced motion。
5. 运行完整 001/011 回归并断言项目六方法、appearance 两方法、项目树只读与存储 schema 均无变化。

## Cross-boundary Contract

```text
001 successful ProjectSnapshot
          |
          v
App surface owner -> WorkspaceShell(renderer session)
                       |       |        |
                 workspace   panel   status/action
                    slot     owner      owner
```

- 001 拥有项目身份、native dialogs、recent records、文件系统与六方法 bridge。
- 011 拥有 appearance bridge、semantic tokens、primitives、patterns、overlay semantics、Typeset 与 UI harness。
- 002 只拥有 workspace regions、session reducer、panel orchestration、focus fallback、responsive composition 与状态呈现。
- 后续 feature 拥有 slot/panel 内容、业务状态、动作与持久化。

## Verification Matrix

| Failure boundary | Required evidence |
|---|---|
| 001 → workspace handoff | 四种 success 交付原样 `ProjectSnapshot`；cancel/error/invalid 不进入；返回不产生项目/recent 副作用。 |
| Shell reducer | 最多一个 panel；toggle/switch/close 幂等；离开 workspace 清理 session。 |
| Stable workspace | 100 次循环保持同一 DOM node、内容、selection、scroll、focus context。 |
| Focus/overlay | trigger return 或 workspace fallback；Dialog 优先 Escape、focus trap、inert 与 return 符合 011。 |
| Status | 六种状态都有文字/语义；动作仅 owner 提供；unknown/failure 不成功化；安全 copy。 |
| Responsive/appearance | 1200×800、960×640、200%、三主题、reduced motion 下关键区域可达且状态不丢失。 |
| Security/regression | 无新 IPC/storage/localStorage；001 六方法与 011 appearance namespace 不变；typecheck/test/build/smoke 全通过。 |

## Constitution Check — post-design

| Principle | Status | Design evidence |
|---|---|---|
| I. Secure Desktop Boundary | PASS | 数据流停留在 renderer；只消费安全 ProjectSnapshot 与 owner callbacks。 |
| II. Typed, Minimal IPC | PASS | [contracts/workspace-ipc.md](./contracts/workspace-ipc.md) 冻结为零新增方法；现有 namespaces 不变。 |
| III. Specification-Driven, Minimal Evolution | PASS | spec/plan 已接受；所有选择可追溯至 spec、001、011/ADR-003，无 hypothetical storage、router、state library 或 primitive。 |
| IV. Verification at the Failure Boundary | PASS | reducer、DOM composition 与 compiled Electron runtime 分层覆盖各自可检测的失败。 |

**Post-design gate**: spec/plan 已接受，011 已实现，001 migration regression 已确认通过；没有 Constitution exception、待补跨边界 ADR 或剩余 implementation gate。

## Complexity Tracking

无 Constitution exception。单一 reducer、持续挂载 slot、CSS reflow 与 owner callback 是满足需求的最小复杂度；路由、shell IPC、durable layout、状态库、native panel window、nested modal 与新 foundation primitive 均不引入。
