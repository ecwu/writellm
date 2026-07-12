# Tasks: 章节块编辑器

**Input**: Design documents from `/specs/004-block-editor/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: 本 feature 改动 Electron preload、具名 IPC、main-owned persistence、安全边界和已记录用户旅程，因此按模板要求包含 unit、contract、integration 和 compiled Electron runtime 测试。

**Organization**: 任务按用户故事分组；Phase 1 的 BlockNote package gate 和 Phase 2 的共享 contract/storage foundation 完成前，不得开始用户故事实现。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可在不同文件上并行执行，且不依赖尚未完成的任务
- **[Story]**: 对应 `spec.md` 的用户故事
- 每个任务均包含明确文件路径

---

## Phase 1: Setup — Package 接受门禁与测试骨架

**Purpose**: 验证并冻结唯一 editor dependency family，建立 004 的 fixture 与 runtime 骨架。

- [x] T001 锁定 `@blocknote/core`、`@blocknote/react`、`@blocknote/ariakit` 0.51.4 到 `package.json` 和 `bun.lock`，记录 MPL-2.0、peer dependency、无 XL/Mantine/额外 Markdown parser 的审计结果到 `specs/004-block-editor/validation.md`
- [x] T002 验证 pinned BlockNote 的 Bun install、TypeScript、Vite/Electron build 与 sandboxed compiled mount，并把命令、版本和结果记录到 `specs/004-block-editor/validation.md`；失败时停止后续产品实现
- [x] T003 [P] 建立 canonical/invalid chapter、block、citation、Markdown 与 two-view fixture builders，路径为 `test/fixtures/editor/chapter-fixtures.ts`
- [x] T004 [P] 建立 compiled editor runtime fixture 与 runner 注册，路径为 `test/runtime/editor/fixture.tsx`, `test/runtime/editor/fixture.html`, `test/runtime/editor/electron-entry.mjs`, `scripts/electron-ui-runtime.mjs`

**Checkpoint**: 精确 package family 已通过 license/peer/build/runtime gate，测试 fixture 可用。

---

## Phase 2: Foundational — 共享模型、验证、Repository 与 IPC

**Purpose**: 建立全部故事共享的 canonical schema、main-owned persistence、typed preload 和安全边界。

**⚠️ CRITICAL**: 本阶段阻塞全部用户故事。

- [x] T005 [P] 定义 `ChapterDocument`、冻结的 BlockNote snapshot union、citation、conversion preview、result/error DTO、2 MiB/10,000 blocks/depth 32/10,000 citations ceilings 与五个 `ChapterApi` methods，路径为 `src/shared/chapters.ts`
- [x] T006 [P] 声明 exact `window.writellmChapters` namespace 且不扩展 generic IPC capability，路径为 `src/vite-env.d.ts`
- [x] T007 实现 plain-object/exact-property、UUID、identity、revision、schema、唯一 block ID、block tree、inline content、citation UTF-16 range/quotedText 与 ceiling 验证，路径为 `src/main/project/chapter-validation.ts`
- [x] T008 为 unknown/prototype-bearing input、重复/缺失 block ID、非法 props/content/depth、citation mismatch、identity/schema mismatch 与全部 ceilings 编写先失败的单元测试，路径为 `test/unit/editor/chapter-validation.test.ts`
- [x] T009 实现 logical `workspace/chapters/<chapterId>.json` load、malformed/missing/unknown schema errors、per-project serialization、exact base revision、method+payload-bound mutation idempotency 和 atomic snapshot save，复用 ADR-001 pending/Git recovery，路径为 `src/main/project/chapter-repository.ts`
- [x] T010 为 load/save、100 次 save/reopen、stale revision、duplicate/misused mutationId、write/commit failure、dirty-worktree/pending recovery 与 `STORAGE_RECOVERY_REQUIRED` 编写 integration tests，路径为 `test/integration/project/chapter-repository.test.ts`
- [x] T011 实现 `openForOutlineItem` 的 authoritative 003 reload、orientation revision check、existing-link open，以及 revision-0 empty chapter + `chapterRef` 单 pending transaction/Git commit，路径为 `src/main/project/chapter-repository.ts` 和 `src/main/writing-orientation/repository.ts`
- [x] T012 为 create/link transaction 的重复请求、stale orientation、interrupted replacement/commit、orphan/dangling prevention和 linked identity mismatch 编写 integration tests，路径为 `test/integration/project/chapter-link-transaction.test.ts`
- [x] T013 注册 `openForOutlineItem`、`load`、`save`、`previewMarkdownExport`、`exportMarkdown` handlers，验证 sender/active session 并映射 redacted stable errors，路径为 `src/main/project/chapter-handlers.ts` 和 `src/main/main.ts`
- [x] T014 将五个具名 wrappers 暴露到独立 `window.writellmChapters` namespace，且不暴露 path、filesystem、Git、Electron、editor instance、raw error 或 generic invoke，路径为 `src/preload/preload.cts`
- [x] T015 为 namespace exactness、DTO shape、sender/session validation、revision/idempotency、preview ownership/expiry 和 path/stack/capability redaction 编写 contract tests，路径为 `test/contract/chapters/chapter-ipc.test.ts`
- [x] T016 为 context isolation、sandbox、node integration 与既有 project/appearance/orientation namespace 不变增加 compiled preload regression，路径为 `test/smoke/ipc-contract.test.ts`

**Checkpoint**: canonical chapter 可经最小 typed IPC 安全 create/load/save，且失败不泄漏 capability 或损坏 durable content。

---

## Phase 3: User Story 1 — 从大纲开始写章节 (Priority: P1) 🎯 MVP

**Goal**: 作者从未关联大纲项原子创建空章节，从已关联项打开同一章节，并立即获得可输入焦点。

**Independent Test**: 选择未开始的大纲项创建章节并输入首段；重复进入和重启后打开相同 chapter ID、内容仍存在且无 orphan/duplicate。

### Tests for User Story 1

- [x] T017 [P] [US1] 为 unlinked create、linked reopen、empty document 和 load failure 编写先失败的 renderer integration tests，路径为 `test/integration/editor/chapter-entry.test.tsx`
- [x] T018 [P] [US1] 为 create-once、initial focus、repeat entry 和 restart restoration 编写先失败的 compiled Electron journey，路径为 `test/runtime/editor/chapter-entry-runtime.test.ts`

### Implementation for User Story 1

- [x] T019 [US1] 在 orientation item 上提供“开始写作/继续写作”入口并传递 opaque outline identity 与 current orientation revision，路径为 `src/renderer/features/writing-orientation/WritingOrientationPanel.tsx`
- [x] T020 [US1] 实现 chapter open/create/load controller、重复 trigger mutationId 复用、loading/empty/error/retry state，路径为 `src/renderer/features/editor/chapter-session.ts`
- [x] T021 [US1] 建立 `ChapterEditor` 空章节 shell、可输入焦点和安全状态反馈，路径为 `src/renderer/features/editor/components/ChapterEditor.tsx`
- [x] T022 [US1] 将 chapter editor 接入 002 workspace content slot 并保持 orientation title 为唯一 authoritative title，路径为 `src/renderer/workspace/WorkspaceShell.tsx` 和 `src/renderer/workspace/components/WorkspaceSlot.tsx`

**Checkpoint**: US1 可独立完成从大纲到唯一可编辑章节的 create/open/restart 旅程；这是建议 MVP。

---

## Phase 4: User Story 2 — 编写和重组章节内容 (Priority: P1)

**Goal**: 作者可创建、编辑、移动、拆分、合并和删除基础块，且引用只在可证明时 remap，否则标记 needs-review。

**Independent Test**: 在一个章节创建 heading、paragraph、lists、quote，执行全部结构操作和最后块删除；验证文字/顺序/格式、引用结果正确且其他章节未改变。

### Tests for User Story 2

- [x] T023 [P] [US2] 为 snapshot load/read、create/edit/move/split/merge/delete、stable IDs、valid empty document 与 bounded snapshot 编写先失败的 adapter 单元测试，路径为 `test/unit/editor/blocknote-adapter.test.ts`
- [x] T024 [P] [US2] 为 full-block move、split before/after/through range、merge、inside/outside delete、missing/mismatch/ambiguous anchor 编写先失败的 citation transform 单元测试，路径为 `test/unit/editor/citation-transform.test.ts`
- [x] T025 [P] [US2] 为全部基础块的 toolbar/keyboard editing、reorder、last-block deletion、citation review feedback 和 untouched chapter isolation 编写先失败的 renderer integration tests，路径为 `test/integration/editor/block-editing.test.tsx`

### Implementation for User Story 2

- [x] T026 [P] [US2] 实现 BlockNote schema construction、validated load/replace、bounded snapshot read 与 monotonically increasing local generation，路径为 `src/renderer/features/editor/adapter/blocknote-adapter.ts`
- [x] T027 [P] [US2] 实现基于 transaction mapping 的 citation preservation/remap 和保守 `needs-review` reasons，禁止 proximity rebinding，路径为 `src/renderer/features/editor/adapter/citation-transform.ts`
- [x] T028 [US2] 实现 create/edit/move/split/merge/delete commands，并将最后块删除 normalize 为可编辑 empty document，路径为 `src/renderer/features/editor/adapter/blocknote-adapter.ts`
- [x] T029 [US2] 组合 BlockNote Ariakit editor、011 semantic tokens/typeset、block controls、keyboard/focus 和 citation review notice，路径为 `src/renderer/features/editor/components/ChapterEditor.tsx` 和 `src/renderer/theme/typeset.css`
- [x] T030 [US2] 为 100 次 move/split/merge/delete、全部 citation anomaly、theme/forced colors/reduced motion 与 actual compiled BlockNote mount/edit 编写 runtime verification，路径为 `test/runtime/editor/block-editing-runtime.test.ts`

**Checkpoint**: US2 可独立验证全部 block operations，零 unintended cross-chapter mutation，零 silent citation rebound。

---

## Phase 5: User Story 3 — 保存并恢复章节 (Priority: P1)

**Goal**: 作者获得 generation-aware autosave/save-now 状态、失败重试、dirty leave protection 和无 silent overwrite 的 two-view conflict handling。

**Independent Test**: 保存后重启恢复正文/顺序/引用；强制失败时 draft 仍可见；two-view stale save 出现 keep-current/reload 选择；仅未持久化 generation 离开时提示。

### Tests for User Story 3

- [x] T031 [P] [US3] 为 generation、single in-flight save、newer-edit-during-save、success/failure/retry、conflict/acknowledge transitions 编写先失败的 reducer 单元测试，路径为 `test/unit/editor/chapter-draft-state.test.ts`
- [x] T032 [P] [US3] 为 autosave debounce、save now、failure retention、dirty/saving/failed/saved leave choices 与 saved no-prompt 编写先失败的 renderer integration tests，路径为 `test/integration/editor/chapter-saving.test.tsx`
- [x] T033 [P] [US3] 为 two-view stale revision、keep current、reload saved 和 no silent discard 编写先失败的 repository/UI integration tests，路径为 `test/integration/editor/chapter-conflict.test.tsx`

### Implementation for User Story 3

- [x] T034 [US3] 实现 `ChapterDraftState` reducer、submitted generation tracking、one-save-in-flight queue、autosave 与 save-now 共用 save command，路径为 `src/renderer/features/editor/chapter-draft-state.ts`
- [x] T035 [US3] 接入 canonical snapshot save/load、mutationId lifecycle、retry 和 dirty/saving/saved/failed/conflict accessible status，路径为 `src/renderer/features/editor/chapter-session.ts` 和 `src/renderer/features/editor/components/ChapterEditor.tsx`
- [x] T036 [US3] 实现 conflict dialog：分别加载 durable version，提供 keep-current（ack latest base、仍 dirty）与 reload-saved，路径为 `src/renderer/features/editor/components/ChapterConflictDialog.tsx`
- [x] T037 [US3] 将 chapter dirty summary 与立即保存/放弃修改/取消离开接入 existing workspace leave orchestration，并在 autosave 已成功时跳过提示，路径为 `src/renderer/workspace/WorkspaceShell.tsx`
- [x] T038 [US3] 为 save/restart、in-flight edit、write/Git failure、leave choices 和 two primary-instance windows stale conflict 编写 compiled Electron journey，路径为 `test/runtime/editor/chapter-saving-runtime.test.ts`

**Checkpoint**: US3 独立满足保存、恢复、失败保留、离开保护和 internal-view conflict acceptance scenarios。

---

## Phase 6: User Story 4 — 输入、粘贴和导出通用文本格式 (Priority: P2)

**Goal**: 作者可 preview/confirm 基线 Markdown paste，并在 warning preview 后导出单章节可读 UTF-8 Markdown，取消/失败不改变 canonical content。

**Independent Test**: preview 并确认完整 FR-013 baseline，再对 unsupported syntax/custom props/citations 验证 warnings；取消 paste/export 和强制失败均保持 editor 与 durable revision 不变。

### Tests for User Story 4

- [x] T039 [P] [US4] 为 FR-013 baseline parse/export、unsupported syntax、lossy blocks/citations、sync/async normalization 与 readable fallback 编写先失败的 adapter 单元测试，路径为 `test/unit/editor/markdown-interchange.test.ts`
- [x] T040 [P] [US4] 为 paste preview confirm/cancel/failure 和 export warning/cancel/failure 状态隔离编写先失败的 renderer integration tests，路径为 `test/integration/editor/markdown-interchange.test.tsx`
- [x] T041 [P] [US4] 为 preview ownership/expiry、native dialog cancel、exact preview bytes、write failure 与 canonical revision invariance 编写先失败的 contract/integration tests，路径为 `test/contract/chapters/markdown-export-ipc.test.ts` 和 `test/integration/project/markdown-export.test.ts`

### Implementation for User Story 4

- [x] T042 [P] [US4] 实现 awaitable BlockNote `tryParseMarkdownToBlocks` paste adapter、product-owned preflight warnings 和 renderer-memory preview lifecycle，路径为 `src/renderer/features/editor/adapter/markdown-paste.ts`
- [x] T043 [P] [US4] 实现 bounded `blocksToMarkdownLossy` conversion、lossy block/citation warnings、preview ownership/expiry 与 exact UTF-8 payload retention，路径为 `src/main/project/markdown-export.ts`
- [x] T044 [US4] 实现 paste preview/confirm/cancel UI，确认前不插入 candidate，取消或 conversion failure 零 mutation，路径为 `src/renderer/features/editor/components/MarkdownPasteDialog.tsx`
- [x] T045 [US4] 实现 export preview/warnings、main-owned save dialog、exported/canceled/failure feedback 且与 canonical save error 分离，路径为 `src/renderer/features/editor/components/MarkdownExportDialog.tsx` 和 `src/renderer/features/editor/components/ChapterEditor.tsx`
- [x] T046 [US4] 为 baseline、unsupported syntax、citation degradation、paste/export cancel、dialog/write failure 和 actual exported bytes 编写 compiled Electron journey，路径为 `test/runtime/editor/markdown-runtime.test.ts`

**Checkpoint**: US4 可独立完成明确、可预览、可取消且不静默丢失含义的 Markdown interchange。

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: 对全部故事执行安全、规模、跨平台、回归和人工验收。

- [x] T047 [P] 增加 2 MiB、10,000 blocks、depth 32、10,000 citations、malformed schema、raw stack/path/editor/Git leakage 与 renderer capability regression，路径为 `test/contract/chapters/chapter-security.test.ts`
- [x] T048 [P] 增加 macOS/Windows/Linux keyboard semantics、focus return、screen-reader status、forced colors、reduced motion 和 responsive editor chrome verification，路径为 `test/runtime/editor/editor-accessibility-runtime.test.ts`
- [x] T049 按 `specs/004-block-editor/quickstart.md` 执行六个场景与 SC-001–SC-008 fixtures，并把平台、结果、失败注入和人工可用性证据记录到 `specs/004-block-editor/validation.md`
- [x] T050 运行 `bun run typecheck`、`bun run test`、`bun run build`、`bun run test:smoke` 和 `bun run test:ui-runtime`，把最终结果记录到 `specs/004-block-editor/validation.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 — Setup**: 无前置依赖；T001–T002 是 package acceptance gate，未通过不得继续产品实现。
- **Phase 2 — Foundational**: 依赖 Phase 1 完成，并阻塞全部用户故事。
- **US1**: 依赖 Phase 2，建立 editor entry 和 session shell。
- **US2**: 依赖 Phase 2；可与 US1 的入口集成并行开发，但最终 UI composition 使用 US1 shell。
- **US3**: 依赖 Phase 2 和可产生 snapshot/generation 的 US2 adapter；其 repository 部分可提前并行。
- **US4**: 依赖 Phase 2 和 US2 adapter；不依赖 US3 autosave/conflict UI。
- **Phase 7 — Polish**: 依赖计划纳入发布的所有故事完成。

