# Implementation Plan: 分栏式工作区导航重构

**Branch**: `013-workspace-navigation-redesign` | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

**Status**: Accepted — maintainer accepted 2026-07-13; implementation remains gated on the 006/ADR-005 PDF-preview amendment described below.

## Summary

把 002 的临时 tool-panel 编排重构为稳定的 renderer-owned master-detail 工作区：窄一级类别栏切换 Sections 与 Knowledge Base，相邻列表栏显示当前 owner 的导航投影，主内容区持续挂载并显示所选 Section/章节或资料详情；Settings 作为独立 application-level area 从 rail 底部进入，关闭后返回原项目上下文。

设计以官方 [shadcn/ui `sidebar-09`](https://ui.shadcn.com/blocks/sidebar#sidebar-09) 的 open-code block 为明确视觉/组合来源：外层可折叠 wrapper 内横向嵌套固定 icon rail 与可滚动 context sidebar，main 使用 inset、sticky location header、trigger、separator 和 breadcrumb。013 只移植该拓扑与密度到现有 Rhea/Base UI foundation，不原样安装 New York/Radix primitive、cookie、全局快捷键、Sheet、账户菜单或邮件业务。宽布局采用约 `350px composite sidebar / flexible main`，其中 rail 为 64px；受限布局逐级呈现列表或详情。原始 PDF 预览是现有 006 契约唯一缺口：保留 FR-009 需要 006-owned、current-version-fenced 的安全 byte protocol 与 `SourceDetail` 版本投影，并使用本地打包的 PDF.js display layer；不得暴露路径、generic file IPC 或 Electron PDF plugin 权限。

## Technical Context

**Language/Version**: TypeScript 7.0.2；React/React DOM 19.2.7；Electron 43.1.0；Bun 1.3.14。

**Primary Dependencies**: 现有精确冻结依赖；011 source-owned shadcn/Rhea + Base UI、Tailwind CSS 4、Typeset 与 012 `lucide-react` 契约。`sidebar-09` registry source 是设计输入，不成为运行时依赖；013 不引入其 Radix `Slot`、Sheet、Skeleton、DropdownMenu、Avatar、Switch、Collapsible 或 cookie persistence。原始 PDF 预览拟新增并精确冻结 `pdfjs-dist` 6.1.200，只使用 display API 和本地 bundle/worker；安装前须通过 license、Bun lock、Vite build 与 sandboxed Electron runtime 验证。

**Storage**: 不新增 schema。导航类别、每类最近有效选择、desktop sidebar expanded/collapsed、列表/详情视图、滚动与 Settings 返回点仅存在 renderer 当前项目会话。禁止继承官方 Sidebar 的 `sidebar_state` cookie；Sections、chapters、sources、settings 和 appearance 继续由既有 owner 持久化。

**Testing**: Bun + Happy DOM + Testing Library/user-event；现有 unit/contract/integration suites；compiled Electron UI/runtime 覆盖真实 preload/protocol、焦点、缩放、布局与 PDF range response。运行 `bun run typecheck`、`bun run test`、`bun run build`、`bun run test:smoke`、`bun run test:ui-runtime`。

**Target Platform**: sandboxed Electron desktop，macOS/Windows/Linux；默认 1200×800，最低 960×640，并验证 Electron 200% zoom、System/Light/Dark、forced colors 与 reduced motion。

**Project Type**: sandboxed Electron main/preload + single React renderer。

**Performance Goals**: 连续 100 次 category/item/Settings 切换最终状态 100% 与最新意图一致；已挂载 owner 的 DOM/draft/selection/scroll 不因 category 编排丢失；列表交互不因 PDF 解析阻塞；最多 200 MB PDF 通过流式/range reads，避免 main/renderer 一次性复制整份文件。

**Constraints**: 保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；不新增 router、全局状态库、layout persistence、generic IPC、file path、remote resource、Electron plugin 或第二套 UI/icon/theme；不得注册官方 Sidebar 的 `⌘/Ctrl+B` 全局 toggle（与 editor bold 冲突）；状态不得从文件或计数自行推断；960×640、200% 与键盘路径均可达。

**Scale/Scope**: 一个活动项目；两个项目内容类别；每类至多一个当前 item；现有 10,000 outline/block 上限与 sources 每页 100 条/块；一个独立 Settings area；PDF 仅查看，不编辑、注释或导出。

所有技术选择已在 [research.md](./research.md) 解决，无 `NEEDS CLARIFICATION`。013 spec/plan 已接受；尚未接受的 producer-contract/ADR amendment 仍是治理门禁，不是隐式实现选择。

## Constitution Check — pre-research gate

| Principle | Status | Evidence / gate |
|---|---|---|
| I. Secure Desktop Boundary | PASS WITH DESIGN GATE | renderer 只消费 owner DTO/callback；PDF 必须通过 006-owned active-session/current-version resolver 与受限协议，禁止 path/file API。 |
| II. Typed, Minimal IPC | PASS WITH PRODUCER AMENDMENT REQUIRED | Sections、settings、结构化 source detail 零新增 IPC；PDF 使用固定 protocol route，并为 `SourceDetail` 增加最小版本/可用性投影。006 contract 必须先接受修订。 |
| III. Specification-Driven, Minimal Evolution | BLOCKED FOR IMPLEMENTATION | 013 spec/plan 已 Accepted；FR-009 跨 006 renderer boundary，仍需接受 006 plan/contract 与 ADR-005 amendment。新独立 ADR 不需要。 |
| IV. Verification at the Failure Boundary | PASS WITH PLAN | pure reducers、DOM composition、main protocol tests 和 compiled Electron 分别覆盖状态、语义、byte boundary 与真实 zoom/focus。 |

**Gate conclusion**: 可完成规划设计，但不得生成 implementation tasks 或实施，直至 013 spec/plan Accepted，且 006 source contract/plan 与 ADR-005 的窄 PDF-preview amendment Accepted。

## Project Structure

### Documentation

```text
specs/013-workspace-navigation-redesign/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── workspace-navigation.md
│   └── source-preview-amendment.md
└── checklists/
    ├── requirements.md
    └── plan-decisions.md
```

### Planned source delta

```text
src/
├── shared/
│   └── sources.ts                         # narrow current-version/preview projection
├── main/sources/
│   ├── source-repository.ts               # resolve current original PDF identity
│   └── media-protocol.ts                  # version-fenced PDF range route
├── preload/preload.cts                    # existing namespaces; no generic method
└── renderer/
    ├── App.tsx                            # compose project workspace and Settings area
    ├── workspace/
    │   ├── WorkspaceShell.tsx
    │   ├── workspaceNavigationSession.ts
    │   └── components/
    │       ├── WorkspaceNavigationFrame.tsx # sidebar-09-inspired nested composition
    │       ├── WorkspaceCategoryRail.tsx
    │       ├── ContextNavigationList.tsx
    │       ├── WorkspaceLocationHeader.tsx
    │       ├── WorkspaceDetail.tsx
    │       └── SettingsArea.tsx
    └── features/
        ├── writing-orientation/            # owner controller + Sections list/detail projections
        ├── editor/                         # persistent chapter owner instance
        ├── sources/
        │   ├── KnowledgeBaseWorkspace.tsx
        │   ├── SourcePdfPreview.tsx
        │   └── SourceDetail.tsx
        ├── provider-settings/              # existing owner panel
        └── source-service-settings/        # MinerU/SiliconFlow owner UI

test/
├── unit/workspace-navigation/
├── contract/sources/
├── integration/workspace-navigation/
└── runtime/workspace-navigation/
```

**Structure Decision**: 保留现有 Electron 分层和单 renderer。category/list/detail/settings 是 feature-local composition；共享 primitives、tokens、icon rules 继续由 011/012 拥有。PDF resolver 属于 006 source owner，而不是 workspace shell。

## Phase 0 — Research decisions

[research.md](./research.md) 记录完整理由与替代方案。结论为：

1. 用 renderer-only discriminated session 取代 002 的 hover/pinned panel 语义；增加非持久 `sidebarExpanded`，类别激活时像官方 block 一样确保 context sidebar 展开；不引入 router/store/persistence。
2. owner controller 提供列表与详情投影；shell 只保存 identity，不复制 orientation/source/chapter/settings 真相。
3. category pane 首次访问后保持挂载；inactive project pane 使用受控 `hidden`/`inert`，切换前迁移焦点。
4. Sections 直接消费 orientation draft/order/status/chapterRef；章节创建/加载/保存继续走 003/004。
5. Knowledge Base 复用 006 list/get/events/retry/remove，所有资格与状态来自 owner read model；异步 detail/page 使用 generation + version fence。
6. Settings 是 category 外的 application-level area；关闭时卸载设置 owner 以遵守 secret 清理规则，并恢复 project category/item/focus。
7. `sidebar-09` 明确提供 nested wrapper、icon rail、context sidebar、inset main、sticky trigger/separator/breadcrumb header 与 dense list-row 参考；邮件搜索/Unreads/账户/随机列表和整套 Radix Sidebar primitive 明确排除。
8. 参考图与 block 只转译紧凑层级、surface、独立滚动和暗色方向；所有颜色/焦点/高对比仍来自 Rhea semantic tokens。
9. 原始 PDF 使用 006-owned safe protocol + bundled PDF.js，不使用 `file://`、path IPC、`iframe/embed` plugin 或 whole-file IPC。

## Phase 1 — Design and contracts

### State and projections

[data-model.md](./data-model.md) 定义 renderer session、navigation projections、selection validity、request generations、Settings return point 和 source preview descriptor。它们不成为新的 durable truth。

- `WorkspaceNavigationSession` 同时只允许一个 project category；分别记住 Sections/Knowledge Base 最近有效 item。
- Sections/Knowledge Base controller 拥有其业务 state，shell 只接收可选 projection 和 owner actions。
- item 删除、resync 或版本变化时先验证 selection；失效后进入 owner default/empty state，绝不保留旧详情。
- 已访问 project category 保持挂载；Settings 打开时 project workspace 保持挂载但 inert，Settings 关闭时 owner panel 卸载并清除 write-only secret draft。

### UI contract

[contracts/workspace-navigation.md](./contracts/workspace-navigation.md) 冻结：

- wide `clamp(21.875rem, 30vw, 25rem) / minmax(0,1fr)` composite sidebar + main；composite 内为 `64px / minmax(0,1fr)` nested sidebars，默认约 350px；rail/list/main 独立滚动；
- desktop sidebar 可会话内折叠到 64px rail；sticky main header 的 44px trigger 可重新展开，category activation 也自动展开；
- main header 使用 `Project / Category / Item` location breadcrumb，并保留 002 project identity/返回入口；
- 低于约 720 CSS px 时使用 category command strip + list/detail progressive disclosure 和显式 Back；
- native button/nav/main/region semantics、选择文字、focus return、长文本完整可访问名称、44×44 target；
- category/list/settings 切换不保存、不删除、不重建 owner；
- 012 图标 placement 受控扩展，AI agent 不出现可见占位。

### Source preview contract amendment

[contracts/source-preview-amendment.md](./contracts/source-preview-amendment.md) 提议修订 006：

- `SourceDetail` 增加 app-owned `sourceVersionId`、显式块计数和 `originalPreviewAvailable`；
- 固定 `writellm-source` original-PDF route 仅解析 active project 的 current source/version；
- main 验证固定路径、版本、PDF signature、size/hash，并按 session/version 缓存验证；支持 bounded `HEAD/GET` 与单 range `206`，错误统一 404/416；
- 返回 `application/pdf`、`no-store`、`nosniff`、sandbox CSP，不返回 path/remote id/raw error；
- renderer 使用 bundled PDF.js display API 画布/文本层，禁用编辑、附件、脚本、表单提交和远程资源。

该 amendment 不改变 durable schema：006 已保存 original PDF 与 currentVersionId。它改变 renderer-visible source boundary，因此实施前必须同步更新并接受 006 plan/contract、ADR-005 与 registry。

### Layout and lifecycle

1. 仿照 `sidebar-09`，workspace body 是 composite nested sidebar + main inset；不再额外占用一个跨全宽 project header。project identity/返回入口位于 rail header 与 sticky main location header，底部 status region 继续由 002 owner-summary 契约提供。
2. rail 顶部是 project/return control 与 Sections、Knowledge Base；Settings 与项目内容类别视觉/语义分组并位于稳定 footer，替代示例 `NavUser`，永远不进入 `activeCategory`。
3. context header 显示当前 category 与 owner-relevant secondary control；013 不照搬邮件搜索/Unreads，除非后续 spec 接受相应产品需求。
4. main sticky header 复用 existing Button/Separator 并实现 feature-local breadcrumb semantics；不新增 shared Breadcrumb primitive，除非 foundation review 证明第二个 consumer。
5. desktop sidebar trigger 与 category item 均可展开 context sidebar；折叠只改变布局可见性，不卸载 owner。宽布局 category/item activation 保留 trigger/row 焦点。受限布局隐藏列表前把焦点移至详情 Back/heading，Back 恢复原 item 或 list fallback。
6. 每个 list/detail/main 使用单一命名 ScrollArea；PDF viewer 是 main 内有界命名 subregion，状态变化不自动重置外层滚动。
7. 不使用 `(min-resolution)` 推断 zoom，不在 breakpoint 重建业务 owner tree；CSS viewport/container 决定 reflow。

### Implementation sequence

1. 先评审/接受 013 spec/plan、006 producer amendment 与 ADR-005 amendment；验证并冻结 `pdfjs-dist` candidate。门禁失败则停止，不生成产品代码。
2. 建立纯 `workspaceNavigationSession` reducer、selection validity、focus return 和 generation fence tests。
3. 重构 orientation/source controller，让一个 owner instance 同时投影 list/detail；保持 existing save/retry/remove/event semantics 与回归。
4. 按 reviewed `sidebar-09` registry snapshot 组合 nested navigation frame、category rail、context list、inset main、sticky location header、SettingsArea 与 responsive progressive disclosure；登记 012 icon placements。不得执行 `shadcn add sidebar-09` 覆盖项目组件。
5. 实现 SourceServices settings UI，并组合 005/006 settings owners；不合并 revisions/secrets/errors。
6. 实现 006 original-PDF resolver/protocol、PDF.js viewer 与 CSP 最小增量；先 contract/security/range tests，后接 UI。
7. 完成 DOM、compiled Electron、100 次切换、960×640/200%、theme/forced-colors、长文本与人工可用性验证。

## Verification Matrix

| Failure boundary | Required evidence |
|---|---|
| Navigation reducer | 同时一个 category；每类最近有效 item；失效选择回退；最后事件获胜；Settings return 幂等。 |
| Owner lifecycle | 100 次切换保持已挂载 editor/source controller DOM identity、draft、selection、scroll；导航不触发 save/delete/retry。 |
| Sections | draft 顺序/标题/摘要/状态/章节关联一致；未关联项不伪造正文；dirty owner guard 与 003/004 回归通过。 |
| Sources | event gap resync；detail/page generation + sourceVersion fence；状态/计数/资格只来自 006；partial 不伪装 complete。 |
| PDF boundary | exact safe route、sender/session/version、signature/size/hash、range/HEAD、404/416、CSP、no path/raw error；移动项目与切换项目后旧 URL 失效。 |
| Settings | application-level 文案；005/006 namespace 与 secret lifecycle 不变；关闭清空 write-only inputs并恢复 category/item/focus。 |
| Accessible DOM | landmarks、names、selected/current states、完整长名、hidden/inert 非 tabbable、Back/fallback focus、44×44 targets。 |
| Runtime layout | 1200×800、960×640、960×640@200%、light/dark/forced-colors/reduced-motion 无阻断重叠；列表/main/PDF 独立滚动。 |
| shadcn source adaptation | nested composition、350px CSS variable、collapse/trigger/breadcrumb/list density 可追溯；无 cookie、全局 `⌘/Ctrl+B`、Radix/Sheet、32px target 或邮件/账户代码进入产品。 |
| Security/regression | sandbox flags不变；无 generic IPC/file path/remote PDF resource；001–006、011、012 相关测试全通过。 |

详细可运行场景见 [quickstart.md](./quickstart.md)。

## Constitution Check — post-design

| Principle | Status | Design evidence / remaining gate |
|---|---|---|
| I. Secure Desktop Boundary | PASS IN DESIGN | main-owned fixed resolver + PDF.js renderer display layer；active session/current version/hash/range/CSP 围栏；无 Node/path/plugin。 |
| II. Typed, Minimal IPC | PASS IN DESIGN / ACCEPTANCE REQUIRED | 没有新 preload method；仅扩展 owner DTO 和既有 app protocol route。producer contract 必须先接受。 |
| III. Specification-Driven, Minimal Evolution | BLOCKED FOR IMPLEMENTATION | 技术未知项与 013 spec/plan 接受已解决，但 006/ADR-005 amendment 尚未 Accepted。 |
| IV. Verification at the Failure Boundary | PASS IN DESIGN | reducer、DOM、contract、main protocol 和 compiled Electron 均有明确 failure-boundary evidence。 |

**Post-design gate**: Phase 1 design complete；无 Constitution exception 或 `NEEDS CLARIFICATION`。implementation gate 仍关闭，直到 `checklists/plan-decisions.md` 的全部适用接受条件完成并同步 registry。

## ADR and dependency gate

- 001、002、003、004、005、006、011、012 已 Complete，满足 feature 依赖。
- ADR-003 已接受并覆盖 renderer composition、tokens、primitives、focus 与 runtime verification。
- 纯导航、session-only state、Settings composition 不需要新 ADR。
- 原始 PDF preview 扩展 006 已有 source security boundary；最小治理路径是 **amend ADR-005 + 006 plan/contract**，而不是创建 generic file-capability ADR。
- 若评审要求 path/file IPC、Electron plugin、通用协议、持久 layout 或新 primitive base，则本计划必须停止并重新打开新 ADR 评估。

## Complexity Tracking

无 Constitution exception。`sidebar-09` 被当作可审计 open-code composition reference，而不是第二套 design system；feature-local adaptation 是同时满足 Rhea/Base UI、session-only state、BlockNote shortcut 和 44px contract 的最小做法。PDF.js 与安全协议增量是满足已写入 FR-009 的最小方案；如果该需求被移出 013，则删除该 dependency/amendment 即可，其余导航设计保持不变。router、global store、generic settings/file bridge、new database、persistent layout 和 second UI system 均被拒绝。
