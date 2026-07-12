# Implementation Plan: AI 写作工作区界面与本地工作区基础

Branch: `001-ai-writing-workspace`（当前 Git 工作分支：`codex/v2-greenfield`）  
Date: 2026-07-11  
Spec: [spec.md](./spec.md)

Input: 现有 AI 辅助写作工作区规格，以及本次对界面体系、组件库和技术偏向的补充：以编辑器为核心，左侧工具 rail 点击后打开悬浮面板，顶部提供项目/设置导航，底部提供 AI、markup、引用和版本入口；具体配置页面通过带背景虚化的 modal 呈现。

## Summary

本计划定义 WriteLLM v2 的可复用桌面写作工作台模板，并把它连接到现有的可移动 `.writellm` 项目存储边界。UI 采用源码归属型 `shadcn/ui`（用户输入中的 “SharedCNUI” 按此解释）作为组件分发方式，固定使用 Radix variant 以兼容 BlockNote 的官方 shadcn 适配层，Tailwind CSS v4 + CSS variables 负责主题和布局；图标使用 Lucide。编辑器采用 BlockNote 的 React/block model，并使用带稳定 block id 的 BlockNote document 作为会话投影，继续以项目内 Markdown 作为 canonical content；项目自有 codec 负责 Markdown 与 BlockNote blocks、citation identity 的读取和写回。

工作台是一个持久 shell，而不是一组互相割裂的页面：顶部 `WorkspaceHeader`、左侧 `ToolRail`、中心 `EditorStage`、底部 `QuickActionBar` 和统一 `ModalHost` 共享同一套主题、焦点管理和 IPC session。首版不引入完整路由框架；启动页与工作区是两个顶层 view，项目选择、资料库、AI 助手、引用、历史、系统设置等使用 `Dialog`、`Sheet`、`Popover` 和命名 modal state 呈现。这样既符合用户希望“背景虚化弹窗配置”的交互，也避免为桌面应用引入 URL 路由和多窗口复杂度。

本计划只完成设计工件。根据仓库 `AGENTS.md`，在当前 feature spec 与 storage ADR 被接受前，不开始产品实现。

## Technical Context

**Language/Version**: TypeScript 5.8.x，Electron 40.10.5，React 19，Vite 6，Bun 1.3.4

**Primary Dependencies**: Electron；React/React DOM；shadcn/ui 源码组件（Radix primitives、`new-york` style，使用 `shadcn init -b radix`）；Tailwind CSS v4、`@tailwindcss/vite`、`tw-animate-css`、`class-variance-authority`、`clsx`、`tailwind-merge`；`lucide-react`；BlockNote `@blocknote/core`、`@blocknote/react`、`@blocknote/shadcn`；Node `fs/promises`、`path`、`crypto` 和 main-owned GitRepository adapter。首版不引入 `@blocknote/xl-ai`，AI task/proposal 层由产品自有 contract 实现。

**Storage**: 应用偏好、全局 provider metadata 和加密 API key 位于 Electron `userData`；API key 通过 main 进程异步 `safeStorage` 保存，不进入 renderer 或 `.writellm` 项目。每个项目位于用户选择的父目录下的 `<project-name>.writellm/`，自包含 Git、Markdown、结构化 JSON、资料、AI task/proposal 和 runtime 目录。

**Testing**: `bun test`（纯函数、React Testing Library/happy-dom、IPC contract）和 `bun run typecheck`；`bun run build` 验证 Tailwind/shadcn/BlockNote 编译；`bun run test:smoke` 验证真实 Electron 的 preload、modal/bridge 生命周期和 main-owned storage。组件交互至少覆盖键盘焦点、Esc/outside dismiss、panel/modal 状态、dirty/save/error 状态和 API key 脱敏。

**Target Platform**: macOS、Windows、Linux 的 Electron 桌面应用；首版按宽屏桌面工作区设计，支持 960×640 最小窗口，保留键盘与较窄窗口下的 rail 收缩策略。

**Project Type**: 安全边界明确的 desktop-app，renderer 只负责 UI、编辑器会话和交互状态，main 负责文件系统、路径解析、校验、持久化、Git、native dialog、secret storage 及外部服务调用。

**Performance Goals**:

- 工作台首屏在项目 DTO 到达后 100 ms 内完成 shell 渲染，不因资料库或 AI 状态阻塞正文编辑。
- editor 输入保持 60 fps 目标；单次保存以 debounce 聚合，不为每个 keystroke 创建版本。
- 左 rail 面板、bottom bar 和 modal 的开合只更新相关 feature subtree，不重建 BlockNote editor。
- modal 背景虚化只应用于 overlay layer；不对滚动中的整棵 editor DOM 做重复 filter。

**Constraints**:

