# Implementation Plan: 共享 UI Foundation

**Branch**: `011-ui-foundation` | **Date**: 2026-07-12 | **Spec**: [spec.md](./spec.md)

**Status**: Accepted — maintainer accepted through design Q&A on 2026-07-12

**Input**: Feature specification from `/specs/011-ui-foundation/spec.md`

**Note**: 本计划只生成设计材料。未编写实现代码、未安装依赖、未修改 lockfile、未生成 `tasks.md`。

## Summary

在已完成的 `001-project-foundation` 之后、`002-workspace-shell` 实现之前，建立单 renderer、源码归仓库所有的 shadcn/ui 风格 UI foundation。计划使用 Tailwind CSS v4、Base UI、Rhea/neutral、语义 CSS variables 和 source-owned shadcn/typeset；提供 System/Light/Dark 切换、main-owned 应用级外观偏好与未来编辑器的 editor/reading/compact 排版 preset。首批共享 primitives/patterns 只覆盖 001 启动页与 002 已知共性需求。001 的项目 state、六方法 IPC、文案含义和磁盘契约保持不变；appearance 使用独立两方法 bridge。

本 feature 的 [ADR-003](../../docs/adr/003-ui-foundation.md) 同时冻结组件所有权、primitive/style/token/typeset 体系、外观偏好持久化、最小 IPC、可访问性责任和升级流程。Spec、plan、UI contract 与 ADR-003 已于 2026-07-12 通过三轮维护者问答一并接受。

## Technical Context

**Language/Version**: 仓库声明 TypeScript 7.0.2、React/React DOM 19.2.7、Electron 43.1.0、Bun 1.3.14、Vite 8.1.4；本 feature 不升级现有栈。当前 shell 的 `bun --version` 为 1.3.4，因此不能用它声称 1.3.14 兼容性已验证；implementation/CI 必须先断言并使用 packageManager 声明的 1.3.14。

**Primary Dependencies**: 计划新增 Tailwind CSS v4 与 `@tailwindcss/vite`；通过固定版本的 shadcn CLI 应用 Rhea + Base UI preset，生成批准组件后用同版本 `eject` 将 shadcn CSS 内联为仓库源码。生成组件预计使用 `@base-ui/react`、`class-variance-authority`、`clsx`、`tailwind-merge`、`lucide-react` 及生成结果声明的最小依赖；产品不保留 `shadcn` runtime/build dependency。shadcn/typeset 以一份可审查的本地 `typeset.css` 进入仓库，不是 runtime package。DOM 测试使用 Happy DOM + React Testing Library + `user-event`。所有 exact versions 必须在首个 accepted implementation task 中、任何安装前一次性解析和记录，并通过 React 19/Bun 1.3.14/Vite 8 的无产品代码 compatibility probe；不得使用 floating `latest` 作为可重复输入。

**Storage**: main 在 `app.getPath('userData')` 下拥有版本化 `appearance-preferences.json`，使用原子替换；缺失使用默认值，损坏/未知版本仅内存回退并返回安全 warning，直到用户成功更新才覆盖。不使用 localStorage、项目文件或文档内容。

**Testing**: 保留 `bun run typecheck`、`bun run test`、`bun run build`、`bun run test:smoke`；新增 renderer DOM/component tests、appearance repository/IPC tests 与独立 compiled Electron UI fixture/harness，既有 Electron smoke 继续验证 project bridge/lifecycle。001 的 unit/contract/integration/runtime 测试必须原样通过。

**Target Platform**: Electron 43 单窗口 renderer，macOS、Windows、Linux；默认 1200×800，最小 960×640，并验证 200% 文本缩放、系统 light/dark、forced-colors/high-contrast 与 reduced motion。

**Project Type**: 安全 Electron desktop application（main + preload + React renderer）；UI foundation 仅存在于 renderer。

**Performance Goals**: main 在创建窗口前读取外观偏好并设置 `nativeTheme.themeSource`，首帧不先渲染错误主题；主题/typeset 变化不得重建 `LaunchPage` 或丢失其输入/状态；基础组件和字体不引入网络请求；生产 renderer bundle 的新增压缩体积在实现前以构建报告记录。

**Constraints**:

