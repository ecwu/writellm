# Research: 写作工作台外壳候选能力

**Research date**: 2026-07-12

**Scope**: Electron 40.10.5 + React 19 + Bun 1.3.4 + TypeScript 5.8.2 的单窗口工作台外壳，重点是布局、面板、模态、焦点、窗口尺寸、状态展示、可访问性和跨进程边界。

**Decision policy**: 本文只记录候选与研究依据，不批准任何新依赖、包版本或平台实现。每个决策区块都明确写为 `Decision: NEEDS DECISION`。最终选择须在实现前检查 peer dependency、许可、版本锁定、bundle 影响、Electron runtime 和 CI 平台覆盖。

## 当前基线

当前 `package.json` 已有：Electron `40.10.5`、React/React DOM `^19.0.0`、TypeScript `^5.8.2`、Vite `^6.2.2`、Bun `1.3.4` package manager。当前没有 overlay、state、UI kit、DOM testing 或 E2E 额外包。foundation 已经在 `BrowserWindow` 设置 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`，并设置 1200×800 / 最小 960×640。

官方资料：

- [Electron BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window)：原生窗口尺寸、`setMinimumSize`、`webPreferences` 和平台差异。
- [Electron Process Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox)：sandbox 与 context isolation 的边界说明。
- [React built-in APIs](https://react.dev/reference/react/apis)、[`useReducer`](https://react.dev/reference/react/useReducer)、[`useContext`](https://react.dev/reference/react/useContext)：不增加依赖的状态基础。
- [WAI-ARIA APG Modal Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)：modal inert、Tab/Shift+Tab、Escape、初始焦点和关闭后焦点返回。

## 评价标准

1. 能否覆盖本 spec 的 focus trap/return、Escape、outside click、background inert/scroll lock 和单活动面板要求。
2. 能否在 React 19、StrictMode、TypeScript strict、Vite renderer 和 Electron sandbox renderer 中工作。
3. 是否把 Node/Electron 能力留在 main/preload，不把库的运行时对象跨边界暴露。
4. 是否能用 Bun 安装/运行且不强迫改变现有 build/test 分层。
5. 维护活跃度、官方文档质量、升级/peer dependency 风险、bundle 和样式成本是否可控。
6. 能否在 fixture 和真实 Electron runtime 中验证失败边界，而不是只凭组件快照。

## 决策区块 A：浮层、模态与焦点 primitives

### 候选 A — Radix UI Primitives

- **适用范围**：无样式的 Dialog、Popover、Portal、FocusScope 等交互 primitives；由项目自行完成视觉样式和布局。
- **优点**：官方 Dialog 文档明确覆盖 modal/non-modal、自动 focus trap、screen reader title/description、Escape、outside interaction、open/close focus hooks；与当前“壳层只定义交互、样式自有”方向相符。
- **风险**：需要核对当前推荐包入口和具体包拆分、React 19 peer dependency、Portal 在 Electron renderer 中的 stacking/scroll 规则；无样式意味着 a11y 正确不等于视觉/响应式已完成。版本/API 迁移需要在 lockfile 中明确。
- **与当前栈适配**：只进入 renderer，Vite/TypeScript 可直接消费类型；不触碰 preload/main。官方当前组件页显示版本信息，但实现前仍须按接受的版本策略复核。
- **一手资料**：[Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog)。

### 候选 B — React Aria Components / React Aria

- **适用范围**：无样式 React components/hooks，覆盖 Dialog/Popover、键盘交互、focus、国际化和 assistive technology 行为，允许项目自行 CSS。
- **优点**：官方文档强调 behavior/accessibility 内建、组件组合和自定义样式；官方 release notes 记录 React 19 相关支持和持续维护；适合把可访问行为与视觉设计分离。
- **风险**：API 面较大，需区分 React Aria Components 与 React Spectrum/Spectrum 2；引入的包和 bundle 面积可能超出只有 shell 的最小需求；需要核对 React 19、Vite、Bun、SSR/StrictMode（本项目虽非 SSR）组合。
- **与当前栈适配**：renderer-only；可采用 vanilla CSS，不要求引入设计系统；候选包的 exact peer ranges、tree-shaking 和 Electron runtime 行为必须在安装后验证。
- **一手资料**：[React Aria getting started](https://react-spectrum.adobe.com/react-aria/)、[React Spectrum Dialog/Popover reference](https://react-spectrum.adobe.com/Dialog)、[React Aria 2025 release notes](https://react-spectrum.adobe.com/v3/releases/2025-07-22.html)。

### 候选 C — Ariakit

- **适用范围**：无样式、可组合的 Dialog/Popover/Disclosure/Focusable/Portal 等 React 组件与 store。
- **优点**：Dialog 文档明确提供 `autoFocus`、`finalFocus`、Escape、outside interaction、modal、prevent body scroll 等控制点，适合工作台复杂焦点回收。
- **风险**：项目团队对其 API、生态和升级节奏的熟悉度需评估；可组合能力也意味着更容易把 modal、panel 和 nested dialog 组合出未定义行为；仍须核对 React 19 peer range、Electron runtime 和 CSS 责任。
- **与当前栈适配**：renderer-only，TypeScript/React 组合适配；不需要把 Ariakit store 暴露到 preload。
- **一手资料**：[Ariakit Dialog reference](https://ariakit.org/reference/dialog)、[Ariakit Dialog examples](https://ariakit.org/components/dialog)。

**Decision: NEEDS DECISION**。必须先定义首版需要的 primitive surface（仅 modal/panel 还是包括 menu/tooltip）、是否接受自建 focus/scroll 逻辑、React 19 peer 版本、bundle 上限和 a11y runtime 覆盖，再在 A/B/C 或“React built-ins + native `<dialog>`”之间选择。WAI-ARIA APG 是行为最低基线，不因选择库而降低要求。

## 决策区块 B：工作台状态编排

### 候选 A — React built-ins (`useReducer` + `useContext`)

- **适用范围**：shell 的 `activePanel`、`activeModal`、focus origin、layout mode、save status presentation 和错误摘要等有限状态。
- **优点**：零新依赖；状态和事件可直接建模为 discriminated union；与现有 React 19、StrictMode、TypeScript 和 Vite 完全一致；最符合 Constitution III 的最小演进。
- **风险**：跨多个 feature owner 的异步状态、订阅粒度和调试约定需要团队自己定义；若把所有业务状态放入 Context，可能扩大重渲染和耦合。
- **适配**：当前栈最直接；不改变 package.json；可先把纯 reducer 作为稳定内部 contract。
- **一手资料**：[React `useReducer`](https://react.dev/reference/react/useReducer)、[React `useContext`](https://react.dev/reference/react/useContext)。

### 候选 B — Zustand

- **适用范围**：小型全局/跨组件 shell store，按 selector 订阅面板、modal、状态和 feature registration。
- **优点**：官方文档定位为小、快、hooks-first、无需 provider，并有 selector、persist、devtools 和 TypeScript guide；可减少深层 Context 重渲染。
- **风险**：引入全局 mutable store 后，边界、初始化、测试隔离、跨项目重置和持久化误用需要额外约束；`persist` 不能未经 ADR 直接成为项目真相；React 19 peer range 和 Bun lockfile 需核对。
- **适配**：TypeScript 类型支持明确；Bun 可作为包管理器，但未安装前不改变 lockfile；只允许存 shell state，不存 secret/path/content。
- **一手资料**：[Zustand introduction](https://zustand.docs.pmnd.rs/)、[Zustand TypeScript guide](https://zustand.docs.pmnd.rs/learn/guides/advanced-typescript)、[Zustand reference](https://zustand.docs.pmnd.rs/reference/index)。

### 候选 C — XState v5 + `@xstate/react`

- **适用范围**：将 panel/modal/save/recovery 的事件、guard、异步 owner 状态和恢复路径表达为显式 state machine/actor。
- **优点**：官方文档强调事件驱动、statecharts、actor、可视化和可预测 transitions；XState v5 文档明确要求 TypeScript 5.0+，当前 TS 5.8 满足基础要求。
- **风险**：对当前仅有四区 shell 可能过重；增加两个相关 package、学习曲线和序列化/rehydration 约束；不能把 actor 状态直接跨 Electron IPC；v4/v5 迁移与工具支持需锁定。
- **适配**：React integration 和 Bun 安装路径有官方示例；Electron main/preload 不需要依赖它，除非另有跨进程 orchestration 需求（本 feature 不要求）。
- **一手资料**：[XState overview](https://stately.ai/docs/xstate)、[XState React](https://stately.ai/docs/xstate-react)、[XState quick start/TypeScript requirement](https://stately.ai/docs/quick-start)。

**Decision: NEEDS DECISION**。首选判断顺序应是：先用 A 是否足够表达接受后的状态/失败边界；只有真实异步恢复、嵌套模态或跨 owner 状态复杂度证明需要，才考虑 B/C。禁止仅因为“以后可能复杂”提前引入全局库或 state machine。

## 决策区块 C：样式与布局能力

### 候选 A — 现有 CSS + CSS Grid/Flex + CSS variables

- **适用范围**：四区 shell、宽/窄窗口、scroll container、overlay layer、focus ring 和状态色/图标 token。
- **优点**：零新依赖；完全控制 Electron renderer 的布局、主题、滚动和最小窗口；与当前 `styles.css` 直接兼容。
- **风险**：需要自建 token、响应式约定、层叠规范和视觉回归策略；手写 focus/disabled/error 样式容易遗漏。
- **适配**：与 Vite/React 19/Bun/TS 无额外耦合；最符合最小方案。

### 候选 B — Vite CSS Modules

- **适用范围**：将 shell 组件样式按文件隔离，避免下游 feature 与 shell class name 冲突。
- **优点**：Vite 已支持常规 CSS module 处理；不要求 UI framework；组件边界更清晰。
- **风险**：global tokens、portal 内容、focus-visible 和跨区域 layout 仍需明确 global/local 约定；迁移现有 `styles.css` 会增加一次结构调整。
- **适配**：renderer-only，不改变 Electron/preload；需要在 TS 配置和 Vite build 中确认 CSS module typing 习惯。

### 候选 C — utility/UI design-system package

- **适用范围**：通过现成 token、utility 或组件主题快速建立视觉系统。
- **优点**：可减少重复样式，可能提供 focus/high-contrast token；若团队已有设计系统可加速一致性。
- **风险**：当前没有 design system 约束；可能引入大量 CSS、构建插件和库耦合；现成组件的 modal/panel 行为未必与选定 overlay primitive 一致。
- **适配**：需要单独评估 Vite 6、Electron bundle、Bun、React 19 和可访问性语义，不应与浮层候选同时默认引入。

**Decision: NEEDS DECISION**。在接受 design tokens、portal/overlay 样式约定和视觉回归方法前，A 是可执行基线；B/C 只能在能证明降低风险或满足明确设计系统要求时进入依赖。

## 决策区块 D：测试与 runtime harness

### 候选 A — 现有 Bun test + DOM/UI testing 能力

- **适用范围**：继续使用 `bun:test` 做纯 reducer、shared contract 和轻量 DOM/UI 测试；保持 `bun run test` 不变。
- **优点**：无需新增 runner；Bun 官方文档说明内置 runner 支持 TypeScript/JSX、UI/DOM testing、mock、snapshot 和 watch；当前仓库已有 test script。
- **风险**：Bun Jest compatibility 并非完整；真实 Electron 窗口、原生对话框和辅助技术行为不能由 Bun DOM 单测证明；需要确认当前 Bun DOM 环境与所选 React/a11y library 兼容。
- **适配**：Bun 1.3.4 是现有基础；不联网安装即可研究，实施时仍需 fixture。
- **一手资料**：[Bun test runner](https://bun.sh/docs/test)。

### 候选 B — React Testing Library + user-event（配现有 runner 或另选 runner）

- **适用范围**：以 role/name/visible text 和用户键盘语义验证 panel/modal/focus/status，不依赖组件实现细节。
- **优点**：官方原则是测试更接近真实使用；适合验证 dialog role、accessible name、Tab、Escape 和状态文本；可以与多种 runner 配合，不强制 Jest。
- **风险**：它不是 test runner；需决定 DOM environment、user-event timers 和 Bun compatibility；不能单独验证 BrowserWindow/preload/main。
- **适配**：React 19/TypeScript 类型路径成熟；需在不安装的前提下保留为候选，并在实现前做 peer/DOM environment spike。
- **一手资料**：[React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)、[user-event](https://testing-library.com/docs/user-event/intro/)。

### 候选 C — Playwright Electron automation

- **适用范围**：真实 Electron launch、窗口 DOM、键盘/鼠标、截图和 runtime IPC/failure boundary。
- **优点**：官方 Electron API 支持从真实应用打开第一个窗口并交互；可通过 `electronApplication.evaluate` 替换 native dialog，让 fixture 测试不依赖 OS 原生 UI。
- **风险**：官方明确标为 experimental；不拦截 native Electron dialog，需主动 mock；会增加 browser binary/CI/platform 成本；不能把它当作唯一的 accessibility oracle。
- **适配**：Electron 40 在官方支持范围内，但要按候选版本锁定 Playwright；Bun 可执行脚本但需验证 runner/ESM/child process 行为；renderer 仍保持 sandbox。
- **一手资料**：[Playwright Electron API](https://playwright.dev/docs/api/class-electron)。

**Decision: NEEDS DECISION**。最低方案是 A；若 DOM 语义复杂则评估 B；若要证明窗口/preload/renderer 真实交互则需要 C 或等价 runtime harness。最终方案必须保留现有 `bun run test:smoke`，不能用 DOM 测试替代 Electron runtime smoke。

## 决策区块 E：原生窗口尺寸与响应式策略

### 候选 A — 当前静态 BrowserWindow bounds + renderer CSS 响应式

- **适用范围**：main 在创建窗口时使用 1200×800 和最小 960×640；renderer 根据 viewport 切换宽/窄 shell layout。
- **优点**：当前 foundation 已存在；边界简单、无需额外 IPC；符合“窗口由 main 管理，布局由 renderer 管理”。
- **风险**：若未来需要动态最小尺寸、用户偏好或平台专用 chrome，静态配置表达不了；CSS 不能解决 native window manager 限制。
- **适配**：Electron 40、React 19、Vite、Bun 全部无新依赖；建议作为 default baseline。

### 候选 B — main-owned `setMinimumSize`/`setSize` named method

- **适用范围**：运行时按模式改变原生最小尺寸或恢复窗口 bounds。
- **优点**：Electron 官方支持 `setMinimumSize`、`setSize`；原生约束集中在 main，renderer 只请求有限语义。
- **风险**：引入新的 IPC contract、权限/输入校验、跨平台差异和测试成本；Wayland 可能限制程序化 resize；shell feature 可能不需要。
- **适配**：不影响 renderer sandbox，但必须冻结 DTO、白名单尺寸和错误码；不能接受任意 width/height。

### 候选 C — 平台/DPI 自适应窗口策略

- **适用范围**：依据 display/DPI/OS chrome 在 main 计算 bounds，或为平台提供专门策略。
- **优点**：可处理更多设备和平台差异。
- **风险**：超出当前 shell 需求，增加屏幕、Wayland、窗口恢复和跨平台测试面；容易把布局问题错误地交给原生层。
- **适配**：需 Electron `screen`/display API、main lifecycle 和额外 runtime coverage；本 feature 没有要求。

**Decision: NEEDS DECISION**。在没有明确动态窗口需求前，保留 A；B/C 必须由具体需求、ADR/contract 和平台测试证明其必要性。

## 兼容性与版本策略记录

| 现状 | 适配判断 | 仍需决定/验证 |
|---|---|---|
| Electron 40.10.5 | BrowserWindow 能提供现有 min size、安全 webPreferences 和 main-owned 原生能力 | 选定 harness 对 Electron 40 的支持；macOS/Windows/Linux/Wayland 覆盖；是否需要新增 window IPC |
| React 19 | React built-ins 直接适配；候选 UI/state libraries 需核对 peer range 和 StrictMode 行为 | 版本范围、是否允许 major upgrade、候选包的 React 19 smoke |
| TypeScript 5.8.2 | 当前 strict config 可承载 discriminated union；XState v5 官方要求 TS 5+，满足最低要求 | exact package types、isolated modules、preload NodeNext 与 renderer Bundler 的边界 |
| Bun 1.3.4 | 当前是 package manager/test runner；官方 runner 支持 TS/JSX/UI/DOM testing | 选定包的 Bun install/test/build 行为；不能未经用户决策修改 lockfile |
| Vite 6.2.2 | 现有 renderer build 可承载 CSS/CSS Modules 候选 | CSS module typing、portal CSS、bundle size 和 production build |
| Electron sandbox renderer | 所有 UI 候选应为纯 renderer JS；不能访问 Node | package 是否意外依赖 Node-only API；compiled preload 暴露面和 CSP/外链策略 |

## 结论与待决事项

本轮可以落地的架构结论是：稳定 shell、稳定编辑内容槽位、显式 typed UI state、main-owned project/storage、preload named bridge、真实 Electron failure-boundary 验证。不能在本轮落地的选择包括：

- overlay/focus library：候选 A/B/C，`Decision: NEEDS DECISION`；
- state library：候选 A/B/C，`Decision: NEEDS DECISION`；
- CSS/设计系统：候选 A/B/C，`Decision: NEEDS DECISION`；
- DOM/runtime test harness：候选 A/B/C，`Decision: NEEDS DECISION`；
- 动态原生窗口 API、shell UI preference persistence、具体 IPC/DTO/error code、版本锁定和迁移策略：`Decision: NEEDS DECISION`。

这些事项已在 [checklists/plan-decisions.md](./checklists/plan-decisions.md) 转成需求/计划质量问题，供用户在实现前逐项确认。