### User Story Completion Order

```text
Phase 1 package gate → Phase 2 shared model/repository/IPC
                              ├──────────────┐
                              ↓              ↓
                         US1 entry       US2 editing
                              └──────┬───────┘
                                     ├──────────────┐
                                     ↓              ↓
                                US3 saving      US4 Markdown
                                     └──────┬───────┘
                                            ↓
                                         Polish
```

- **US1 (P1)**: Phase 2 后可独立交付 create/open empty chapter MVP。
- **US2 (P1)**: Phase 2 后可构建 adapter/citation logic；完整 journey 组合 US1 editor shell。
- **US3 (P1)**: 使用 US2 的 bounded snapshot 和 local generation；不依赖 US4。
- **US4 (P2)**: 使用 US2 adapter/schema；不依赖 US3，且 preview/cancel 不写 canonical revision。

### Within Each User Story

- 先编写列出的 failing tests，再实现对应行为。
- Shared DTO/validation 先于 repository，repository 先于 handlers/preload。
- Pure adapter/state/citation logic 先于 React composition，React integration 先于 compiled Electron runtime。
- 每个 checkpoint 必须独立通过后才能声明该故事完成。

---

## Parallel Execution Examples

### User Story 1

```text
Parallel: T017 renderer entry integration | T018 compiled entry journey
Then: T019/T020 → T021 → T022
```