- 保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`。
- `window.writellm` 的 001 六方法 project contract 原封不动；仅可在独立 `window.writellmAppearance` 上新增 `getAppearancePreferences` 与 `updateAppearancePreferences` 两个 typed methods。
- 不编辑 `specs/001-project-foundation/`、ADR-002 或 001 已完成 tests 的历史意图。
- 不在本 feature 实现 002 shell、feature panels、editor、provider、source 或 history UI。
- shadcn 导入的源码由仓库拥有；CLI 更新只能生成可评审 diff，不能静默覆盖本地修改。
- 主题值只通过 semantic tokens 暴露；feature 不直接引用 palette 色值或建立第二套基础组件。
- 外观偏好输入必须在 main 重新验证；不得向 renderer 暴露路径、文件或 generic settings/file API。
- 字体只能从已审查的 system-safe stack IDs 中选择；不枚举、不下载、不导入字体。
- overlay/focus/media 行为必须在独立 compiled Electron UI fixture 中验证，不能只依赖类型检查、Happy DOM 或静态标记。

**Scale/Scope**: 一个 renderer root；System/Light/Dark 三种偏好模式与两套有效颜色值；11 个初始 primitives、4 个 patterns、3 个 Typeset presets、1 个 versioned preference file、2 个 appearance IPC methods；迁移一个既有 launch feature，不实现 workspace shell 或完整 settings 页。

## Constitution Check

### Pre-research gate

| Principle | Status | Evidence / condition |
|---|---|---|
| I. Secure Desktop Boundary | PASS | renderer 只消费标准化 appearance DTO；路径、文件、`nativeTheme` 和验证留在 main。 |
| II. Typed, Minimal IPC | PASS | 001 的 `window.writellm` 六方法 bridge 保持不变；外观偏好使用独立 `window.writellmAppearance` 的两个 named methods，无 generic IPC。 |
| III. Specification-Driven, Minimal Evolution | PASS | spec、plan、UI contract 与 ADR-003 已于 2026-07-12 经维护者问答接受；初始范围限于 001/002、主题切换与编辑排版基础。 |
| IV. Verification at the Failure Boundary | PASS WITH PLAN | DOM tests 覆盖语义/键盘，compiled Electron 覆盖系统主题、portal/focus 与 preload 暴露，001 tests 覆盖行为/存储回归。 |

**Pre-research conclusion**: PASS。外观持久化是已接受的新边界，已在 ADR-003 和 UI contract 中冻结；无 Constitution exception 或 `NEEDS CLARIFICATION`。

## Project Structure

### Documentation (this feature)

```text
specs/011-ui-foundation/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── ui-foundation.md
└── checklists/
    ├── requirements.md
    └── plan-decisions.md

docs/adr/003-ui-foundation.md
```

`tasks.md` 不由本轮生成。

### Current source tree (existing)

```text
src/renderer/
├── App.tsx
├── main.tsx
├── styles.css
└── launch/
    ├── LaunchPage.tsx
    └── launchState.ts

test/
├── integration/project/
├── contract/project/
├── unit/project/
├── runtime/project/
└── smoke/ipc-contract.test.ts
```

### Planned source delta (not created in this planning turn)

```text
components.json                    # shadcn source-generation configuration
src/renderer/
├── components/
│   ├── ui/                        # source-owned shadcn primitives
│   │   ├── alert.tsx
│   │   ├── badge.tsx
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   ├── input.tsx
│   │   ├── label.tsx
│   │   ├── scroll-area.tsx
│   │   ├── select.tsx
│   │   ├── separator.tsx
│   │   └── tooltip.tsx
│   └── patterns/
│       ├── EmptyState.tsx
│       ├── FormField.tsx
│       ├── AppearanceControls.tsx
│       └── StatusNotice.tsx
├── appearance/
│   ├── AppearanceProvider.tsx
│   └── appearanceState.ts
├── lib/
│   └── cn.ts
├── theme/
│   ├── tokens.css
│   └── typeset.css
├── launch/
│   └── LaunchPage.tsx             # presentation-only migration
├── main.tsx                       # provider composition only
└── styles.css                     # global reset + Tailwind/theme imports

src/main/appearance/
└── appearance-preferences.ts       # validated atomic userData owner
src/shared/appearance.ts                         # DTOs, enums, bounds and result types
src/preload/preload.cts                          # adds separate two-method appearance bridge

