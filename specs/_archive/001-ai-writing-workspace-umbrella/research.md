# Research: WriteLLM v2 工作区 UI 与编辑器技术链

## Research scope

本阶段解决用户新增的整体界面、组件库、block-based editor、modal/panel 交互、设置 secret 以及 Electron 边界问题，同时保留原 spec 对可移动项目、Markdown canonical content 和 Git history 的约束。研究结论用于 Phase 1 的 UI contract 和 data model；PDF 解析、embedding provider 和 AI provider 本身仍属于后续切片。

## Decision 1: 将 “SharedCNUI” 解释为 shadcn/ui，并采用源码归属模式

**Decision**: 本计划把用户输入中的 “SharedCNUI” 解释为 `shadcn/ui`。官方搜索和文档中没有可验证的 “SharedCNUI” 项目；`shadcn/ui` 与用户描述的 React component library 意图最接近。采用 Vite + React 方式，把组件源码直接加入仓库；组件 style 选择 `new-york`，并固定 `Radix` variant 以兼容 BlockNote 官方 `@blocknote/shadcn` 适配层，而不是在运行时依赖一个黑盒 UI package。

**Rationale**:

- shadcn/ui 的核心是 open code、composition 和可修改的组件源码，这正好适合需要大量产品化 panel/editor/modal 适配的桌面写作应用。
- 当前官方文档说明组件通过 CLI 加入项目的 `components/ui/`，可以直接修改；这也让后续 AI coding agent 能读到真实实现，而不是只读第三方类型声明。
- 2026-07 的官方 changelog 将 Base UI 作为 shadcn 新项目默认选择，同时保留 Radix 支持；但 BlockNote 官方 shadcn 文档仍按 shadcn/Radix component modules、`shadCNComponents` 和 no-Portal 约束集成。由于 editor 是 WriteLLM 的核心，优先选择官方已明确互操作的 Radix variant，并通过 `shadcn init -b radix` 固定下来。

**Alternatives considered**:

- `Base UI + 自建组件层`：是 shadcn 新项目的默认路径，但当前 BlockNote shadcn adapter 没有独立的 Base UI contract；若未来官方补齐适配，可以按组件粒度迁移，但首版不混用两套 primitives。
- MUI、Ant Design、Mantine：提供更多开箱即用组件，但更难把写作 paper surface、floating panel 和桌面密度统一到产品语义；同时会把主题覆盖和依赖升级交给外部 runtime。
- 纯 CSS：依赖少，但要自行维护 Dialog focus trap、Popover positioning、keyboard behavior 和一致的 disabled/error states，不符合最小可靠实现。

