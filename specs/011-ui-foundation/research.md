# Research: 共享 UI Foundation

**Research date**: 2026-07-12

**Scope**: WriteLLM v2 的 Electron 43 + React 19 + Vite 8 renderer；研究 shadcn/ui source-owned component model、样式/token、primitive、主题、可访问性、测试与升级策略。

**Policy**: 本文做出计划建议，但不安装任何依赖。exact package versions 必须在 spec/plan/ADR 接受后的 implementation tasks 中解析并锁定；官方文档里的 `latest` 命令仅作为能力证据，不作为本项目可重复执行命令。

## Current baseline

- 当前 `package.json` 只有 Electron、React/React DOM 与 Vite/TypeScript 工具，没有 UI kit、CSS framework、icon、DOM testing 或 headless primitive dependency。
- 当前 `src/renderer/styles.css` 手写全局色值与 component-like classes；`LaunchPage.tsx` 使用原生语义控件并已实现 001 行为。
- Vite config 目前只有 React plugin；renderer tsconfig 使用 Bundler resolution 且未配置 alias。
- 001 已 Accepted 并实现；002 的 plan 仍把 design-system choice 标为 `NEEDS DECISION`，因此 011 可以在 002 实现前统一解决。

## Decision 1: shadcn as source-owned architecture

**Decision**: 采用 shadcn/ui 的源码生成与本地所有权模式，而不是安装一个黑盒组件包或运行项目自有的远程 registry。初始化时应用经审查的 Rhea + Base UI preset，`components.json` 作为 CLI 生成配置，组件进入 `src/renderer/components/ui` 后由 WriteLLM 审查、测试和维护。初始化会在 generation time 读取 shadcn registry，但产品运行时不依赖 registry。

**Rationale**:

- 官方 Vite 指南支持 existing Vite project，并将组件源码添加到项目目录。
- `components.json` 是使用 CLI 添加组件时的配置，描述生成位置、aliases、style 与 semantic CSS variables；它不是运行时服务。
- 这符合用户要求的 shadcn/ui 风格与组件体系，也允许 Electron renderer 保持本地、离线和可审查。
- 2026-05 后的 `shadcn init` 可能引入 `shadcn/tailwind.css` 构建依赖；本计划在预设应用后运行同版本的 `shadcn eject`，将该 CSS 内联为项目源码并移除 `shadcn` package，然后审查 diff。Base UI 和 utilities 仍是正常的锁版运行时依赖。

**Alternatives considered**:

- 直接使用已发布 UI component package：减少本地源码，但定制/升级受 package API 控制，不符合 source-owned shadcn 模式。
- 自建远程/private registry：当前只有一个 renderer consumer，增加发布、鉴权和版本治理，无实际收益。
- 继续手写 feature CSS/component：无法建立跨 feature 一致的 token、focus 和升级规则。

**Official sources**:

- [shadcn/ui Vite installation](https://ui.shadcn.com/docs/installation/vite)
- [shadcn/ui components.json](https://ui.shadcn.com/docs/components-json)
- [shadcn/ui eject](https://ui.shadcn.com/docs/changelog/2026-05-shadcn-eject)

## Decision 2: Tailwind CSS v4 + semantic CSS variables

**Decision**: 使用 Tailwind CSS v4 的 Vite plugin 路径；主题以 CSS variables 表达，feature 只使用 semantic utilities/tokens。选择 Rhea 作为初始紧凑产品界面风格，并以 neutral base 建立 WriteLLM 主题值。

**Rationale**:

- 当前 shadcn Vite 官方路径为 Tailwind + `@tailwindcss/vite`。
- 官方 theming 指南推荐 CSS variables，允许通过 `background`, `foreground`, `primary` 等 semantic roles 改变外观而不重写组件 class。
- 官方将 Rhea 描述为面向 focused product interfaces 的更紧凑风格；适合桌面 workspace 的信息密度，同时不改变全局 spacing scale。

**Alternatives considered**:

- 保留纯手写 CSS：依赖最少，但会让导入组件与跨 feature variants 重复适配，且 002 已明确需要 design-system 决策。
- CSS Modules：适合 feature isolation，但不能单独提供 shadcn registry 期望的 token/utility 工作流；可在未来用于特殊 feature layout，不作为基础组件主路径。
- 更宽松/展示型 preset：启动页可用，但 workspace shell 的密度更差；Rhea 仍可通过 semantic tokens 调整品牌气质。

**Official sources**:

- [shadcn/ui Vite installation](https://ui.shadcn.com/docs/installation/vite)
- [shadcn/ui theming](https://ui.shadcn.com/docs/theming)
- [shadcn/ui May 2026 Rhea changelog](https://ui.shadcn.com/docs/changelog/2026-05-rhea)

## Decision 3: Base UI as the headless primitive base

**Decision**: 新 foundation 使用 shadcn 的 Base UI variant，并通过 `components/ui` 隔离 feature 对底层 primitive 的直接依赖。

**Rationale**:

- 2026-07 官方更新将 Base UI 设为新项目默认，并明确推荐新项目使用；官方同时说明 Radix 仍受支持。
- WriteLLM 尚未建立 UI primitive，因此不存在迁移成本；这是选择当前默认的合适时点。
- shadcn 对 Base UI 与 Radix 保持相同高层 component abstraction，未来评估不要求 feature 直接 import 底层包。

**Alternatives considered**:

- Radix：成熟且 shadcn 继续支持，但当前新项目不再是默认；本仓库没有遗留 Radix 资产需要保留。
- 原生元素手写 dialog/tooltip/focus：依赖更少，但模态 focus containment、portal、dismiss 与跨平台键盘细节会重复实现。

**Official sources**:

- [shadcn/ui July 2026: Base UI as the default](https://ui.shadcn.com/docs/changelog)
- [shadcn/ui Base UI documentation announcement](https://ui.shadcn.com/docs/changelog/2026-01-base-ui)

## Decision 4: persisted System/Light/Dark appearance preference

**Decision**: 提供 `system | light | dark` 三种 theme mode，默认 `system`。Main 在创建窗口前从版本化 `appearance-preferences.json` 读取偏好并设置 `nativeTheme.themeSource`；renderer 通过独立两方法 typed appearance bridge 读写标准化 DTO。不使用 localStorage 或项目文件。

**Rationale**:

- 用户明确要求主题切换和重启保留；这是应用偏好，不是项目或文档真相。
- main-owned 验证、原子写入和启动前 `nativeTheme` 应用提供可预测的首帧和损坏回退，同时不让 renderer 接触路径/文件。
- 独立 `window.writellmAppearance` 保持 001 `window.writellm` 六方法 project bridge 原封不动。

**Alternatives considered**:

- light/dark/system + localStorage：实现小，但没有 main validation、版本化 atomic owner 或可一致应用的 Electron startup theme。
- renderer class-only toggle：无需 IPC，但可在首帧显示错误主题，且不能统一 `nativeTheme`。
- only light theme：无法满足用户明确提出的 theme foundation 与深色环境一致性。

**Official source**:

- [shadcn/ui dark mode for Vite](https://ui.shadcn.com/docs/dark-mode/vite)

## Decision 5: accessibility contract is project-owned

**Decision**: 基础组件必须保留正确 native semantics，并为 dialog/tooltip 等复杂模式验证 accessible name、keyboard operation、visible focus、focus containment/return、inert background 与 reduced motion。使用 primitive 不替代 WriteLLM 自己的 acceptance tests。

**Rationale**:

- WAI-ARIA APG 要求 modal background inert、Tab/Shift+Tab 留在 dialog、Escape 关闭、打开时移入焦点，并在关闭后合理恢复。
- WAI-ARIA APG 的 tooltip pattern 仍标记为 work in progress，但其 focus/hover 展示、`role=tooltip`、`aria-describedby`、Escape/blur dismiss 与焦点保留规则可作为本项目的明确合同输入；tooltip 只补充发现性，不能成为 icon control 的唯一名称。
- 001 已有语义控件和可见 focus，迁移必须保持而不是假设生成组件天然满足所有 app context。

**Alternatives considered**:

- 只依赖 primitive upstream tests：无法覆盖 WriteLLM composition、portal root、CSP、theme variants 和 Electron runtime。
- 只做 snapshot：不能证明 keyboard/focus/role contract。

**Official sources**:

- [WAI-ARIA APG modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [WAI-ARIA APG tooltip pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/)
- [shadcn/ui Tooltip (Base UI)](https://ui.shadcn.com/docs/components/base/tooltip)

## Decision 6: two-level verification with a dedicated compiled runtime harness

**Decision**: component/launch DOM tests 使用 Bun 官方支持的 Happy DOM + React Testing Library + `user-event`。增加独立的 compiled UI fixture 和 Electron test entry：它使用与产品一致的 sandbox/preload/CSP 加载已构建 renderer，通过 Electron `webContents.sendInputEvent` 执行原生 Tab/Shift+Tab/Escape，通过 `executeJavaScript` 检查 active element、roles、portal、inert 与焦点恢复，通过 `nativeTheme.themeSource` 和 `webContents.debugger` 的 CDP media emulation 验证运行中 color scheme、reduced motion 与 forced colors。不引入完整 browser automation framework 或 image snapshot service。

**Rationale**:

- Bun 官方提供 Testing Library + Happy DOM setup guidance，适合 role/name/state 与 event tests；`user-event` 更适合表达用户级键盘流。
- 当前 `scripts/electron-smoke.mjs` 只验证 compiled bridge 和 lifecycle，不具备 DOM/UI 控制能力。独立 fixture/harness 使 runtime 验证可执行，同时不往产品 main/preload 注入测试能力。
- 不引入另一套 test runner，保持最小演进。

**Alternatives considered**:

- 仅 Happy DOM：不能可靠覆盖 Chromium portal/layout/computed style 和 Electron bridge。
- 新增 Playwright Electron：能力更强，但当前只有一个 launch migration；可在 002 复杂 shell 需要时另行评估。
- screenshot goldens：主题视觉差异可见，但跨平台字体/渲染噪声与维护成本高；首版使用 token/DOM/runtime assertions + quickstart visual review。

**Official sources**:

- [Bun: Using Testing Library](https://bun.sh/docs/guides/test/testing-library)
- [Bun: DOM testing](https://bun.sh/docs/test/dom)
- [Electron webContents](https://www.electronjs.org/docs/latest/api/web-contents)
- [Electron nativeTheme](https://www.electronjs.org/docs/latest/api/native-theme)
- [Electron Debugger](https://www.electronjs.org/docs/latest/api/debugger)

## Decision 7: minimal initial component inventory

**Decision**: 初始只生成 11 primitives：Button, Input, Label, Card, Alert, Badge, Separator, Dialog, Tooltip, Scroll Area, Select；项目自写 4 个 business-neutral/controlled patterns：FormField, StatusNotice, EmptyState, AppearanceControls。

**Rationale**:

- Button/Input/Label/Card/Alert/Badge 覆盖 001 的现有表现层。
- Dialog/Tooltip/Separator/Scroll Area 覆盖 002 已在 Draft design 中明确的 modal、icon discoverability、region separation 和 constrained content needs。
- pattern 层避免在多个 feature 重复 field/status/empty composition，但不预先实现 WorkspaceShell。
- Select/AppearanceControls 是已接受的 System/Light/Dark 入口，也为后续 settings 复用；pattern 是 controlled 的，不直接读 IPC。

**Alternatives considered**:

- 添加完整 shadcn catalog/blocks：增加未使用依赖与维护面。
- 直接添加 Sidebar/Sheet/Resizable：002 尚未接受具体 shell primitive，可能提前冻结错误抽象。
- 只迁移 001 所需组件：无法达到“为 002 提供基础”的用户目标，且 dialog/focus 规则仍未建立。

**Official source**:

- [shadcn/ui component catalog](https://ui.shadcn.com/docs/components)

## Decision 8: source-owned shadcn/typeset for editor prose

**Decision**: 采用 2026-07 发布的 shadcn/typeset 作为 HTML/Markdown 的共享排版层。Builder 输出的 `typeset.css` 进入仓库，定义 `typeset-editor` (16px/1.75/1.25em), `typeset-reading` (18px/1.9/2em), `typeset-compact` (14px/1.6/1em)；preference 以 body/heading/mono font IDs 与 size/leading/flow 变量调整呈现。

**Rationale**:

- Typeset 是一份项目所有的 CSS，不增加 runtime package，与 shadcn source-owned 方向一致。
- 它使用应用 theme/font/radius tokens，可针对编辑、阅读和紧凑场景定义多个 preset，同时不占有容器宽度。
- 它为 streaming append 避免使用会让旧 block 重新匹配的 selectors，适合未来 AI/editor 流式内容。
- 用户偏好只改变 CSS variables，不改变 Markdown/HTML 或导出语义。

**Alternatives considered**:

- 旧 Typography 页的 utility examples：可复制，但官方明确不默认发布 typography styles，也没有共享 rhythm/streaming contract。
- `@tailwindcss/typography`：成熟，但使用固定 rem scale/独立 prose palette；Typeset 直接跟随容器和应用 tokens。
- 每个 editor/chat/docs feature 手写 prose CSS：会重复标题、列表、表格、代码和 spacing 决策。

**Official sources**:

- [shadcn/typeset documentation](https://ui.shadcn.com/docs/typeset)
- [July 2026: Introducing shadcn/typeset](https://ui.shadcn.com/docs/changelog/2026-07-typeset)

## Compatibility and version policy

| Area | Plan | Acceptance-time check |
|---|---|---|
| React 19.2.7 | 保持现有 exact version | Base UI、generated components、StrictMode smoke |
| TypeScript 7.0.2 | 保持 renderer Bundler resolution | generated types、aliases、isolatedModules |
| Vite 8.1.4 | 增加 Tailwind v4 plugin，保留 `base: './'` | dev/build paths、Electron file loading、CSP |
| Bun 1.3.14 | 继续 package manager/test runner | exact lock、DOM preload、all scripts |
| Electron 43.1.0 | 新增 main-owned preference repository/nativeTheme 与独立两方法 preload bridge | first paint, storage failure, compiled portal/focus/theme/preload smoke |
| shadcn CLI | 仅 implementation-time source generator | pin one exact version for preset/init/add/eject and review every generated diff |
| Base UI + utilities | 只装生成组件实际 import 的 packages | exact versions, licenses, bundle delta, no Node-only renderer code |
| DOM test stack | Happy DOM + Testing Library + user-event | exact versions, React 19 peer compatibility, Bun 1.3.14 preload/cleanup probe, test tsconfig coverage |

## Research conclusion

所有 Technical Context architecture unknowns 已解析；没有残留 `NEEDS CLARIFICATION`。维护者已通过三轮问答接受 theme/appearance persistence、Typeset、font/rhythm model、IPC 与验证方向。Exact package versions 是首个 implementation task 在任何安装前的可重复锁定输出，不是待定架构选择。