test/
├── setup/renderer-dom.ts
├── unit/ui/
├── unit/appearance/
├── contract/appearance/
├── integration/ui/
├── integration/appearance/
├── integration/project/           # existing tests retained; DOM coverage extended
└── runtime/ui-foundation/          # compiled fixture + dedicated Electron entry
```

**Structure Decision**: 保持单 package、单 renderer。`components/ui` 是低层 source-owned primitives；`components/patterns` 只放无业务状态的组合；`launch`、未来 `workspace` 和其他 feature 继续拥有业务布局与状态。暂不建立 workspace package、registry server 或单独 design-system build。

## Architecture and Ownership

| Layer | Owns | Must not own |
|---|---|---|
| Theme/Typeset | semantic CSS variables、light/dark values、focus/motion、system font stacks、Typeset presets | project/document state、feature business colors、font files |
| `components/ui` | primitive markup、variants、Base UI adapter、accessibility defaults | project/workspace/domain state、IPC calls、feature copy |
| `components/patterns` | 无业务状态的复用组合与 controlled appearance UI | recent records、persistence、save state owner、modal business policy |
| Appearance provider | load/update state、effective theme、controlled `AppearanceControls` wiring | file paths、raw storage、project/document content |
| Feature (`launch`, future `workspace`) | page composition、copy、business state、events、API calls | duplicate primitives、raw palette、generic overlay/focus implementation |
| Main/preload/shared | 001 project authority plus versioned appearance validation/storage and two-method bridge | UI components、editor content、generic settings/files |

组件依赖方向固定为 `feature/appearance provider → patterns → ui → Base UI/native element`；反向 import 禁止。基础组件和 patterns 不读取 bridge；只有 appearance provider 使用 `window.writellmAppearance`。

## Initial Component Scope

首批 primitives 仅包含 `Button`, `Input`, `Label`, `Card`, `Alert`, `Badge`, `Separator`, `Dialog`, `Tooltip`, `ScrollArea`, `Select`。首批 patterns 仅包含 `FormField`, `StatusNotice`, `EmptyState`, `AppearanceControls`。排版层包含 source-owned `typeset.css` 与 `typeset-editor`, `typeset-reading`, `typeset-compact`。`Sidebar`, `Sheet`, `DropdownMenu`, `Command`, `Tabs`, `Resizable` 等由 002 在真实需求出现后按扩展流程申请。

启动页迁移映射：

| Existing launch element | Foundation target | Behavior owner |
|---|---|---|
| primary/secondary/text buttons | `Button` variants | `LaunchPage` handlers unchanged |
| project name label/input | `FormField` + `Input` | local input state unchanged |
| launch/recent surfaces | `Card` composition | `LaunchPage` list/state unchanged |
| loading/warning/error | `StatusNotice` / `Alert` | `launchState` and safe messages unchanged |
| availability marker | `Badge` + visible text | existing availability mapping unchanged |
| empty workspace | `EmptyState` within page composition | existing successful project snapshot unchanged |
| lightweight theme choice | controlled `AppearanceControls` + `Select` | appearance provider; project handlers/state unchanged |

## Theme and Customization Rules

1. Theme tokens use semantic names (`background`, `foreground`, `card`, `muted`, `primary`, `destructive`, `border`, `input`, `ring` plus approved app roles) and define light/dark values in one file.
2. `themeMode` is `system | light | dark`, defaults to `system`, and is application-global. Main reads it before window creation, sets `nativeTheme.themeSource`, and persists successful updates; renderer does not use localStorage or write project data.
3. `prefers-reduced-motion` disables non-essential transforms/transitions; important state changes remain available as text/semantics.
4. Feature code may use layout utilities and semantic theme utilities. Raw palette colors, arbitrary z-index, repeated shadow/radius recipes, `!important`, and copied primitive source require review.
5. New visual states are added through a named variant only when at least one accepted feature requires them; feature-specific composition remains outside `components/ui`.
6. Icon-only controls require accessible name and tooltip where discoverability needs it; tooltip never replaces the accessible name.
7. Updates run with an exact reviewed CLI version, one component at a time. Generated diff, dependencies, DOM semantics, variants, token usage and tests are reviewed before merge; no blind overwrite.
8. 高对比/forced-colors 保留浏览器默认调整；焦点、边界和状态在 `forced-colors: active` 下使用系统颜色或可见 outline，只在有证据的局部元素上使用 `forced-color-adjust: none`。
9. shadcn/typeset 是未来 HTML/Markdown 的唯一共享 prose 层。`editor` 为 16px/1.75/1.25em，`reading` 为 18px/1.9/2em，`compact` 为 14px/1.6/1em；值只定义在排版 token/preset 中。
10. UI 使用 Rhea 的 system sans；编辑正文默认 system serif，code 使用 system mono。Preference 仅引用审查过的 font IDs/fallback stacks，不枚举或载入字体。

## 002 Common-UI Coverage Baseline

SC-004 的 denominator 固定为 002 Draft 中已明确、且属于 foundation 而非 shell 业务的 10 类需求。当前 10/10 有直接能力（100%）；002 接受前可更新自己的组合，但不得反向扩大 011 的业务范围。这个映射只读取 002 的产品交互需求；其 Draft plan 中过时的栈版本、`getRuntimeInfo` 和 ADR-001 归属不是 011 设计输入，必须在 002 接受前对齐已接受的 001/ADR-002。

| 002 known common need | Foundation capability |
|---|---|
| primary/secondary/text actions | `Button` variants |
| icon tool entry and discoverability | icon-size `Button` + `Tooltip` |
| labeled configuration field | `FormField` + `Label` + `Input` |
| shell/panel surface | `Card` composition + semantic surface tokens |
| region separation | `Separator` |
| constrained panel/modal content | `ScrollArea` |
| modal semantics and focus | `Dialog` |
| save/error/attention feedback | `StatusNotice` + `Alert` |
| compact state marker | `Badge` with visible text |
| empty/unavailable slot | `EmptyState` |

Responsive shell layout, panel identity/state orchestration and editor preservation are deliberately excluded from the denominator because FR-011 leaves them with 002. SC-006 is an ongoing governance outcome: it becomes measurable when three later renderer designs exist; 011 acceptance establishes the audit rule and extension record, rather than fabricating three future consumers during implementation.

## Phased Implementation Order

### Phase 0 — Acceptance gate (before implementation)

1. Maintainer accepted `spec.md`, this plan, UI contract and ADR-003 through three Q&A rounds on 2026-07-12.
2. 001 remains immutable as historical design while its current renderer is the migration target; its six-method project bridge remains exact.
3. 002 implementation depends on completed 011 and must align its stale Draft design before acceptance.
4. Generate `tasks.md` next; dependency installation belongs only to accepted implementation tasks.

### Phase 1 — Reproducible foundation setup

1. Resolve and record exact dependency and CLI versions compatible with Bun 1.3.14, React 19.2.7, TypeScript 7.0.2, Vite 8.1.4 and Electron 43.1.0.
2. Configure Tailwind v4 Vite integration and stable renderer import aliases without changing main/preload module resolution.
3. Apply the reviewed Rhea + Base UI preset to the existing Vite project and retain the resulting `components.json` CLI configuration; do not assume that editing `style` alone applies the preset.
4. Generate only the approved initial components, run the same pinned CLI's `eject` flow to inline shadcn CSS/remove its package, and review every source/dependency diff.

### Phase 2 — Appearance storage, IPC, tokens and provider composition

1. Define and validate appearance schema v1, atomic main-owned repository, safe fallback/warning behavior and bounds.
2. Add separate `window.writellmAppearance` methods and keep `window.writellm` exactly six project methods; set `nativeTheme.themeSource` before window creation.
3. Define light/dark semantic tokens, audited system font stacks, `typeset.css`, three Typeset presets and global focus/motion/forced-colors rules.
4. Compose `AppearanceProvider`, controlled `AppearanceControls` and only other required providers, keeping StrictMode and the single root.
5. Validate CSP/sandbox and confirm no local font enumeration, remote font/icon request, localStorage or project write.

### Phase 3 — Component contracts and tests

1. Normalize public variants and remove generated examples or dependencies outside initial scope.
2. Add `FormField`, `StatusNotice`, `EmptyState` and controlled `AppearanceControls` as business-neutral patterns.
3. Test semantic roles/names, Select keyboard behavior, disabled/invalid states, dialog/tooltip focus, three theme modes, three Typeset presets, forced colors and reduced motion. Add a test tsconfig or equivalent so setup/matcher types are covered and rerun the full suite to detect global DOM-preload leakage.
4. Build a dedicated UI fixture and Electron test entry. Verify first-paint theme, System/Light/Dark runtime changes, persisted restart, Typeset rendering/streaming stability, native keyboard traversal and CDP reduced-motion/forced-colors. Keep test capabilities outside product main/preload.

### Phase 4 — 001 launch presentation migration

1. Preserve `LaunchPage` props, handlers, `launchState`, API calls, safe messages and branching.
2. Replace current handwritten visual elements/classes with approved primitives/patterns in small reviewable slices.
3. Preserve all visible project action meanings and accessibility names; appearance additions must not change project main/preload/shared contracts or project/recent disk fixtures.
4. Add only the accepted lightweight theme selector; preserve launch/project state and keep full typography settings out of the launch page.
5. Remove only CSS rules proven unused after migration; keep global rules owned by the foundation.

### Phase 5 — Regression and handoff to 002

1. Run all existing 001 tests plus new UI DOM/runtime tests and the full build/smoke commands.
2. Execute quickstart across System/Light/Dark, restart persistence, corrupt/unknown appearance storage, three Typeset presets, forced-colors, reduced-motion, 200% zoom, 1200×800 and 960×640.
3. Audit bundle/dependency delta and assert the project bridge is exactly six methods while appearance is exactly two methods.
4. Publish the component/extension contract as 002's only UI foundation; do not start 002 business implementation within this feature.

## Dependency and Sequencing

```text
001 accepted + implemented
          |
          v