- renderer 必须保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，不得获得 Node、Electron API 或 generic IPC；IPC handler 校验 sender。
- shadcn CLI 只在开发期分发源码；运行时不依赖网络 registry。实际 UI primitives 与自定义组件进入仓库，允许对写作场景直接改造。shadcn variant 固定为 Radix，避免 BlockNote 官方 shadcn adapter 与 Base UI API 混用。
- 所有 privileged action 必须是 shared type 中的命名方法，例如 `openProjectFromDialog`、`saveWorkspace`、`readSecretStatus`、`saveProviderSecret`；不得暴露 `send`、`invoke`、`readFile` 或通用 command executor。
- 项目路径、API key、Git command 和 provider request 只能由 main 管理；renderer 只接收去除绝对路径和 secret 的 DTO。
- BlockNote 官方 Markdown import/export 明确是 lossy；canonical project storage 不直接依赖 Markdown round-trip，而是由项目 codec 在 BlockNote blocks 与带 identity metadata 的 Markdown/JSON 之间显式转换。
- 项目存储采用每项目串行保存、临时文件 + rename、expected revision 和 Git commit；无法 commit 时 UI 必须保持 dirty/error，不得显示为已保存。
- 当前 feature spec 为 Draft，storage ADR 为 Proposed；这是设计阶段的允许状态，实现前必须接受二者。

**Scale/Scope**: 单作者、单窗口、多个本地项目；一个工作台内支持多个章节、资料、AI task/proposal 和线性 Git history。首版不做协作、远程同步、分支/合并、跨项目资料库、独立浮动窗口或完整自定义 titlebar。

## Constitution Check

### Pre-research gate

状态：通过（设计阶段）；实现门槛保持挂起。

- Specification-driven：feature spec 已存在，但仍为 Draft；本计划只产出设计，不开始产品实现。
- Secure Desktop Boundary：工作台所有高权限动作继续走 main/preload；settings modal 不会把 secret 写入 client state 或项目文件。
- Typed, Minimal IPC：新增 UI 只消费命名的 `ProjectWorkspace`、`ProviderSettingsSummary`、`WorkspaceCommandResult` DTO；不存在 generic IPC。
- Durable-boundary ADR：项目存储边界已有 [001-project-storage](../../../docs/adr/001-project-storage.md)；secret storage 与 UI session 的关键规则在本计划及 Phase 1 contract 中显式记录，若改变存储所有权仍需单独 ADR。
- Smallest design：首版采用 React reducer/context、BlockNote editor state 和源码型 UI components，不引入 Redux/Zustand、路由框架、全局 event bus、第二个 renderer、远程 UI runtime 或 BlockNote XL AI 包。
- Verification boundary：组件状态由 React tests 覆盖，IPC 和 secret/storage 行为由 contract + real Electron smoke 覆盖，Markdown identity round-trip 由 codec tests 覆盖。

### Post-design gate

状态：通过（有明确实现前置条件）。Phase 1 不违反宪法；modal、panel、editor 和 provider settings 都通过明确的 renderer state + typed bridge 表达，且持久化和安全行为仍属于 main。实现开始前仍须将 feature spec 和 Proposed storage ADR 标记为 Accepted。

## Architecture and Interaction Model

### Persistent workspace shell

```text
┌──────────────────────────────────────────────────────────────────────┐
│ WorkspaceHeader: project switcher · new · save state · settings       │
├──────┬───────────────────────────────────────────────────────────────┤
│ Tool │                                                               │
│ Rail │                 EditorStage                                   │
│      │     centered, readable, block-based writing canvas             │
│      │                                                               │
│      │     [anchored FloatingPanel when a rail tool is active]        │
├──────┴───────────────────────────────────────────────────────────────┤
│ QuickActionBar: AI assistant · markup · citations · history · status   │
└──────────────────────────────────────────────────────────────────────┘
```

- `WorkspaceHeader`：显示当前项目、保存状态和项目切换；“新建项目”和“设置”进入命名 modal，不打开第二窗口。
- `ToolRail`：固定窄栏，仅放高频工作区入口；按钮有 tooltip、可见 focus ring 和 active state。点击后打开一个锚定于 rail 的 `FloatingPanel`，同时只允许一个 panel 处于 active。
- `EditorStage`：唯一持续可编辑的核心区域；章节标题、BlockNote block 操作、选区和 AI proposal preview 都在这里发生。编辑器采用 `max-width: 72ch` 的可读文本列，周边留出呼吸空间。
- `QuickActionBar`：悬浮在 editor 底部安全区域，承载“唤起 AI”“markup/格式”“查看引用”“版本历史”等用户直接交互入口；不会把命令状态混入正文 Markdown。
- `ModalHost`：全局只管理命名 modal descriptor。配置类 modal 开启 scrim 和轻量背景 blur，锁定背景滚动并转移焦点；需要更大空间的资料库、历史 diff、AI proposal 使用宽 `Dialog` 或 `Sheet`，而不是把每个功能做成顶层 route。