### User Story 2

```text
Parallel: T023 BlockNote adapter tests | T024 citation tests | T025 editor integration tests
Parallel after tests: T026 adapter foundation | T027 citation transforms
Then: T028 → T029 → T030
```

### User Story 3

```text
Parallel: T031 draft-state tests | T032 saving UI tests | T033 conflict tests
Then: T034 → T035/T036 → T037 → T038
```

### User Story 4

```text
Parallel: T039 conversion tests | T040 renderer flow tests | T041 main export boundary tests
Parallel after tests: T042 paste adapter | T043 export service
Then: T044/T045 → T046
```

---

## Implementation Strategy

### MVP First — User Story 1

1. 完成 Phase 1 package acceptance gate。
2. 完成 Phase 2 canonical model、repository 和 typed IPC。
3. 完成 US1 的 T017–T022。
4. 停止并独立验证 create-once、empty input focus、repeat open 和 restart restoration。

### Incremental Delivery

1. Setup + Foundational → 安全 chapter persistence/IPC foundation。
2. US1 → 从大纲进入唯一章节的 MVP。
3. US2 → 完整 block editing 与 conservative citation transforms。
4. US3 → autosave/save-now、restore、leave protection 与 conflict handling。
5. US4 → previewed Markdown paste/export interoperability。
6. Polish → ceilings、安全、可访问性、跨平台和全仓命令通过。

### Parallel Team Strategy

1. 团队共同完成 Phase 1–2。
2. Phase 2 后，US1 entry/session 与 US2 pure adapter/citation 可并行；共享 `ChapterEditor.tsx` 时顺序合并。
3. US2 adapter 稳定后，US3 draft/save 与 US4 Markdown 可由不同人员并行。
4. 最后统一执行 compiled runtime、quickstart 和 release gates。

---

## Notes

- `[P]` 仅用于不同文件且无未完成依赖的任务。
- BlockNote JSON 是唯一 canonical editor content；Markdown 不是第二 durable truth。
- renderer 不接触 project path、filesystem、Git、Electron capability 或 generic IPC。
- citation 只在完整 range 可证明映射时保持 `valid`；任何歧义必须 `needs-review`。
- 成功 save 只持久化该 request 捕获的 generation；新编辑不得被旧 request 误报为 saved。