**References**: [shadcn/ui Introduction](https://ui.shadcn.com/docs)、[Vite installation](https://ui.shadcn.com/docs/installation/vite)、[shadcn changelog](https://ui.shadcn.com/docs/changelog)、[BlockNote ShadCN integration](https://www.blocknotejs.org/docs/getting-started/shadcn)。

## Decision 2: Tailwind CSS v4 + semantic CSS variables 是主题层

**Decision**: 使用 Tailwind CSS v4 的 Vite plugin，shadcn/ui 组件使用 CSS variables 暴露 semantic tokens；默认 `new-york` style、neutral/warm palette、dark-first chrome 和单独的 `editor-surface` token。使用 `tw-animate-css` 承载进入/离开动画，避免在每个 panel 内手写动画。

**Rationale**:

- 用户需要一套可复用模板，semantic tokens 比散落的 hex 值更容易支持 dark/light、紧凑/舒展密度和 editor paper surface。
- Tailwind v4 的官方 shadcn 路线不再需要传统 `tailwind.config.js`；现有 Vite 项目只需加入 `tailwindcss`、`@tailwindcss/vite` 和 CSS import，改动边界清晰。
- Tailwind 只负责布局和状态组合；交互行为仍由 Radix/shadcn source components 承载，避免把 UI 逻辑埋在 utility class。

**Alternatives considered**:

- Tailwind v3：可行，但在当前 React 19/新项目上会沿用旧配置；没有强理由承担升级路径。
- CSS Modules：适合局部组件，但跨 shell、editor、modal 的 token 和状态组合会变得分散。
- 运行时主题库：增加 bundle 和运行时抽象，且不需要在当前单窗口项目提前引入。

**References**: [shadcn/ui Tailwind v4](https://ui.shadcn.com/docs/tailwind-v4)、[shadcn/ui Vite existing project](https://ui.shadcn.com/docs/installation/vite)、[components.json](https://ui.shadcn.com/docs/components-json)。

## Decision 3: BlockNote 作为 editor engine，产品 schema 拥有 block/citation identity

**Decision**: 使用 `@blocknote/core`、`@blocknote/react` 和 `@blocknote/shadcn`。BlockNote 的默认 schema 提供 heading、paragraph、list、quote、table 等 block；产品通过 `BlockNoteSchema.create().extend(...)` 增加 citation block/inline content、AI proposal marker 和必要的写作 metadata。renderer 使用 BlockNote document 作为 editor session projection，项目磁盘仍以 Markdown 为用户可读 canonical content，并由项目自有 codec 维护稳定 block/citation identity。

BlockNote 官方明确说明 Markdown import/export 是 lossy，建议用 `JSON.stringify(editor.document)` 保存 non-lossy BlockNote document。这个项目仍需 Markdown canonical，因此采用双层策略：BlockNote document 负责编辑体验和结构化 block identity，Markdown codec 负责可读正文/外部工具互操作；identity metadata 不能依赖 `blocksToMarkdownLossy` 的输出。

**Rationale**:

- BlockNote 本身就是 block-based React editor，默认 UX、block side menu、formatting toolbar 和 suggestion menu 与用户要的写作核心高度一致。
- BlockNote 的 `useCreateBlockNote` + `BlockNoteView` 适合做一个 editor stage；官方将 `BlockNoteView` 描述为 uncontrolled component，能够让 editor 自己管理复杂状态，避免每次输入重绘整个工作台。
- BlockNote 提供 custom schema、custom blocks 和 React render implementation，citation、引用来源卡片和 AI proposal marker 可以成为产品级 block，而不是在 DOM 上打补丁。
- 官方提供 `@blocknote/shadcn`，可在已经使用 shadcn/Tailwind 的项目中复用 editor UI，并通过 `shadCNComponents` 注入本项目自有 Button、Popover、Select、Tooltip 等组件；这直接连接了用户指定的 UI component library 和 editor。

**Persistence rule**:

1. 打开项目时 main 读取 canonical Markdown 与结构化 block metadata，codec 生成 BlockNote `PartialBlock[]`，每个顶层 block 有稳定 id 或等价 metadata。
2. renderer 使用 BlockNote document 编辑；selection、focus、drag/reorder 和 unsaved session 只留在 renderer。
3. 保存时 renderer 提交经过 schema validation 的 BlockNote document DTO；main 生成 canonical Markdown、block identity metadata 和相关 JSON，再写入 Git-backed project。
4. `blocksToMarkdownLossy` 只用于显式导出或 clipboard-like preview，不用于覆盖 canonical chapter file。
5. 如果外部 Markdown 缺少、重复或移动 identity，codec 返回 `needs_review`；UI 不能静默把 citation 指向另一个 block。

**Alternatives considered**:

- Tiptap/ProseMirror：底层能力强，但需要自行搭建 block-first UX；BlockNote 已提供用户需要的 block interaction，并且官方有 shadcn integration。
- Lexical：性能和可扩展性好，但需要自行搭建更多 block schema、菜单和 Markdown 边界；当前没有必要承受这份基础设施工作。
- 单纯 Markdown textarea：canonical 简单，但无法提供移动、拆分、合并、块级选区和 AI proposal anchor 所需的交互。

**References**: [BlockNote introduction](https://www.blocknotejs.org/docs)、[React editor setup](https://www.blocknotejs.org/docs/getting-started/editor-setup)、[ShadCN integration](https://www.blocknotejs.org/docs/getting-started/shadcn)、[custom schemas](https://www.blocknotejs.org/docs/features/custom-schemas)、[Markdown import](https://www.blocknotejs.org/docs/features/import/markdown)、[Markdown export](https://www.blocknotejs.org/docs/features/export/markdown)。

## Decision 3a: AI 助手不直接绑定 BlockNote XL AI

**Decision**: 不把 `@blocknote/xl-ai` 作为首版依赖。AI assistant、task、proposal、引用上下文和逐项接受/拒绝由 WriteLLM 自有 feature contract 实现；BlockNote 只提供 block selection、document mutation 和可渲染的 proposal marker/custom block。

**Rationale**:

- BlockNote 官方 AI 文档将 XL AI 标为 early preview，并说明该包属于 copyleft license；闭源/商业使用需要 Business subscription/commercial license。当前项目尚未接受该授权边界，不应把它隐式带入基础依赖。
- 现有 spec 要求“先提案、后接受”、记录资料依据、区分 human/model actor 和 Git revision；这些都是产品领域逻辑，不应该由 editor package 决定。
- 自有 contract 可以在未来替换模型提供商、实现 streaming 或 RAG，而不让 editor UI API 绑定到某个 AI SDK。

**Alternatives considered**:

- 直接采用 `@blocknote/xl-ai`：更快看到 demo，但引入授权、preview API 和产品行为绑定；只有在 license/商业采购被单独接受后才可重新评估。
- 直接在 block 内调用 provider：会把 secret、网络错误和任务生命周期塞进 editor component，违反 main-owned provider boundary。

**Reference**: [BlockNote AI integration and licensing](https://www.blocknotejs.org/docs/features/ai)。

## Decision 4: 一个持久 shell，使用 panel/modal registry，不先引入路由框架

**Decision**: renderer 顶层只保留 `launch` 和 `workspace` 两个 view。进入 workspace 后，使用固定的 `WorkspaceHeader`、`ToolRail`、`EditorStage`、`QuickActionBar` 和 `ModalHost`；rail tools 打开 anchored floating panel，顶部和底部 command 打开命名 modal 或 sheet。首版不引入 React Router、TanStack Router 或多窗口。

**Rationale**:

- 用户的核心心智模型是“一个写作台”，不是从 page A 跳到 page B；持续保留 editor instance 可以减少失焦、selection 丢失和 shell 重建。
- panel/modal 状态天然适合 `activeTool` 和 `openModal` union，不需要 URL 作为持久化边界。
- 将 Dialog、Sheet、Popover、Tooltip、Command 和 ScrollArea 统一由 shadcn source components 提供，能把焦点、Escape、outside click、scrim 和背景滚动锁定行为集中验证。

**Interaction rules**:

- 同一时间最多一个 rail panel；再次点击 active tool 关闭它，点击另一个 tool 切换内容但不重建 shell。
- modal 打开时背景加 scrim + 轻量 blur，锁定背景滚动，焦点进入 modal，Esc 恢复触发按钮焦点；危险确认可以作为同一 modal 的 nested step，不建立多个遮罩。
- QuickActionBar 常驻但不覆盖编辑列；当窗口变窄时只保留 icon + tooltip，仍提供 keyboard shortcut。
- top project switcher 和 settings 都是 explicit command，不允许把 UI route 直接变成 filesystem path 或 secret access。

**Alternatives considered**:

- 每个功能一个 route/page：适合多页面 web app，但会复制 app chrome，并让桌面编辑上下文频繁卸载/挂载。
- 每个 panel 一个独立 Electron window：焦点和跨窗口 state 更复杂，且用户只要求浮动界面，不要求可分屏的原生窗口。
- 纯 Popover：大资料库/历史 diff/AI proposal 不够承载；使用 Popover 处理小菜单，用 Dialog/Sheet 处理大内容。

## Decision 5: React reducer/context 管理 shell，BlockNote 管理 editor document

**Decision**: 使用 `useReducer` + feature context 管理顶层 app/session state；BlockNote 自己管理 document、selection 和 block transaction。仅在确实需要跨 feature 订阅时抽取 selector/context，不引入 Redux、Zustand、Jotai 或全局 event bus。UI state 分为 ephemeral session、persisted UI preferences 和 project content 三类。

**Rationale**:

- 当前是单窗口、单作者、单项目焦点；`launch/workspace`、active panel、modal 和 save status 的 union state 可用 reducer 明确表达，不需要第三方 store。
- BlockNote 官方 `BlockNoteView` 是 uncontrolled component，editor 自己管理复杂状态；把每次字符输入提升到全局 store 会导致无意义的 shell 重渲染。
- 存储边界已经由 main-owned project store/IPC 定义；UI store 不应重复拥有 project path、Markdown 或 Git revision。

**State ownership**:

- renderer ephemeral：active rail tool、open modal、selection、focus、draft form、AI stream display、toast/banner。
- app-owned UI preference：theme、density、last active section、recent command visibility；通过 named IPC 写 userData 或项目 `ui-state.json`。
- project content：motivation、outline、chapter blocks、citations、accepted proposal；通过 expected revision 的 `saveWorkspace` 进入 main/Git。
- secret：provider key 只存在于 main 的 safeStorage adapter，renderer 只读 `configured`、`provider` 和 status。

**Alternatives considered**:

- Redux Toolkit：可测试但为当前首版增加 action/reducer/store wiring 和 global serialization convention。
- Zustand/Jotai：轻量，但会让 project content、editor session 和 modal state 的所有权边界更隐式；目前没有跨 window 的理由。
- 把所有 state 写 localStorage：无法满足 Electron 的 secret/storage 边界，也无法和 Git revision/IPC conflict 协调。

## Decision 6: API key 归 main + safeStorage，系统设置不进入项目

**Decision**: Settings modal 由 renderer 收集 provider endpoint/model label/API key，并调用显式的 `readProviderSettings`、`saveProviderSecret` 和 `testProviderConnection` 方法。main 通过 Electron `safeStorage` 异步 API 写 app-owned secret store；返回 renderer 的 DTO 永远不包含 plaintext key。`.writellm` 项目只保存不敏感的 provider reference 或 model metadata，不保存 API key。

**Rationale**:

- Electron 文档将 `safeStorage` 定义为 main-process API，并推荐 asynchronous encrypt/decrypt；macOS/Windows/Linux 分别使用系统可用的 Keychain/DPAPI/secret store 机制。
- system setting 与 portable project 的所有权不同：项目移动或备份时不应该把个人 secret 一起复制出去。
- 用户能在 modal 里验证“已配置/未配置/不可用”，但不能通过 React devtools、项目 Git 或 renderer state 读回 key。

**Failure rule**: 平台 secret backend 不可用时返回 typed error，设置 modal 保留用户可重试的 form 状态，禁止静默写入 plaintext。Linux backend/status 可作为诊断文案显示；任何 fallback 都必须显式进入后续 ADR，不能在实现中自行降级。

**Alternatives considered**:

- `.writellm/settings.json`：可随项目移动，但会把 secret 放进可备份、可提交和可能共享的目录。
- renderer localStorage/IndexedDB：不适合受保护 secret，也无法满足 main-owned security boundary。
- 第三方 keychain native dependency：可能更强，但为当前 Electron 版本增加 native build/packaging 复杂度；先使用 Electron 自带能力。

**Reference**: [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)。

## Decision 7: 保留 portable project + Git-backed history，UI 只显示产品语义

**Decision**: 延续现有 storage research：用户选择任意父目录创建 `<project-name>.writellm/`；项目内有 Git history，main 负责 commit/diff/restore；recent index 只在 app userData。UI 将 Git commit 映射为 human/model/system 的产品事件，不把 raw Git command 暴露给用户。

**Rationale**:

- 用户明确需要项目可移动、可备份和版本可追踪；项目内 Git 同时满足 diff、timeline 和非破坏 restore。
- 版本信息不是 editor UI 的全局状态；`contentRevision`、commit trailers、proposal/task ids 和 actor 保持在 main/data model，history modal 只消费安全 DTO。
- recent index 不成为项目真相；项目移动后显示 missing 并允许重新绑定，避免 UI 误删用户文件。

**Alternatives considered**:

- 应用内 snapshots/versions.ndjson：会重复实现 diff/restore，且资料和正文增长后恢复粒度差。
- 系统 recent documents：跨平台能力不一致，不能表达 invalid/missing/rebind 状态。
- raw Git UI：技术用户可能有价值，但超出普通作者工作台范围；首版只显示产品级 timeline。

**References**: [Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)、[Electron security](https://www.electronjs.org/docs/latest/tutorial/security)、[Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)、[Electron dialog](https://www.electronjs.org/docs/latest/api/dialog)。

## Resolved unknowns

- “SharedCNUI”：按 `shadcn/ui` 解释；如果用户实际指另一个未公开/内部库，应在实现前替换组件分发决策。
- UI primitives：Radix variant，通过 shadcn/ui 源码进入 repo；不在 Radix 和 Base UI 间混用同一组件。
- Styling：Tailwind v4 + semantic CSS variables，dark-first workbench + readable editor surface。
- Editor：BlockNote；BlockNote document 是 editor projection，项目 codec 维护 Markdown 与 identity metadata 的可读/可恢复转换。
- Navigation：launch/workspace two-state + modal/panel registry；首版不使用 full router。
- State：React reducer/context + BlockNote internal document state；不引入第三方 global store。
- API keys：main-owned async safeStorage；只向 renderer 返回 redacted status。
- Project location/history：portable `.writellm` folder + app-owned recent index + project-local Git，沿用已有 storage ADR 方向。
- Security：`contextIsolation=true`、`nodeIntegration=false`、`sandbox=true`、named typed IPC、sender validation、no remote code。