### Visual and component system

- shadcn/ui 组件源码放在 `src/renderer/components/ui/`，产品语义组件放在 `src/renderer/components/workspace/`；不直接从 feature 目录复制同一套 Button/Dialog 样式。
- Radix variant 作为 primitives；`Dialog`、`Popover`、`Tooltip`、`Sheet`、`Command`、`ScrollArea`、`Button`、`ToggleGroup`、`DropdownMenu`、`Input`、`Textarea`、`Tabs`、`Badge` 和 `Separator` 是首批允许组件。BlockNote 的 `shadCNComponents` 只接收这些共享模块的无 Portal 兼容版本。
- Tailwind v4 只描述布局/状态组合；颜色、半径、阴影和 editor surface 用 CSS semantic tokens，使 dark/light theme 和写作纸面保持一致。
- 视觉偏向为“深色工作台 chrome + 高可读编辑纸面”：默认深色 chrome，editor surface 不使用纯黑；正文字号、行高、列宽优先于装饰。所有状态（saving、error、AI running、citation invalid）必须同时使用文字/图标和颜色。
- 图标统一 `lucide-react`，图标按钮必须有 accessible label；不可用 emoji 或临时 SVG 混用。

### State and persistence

- 顶层 `AppShellState` 由 React `useReducer` + feature context 管理：`launch | workspace`、当前项目、active rail tool、open panel、open modal、editor session status、dirty/save status 和 error banner。
- BlockNote editor 自己持有 document/transaction；外层只订阅 selection、current block ids、dirty state 和 explicit save event，避免每次输入让整个 shell 重渲染。BlockNoteView 按官方 uncontrolled component 方式初始化，切换章节时显式销毁并重建 editor instance。
- modal/panel 状态是临时 UI state；只把 `activeLocation`、theme、density、last active tool 等安全偏好通过 typed IPC 写入 `ui-state`，不把 secret 或 editor draft 放进 localStorage。
- `save` 是显式命令边界：renderer 提交 `projectId + expectedRevision + content DTO`，main 校验、写 Markdown/JSON、commit Git，再返回新的 workspace DTO；冲突和失败都进入可恢复的 UI state。

### Provider settings and secrets

- Settings modal 只展示 provider 名称、endpoint、model label、是否已配置以及最后验证状态；输入中的 API key 仅存在于当前 form state，提交后一次性通过 typed IPC 发送到 main。
- main 使用 Electron `safeStorage` 的异步 API 写入 app-owned secret store；项目目录不保存 key，renderer 只收到 `configured: true/false` 和 error code，不回显 plaintext。
- 如果平台 secret backend 不可用，保存动作失败并给出明确提示；不自动降级到明文文件。Linux 的 backend/status 作为诊断信息显示，但不泄露密钥内容。

## Project Structure

### Documentation (this feature)

```text
specs/001-ai-writing-workspace/
├── plan.md                       # 本文件：整体界面、技术选型和实现边界
├── research.md                   # Phase 0：UI/editor/Electron/storage 调研
├── data-model.md                 # Phase 1：持久化实体和 renderer UI DTO/state
├── quickstart.md                 # Phase 1：界面与存储的可运行验证场景
├── contracts/
│   ├── project-ipc.md            # renderer ↔ preload ↔ main 项目 IPC
│   ├── project-storage.md        # .writellm 项目目录与 Git/history
│   └── workspace-ui.md           # shell、panel、modal、editor command contract
└── tasks.md                      # 由 /speckit-tasks 生成；本次不创建
```

### Source Code (repository root)

```text
src/
├── main/
│   ├── main.ts
│   ├── ipc/
│   │   ├── launch-handlers.ts
│   │   ├── project-handlers.ts
│   │   ├── settings-handlers.ts
│   │   └── workspace-handlers.ts
│   └── storage/
│       ├── project-paths.ts
│       ├── project-store.ts
│       ├── git-repository.ts
│       ├── markdown-codec.ts
│       ├── recent-project-store.ts
│       ├── secret-store.ts
│       ├── atomic-file.ts
│       └── project-validation.ts
├── preload/
│   └── preload.cts              # 显式、类型化的 window.writellm methods
├── shared/
│   ├── ipc.ts
│   ├── project.ts
│   ├── settings.ts
│   └── workspace.ts
└── renderer/
    ├── App.tsx
    ├── components/
    │   ├── ui/                 # shadcn/ui owned source components
    │   └── workspace/           # product-level shell components
    ├── features/
    │   ├── launch/
    │   ├── workspace/
    │   │   ├── WorkspaceShell.tsx
    │   │   ├── WorkspaceHeader.tsx
    │   │   ├── ToolRail.tsx
    │   │   ├── FloatingPanel.tsx
    │   │   ├── EditorStage.tsx
    │   │   ├── QuickActionBar.tsx
    │   │   └── modal-registry.ts
    │   ├── editor/
│   │   ├── BlockNoteEditor.tsx
    │   │   ├── extensions/
    │   │   └── editor-session.ts
    │   ├── sources/
    │   ├── assistant/
    │   ├── citations/
    │   ├── history/
    │   └── settings/
    ├── state/
    │   ├── app-shell-reducer.ts
    │   └── workspace-context.tsx
    ├── lib/
    │   ├── cn.ts
    │   └── keyboard.ts
    ├── main.tsx
    └── styles.css

test/
├── unit/
│   ├── storage/
│   ├── editor/
│   └── renderer/
├── contract/
│   ├── project-ipc.contract.test.ts
│   └── workspace-ui.contract.test.ts
└── smoke/
    ├── ipc-contract.test.ts
    └── project-lifecycle.smoke.test.ts
```