011 spec + plan + ADR accepted
          |
          v
011 implemented + 001 regression verified
          |
          v
002 plan aligned and accepted -> 002 implementation
          |
          v
003-010 renderer UI adopts foundation as each feature is implemented
```

- 001 不新增对 011 的历史依赖；011 以其当前行为为迁移基线。
- 011 是 002 implementation 的新前置条件。002 的 Draft 文档可在 011 接受后单独修订；本轮不修改它。
- 003–010 的业务依赖关系不变，但任何 renderer 实现均不得另起基础 UI 体系。

## Verification Strategy

| Failure boundary | Verification | Pass condition |
|---|---|---|
| Appearance storage/IPC | repository + contract + invalid-input tests | versioned atomic persistence; safe fallback; project bridge exactly 6 methods; appearance bridge exactly 2; no path/raw error leak |
| Token/theme/typeset source | token inventory + CSS/build tests | light/dark and three Typeset presets complete; audited font IDs only; no remote resources/localStorage/project writes |
| Primitive DOM/a11y | Bun + Happy DOM + Testing Library interaction tests | roles/names/states/keyboard/focus contract 通过；Select/tooltip/dialog/AppearanceControls 行为可预测 |
| Electron renderer runtime | dedicated compiled fixture + Electron test entry | correct first paint; System/Light/Dark persist and update; native focus/portal/inert and reduced-motion/forced-colors work |
| 001 behavior | 现有 project unit/contract/integration/runtime tests + quickstart | 100% 通过；`window.writellm` 6-method IPC、recent 上限、错误脱敏和项目磁盘副作用不变 |
| Layout/readability | 1200×800、960×640、200% zoom 和 system high-contrast 的 runtime/manual checks | 所有启动操作、状态和错误可达，焦点/边界可见，无阻断性截断 |
| Upgrade/customization | generated diff checklist | exact source、依赖、DOM、tokens、variants、tests 全部被评审，无 blind overwrite |

## Constitution Check (post-design)

| Principle | Status | Post-design conclusion |
|---|---|---|
| I. Secure Desktop Boundary | PASS | 外观路径/文件/validation/`nativeTheme` 留在 main；renderer 只获得标准化 DTO，CSP 与安全 webPreferences 不变。 |
| II. Typed, Minimal IPC | PASS | 001 project bridge 保持六方法；外观使用独立两方法 bridge，无 generic IPC 或通用 settings/file API。 |
| III. Specification-Driven, Minimal Evolution | PASS | spec、plan、contract 与 ADR-003 已接受；范围限于 11 primitives、4 patterns、3 Typeset presets 和一个 appearance preference boundary。 |
| IV. Verification at the Failure Boundary | PASS WITH ACCEPTANCE CONDITION | DOM、Electron runtime、001 contract/storage regression 和人工视觉条件均有对应验证；需在 accepted tasks 中落实。 |

**Post-design gate**: PASS — spec、plan、UI contract 与 ADR-003 已接受，无未解决澄清或 Constitution exception。下一步可生成 `tasks.md`；本验收轮未安装依赖或修改产品代码。

## Complexity Tracking

无 Constitution exception。

| Candidate complexity | Decision | Why bounded |
|---|---|---|
| UI source generator | 采用 shadcn 的 source-owned model | 只生成批准组件；CLI 不成为运行时服务，更新必须 diff review |
| Utility styling runtime | Tailwind CSS v4 | 与当前官方 Vite 路径及 shadcn tokens 匹配；仅 renderer build 使用 |
| Headless primitive library | Base UI | 当前 shadcn 新项目默认与推荐；通过本地 wrapper 隔离 feature |
| Separate design-system package/registry | 拒绝 | 当前只有一个 renderer consumer，目录边界足够 |
| Appearance preference persistence | main-owned versioned JSON + separate two-method bridge | 用户已要求主题切换与编辑排版偏好；localStorage 无 main validation/atomic ownership，project storage 归属错误 |
| shadcn/typeset | source-owned CSS + 3 bounded presets | 避免每个 renderer feature 重复发明 prose rules；不引入 runtime package |
| Full component catalog | 拒绝 | 初始范围只覆盖 001/002 已知需求，后续按需扩展 |