**Structure Decision**: 保留当前单仓库 Electron + React 结构，把 renderer 按“通用 UI / product shell / feature / state”分层；main 继续拥有 storage、Git、secret 和 native dialog。工作区 shell 只依赖共享 DTO 与 typed bridge，未来资料库、AI proposal、引用和 history 都以 panel/modal feature 接入，不复制页面壳层。

## Phase Boundaries

### First UI foundation slice

- 接入 shadcn/ui Radix variant + Tailwind v4 + Lucide，建立 semantic tokens、dark/light theme、focus/disabled/error 状态；确保 `@blocknote/shadcn` 使用同一套 no-Portal 兼容组件。
- 把现有 foundation renderer 替换为 Launch Home / Workspace 两态 shell；先用 stub DTO 证明布局和交互，不提前实现 PDF/RAG/AI。
- 实现 top header、left tool rail、单一 floating panel、bottom quick action bar 和统一 modal host。
- 将 project switcher、new project、settings modal 接到已有/计划中的 typed IPC；settings 只验证 secret status 和保存脱敏结果。
- 建立 BlockNote editor session、基础 heading/paragraph/list/quote/citation block schema，使用 BlockNote `BlockNoteSchema.extend` 增加 citation block/inline content；stable block id 进入 BlockNote document；canonical Markdown identity codec 先用 unit tests 锁定边界。
- 通过 keyboard/focus、responsive minimum window、dirty/save/error、modal dismissal 和 Electron smoke 验证。

### Designed but deferred

- PDF 导入、解析、图片/表格保留、chunk/embedding 和检索结果 UI。
- AI task、streaming、proposal diff、逐项接受/拒绝。
- 版本历史时间线、任意两个版本 diff 和恢复 UI。
- 远程同步、协作、分支合并、冲突解决和面向开发者的 Git 面板。
- 完整自定义 titlebar、命令面板全局搜索和独立浮动窗口。

## Complexity Tracking

无宪法例外。以下复杂度都是用户明确要求或现有 storage 约束所需，并不改变四项宪法原则。

| Decision | Why it is needed | Simpler alternative rejected because |
|---|---|---|
| 源码型 shadcn/ui + 本地 product components | 用户要求可复用的界面模板，同时写作产品需要直接调整 panel/editor/modal 细节 | 传统黑盒组件库会增加覆盖样式和 API 适配层；纯 CSS 则会重复解决可访问性和交互 primitives |
| shadcn Radix variant | BlockNote 官方 `@blocknote/shadcn` 文档按 shadcn/Radix component modules 和 no-Portal 约束集成 | 当前 shadcn 新项目默认 Base UI，但在 BlockNote adapter 没有 Base UI contract 前混用会引入组件 API/Portal 风险 |
| BlockNote editor projection + main Markdown codec | 需要 block interaction、selection 和扩展能力，同时必须保留 Markdown canonical 与稳定 citation identity | 纯 textarea 不能提供 block 操作；直接使用 BlockNote 的 lossy Markdown exporter 会丢失自定义 block/identity metadata |
| 单一 shell + panel/modal registry | 用户要求 Photoshop 式侧栏、浮层和模态配置；统一 registry 能保持所有页面共用背景、焦点和关闭语义 | 每个功能独立 page/route 会复制壳层并增加桌面导航状态 |
| main-owned async safeStorage | API key 是系统设置，不能进入项目或 renderer；需要跨平台 OS-backed secret boundary | localStorage、项目 JSON 或明文 userData 文件会扩大泄露面；第三方 native keychain 依赖暂不必要 |
| React reducer/context 而非全局状态库 | 首版状态主要是单窗口 shell + feature session，边界清晰且可测试 | Redux/Zustand 会提前引入全局订阅和持久化约定，当前没有跨窗口/跨页面需求 |
