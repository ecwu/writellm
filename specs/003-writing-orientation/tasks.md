# Tasks: 写作动机与文章大纲

**Input**: Design documents from `/specs/003-writing-orientation/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: 本 feature 改动 Electron preload、具名 IPC、main-owned persistence、安全边界和已记录用户旅程，因此按模板要求包含 unit、contract、integration 和 compiled Electron runtime 测试。

**Organization**: 任务按用户故事分组；任何产品实现开始前，必须先完成 Phase 1 的接受门禁和 Phase 2 的共享基础。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可在不同文件上并行执行，且不依赖尚未完成的任务
- **[Story]**: 对应 `spec.md` 的用户故事
- 每个任务均包含明确文件路径

---

## Phase 1: Setup — 接受门禁与实现骨架

**Purpose**: 满足仓库 implementation gate，并建立 003 的目录和测试 fixture；本阶段未完成前不得开始产品实现。

- [ ] T001 记录 maintainer 对 003 `spec.md`、`plan.md`、`data-model.md` 和三个 contracts 的接受结果并勾选 `specs/003-writing-orientation/checklists/plan-decisions.md`
- [ ] T002 接受 `docs/adr/001-project-storage.md`，冻结 `workspace/writing-orientation.json`、schema v1、revision、atomic replacement、pending recovery、app-managed Git runtime/adapter 与 structured content commit，并在 `specs/003-writing-orientation/checklists/plan-decisions.md` 记录结果
- [ ] T003 接受 `specs/003-writing-orientation/contracts/workspace-leave-guard.md` 对已完成 002 shell 的 dirty Save/Discard/Stay extension，并记录 003 linked-item safe-refusal boundary；004 transaction 不再阻塞 003
- [ ] T004 [P] 创建 003 shared/main/renderer/test 目录骨架与空 fixture exports，路径为 `src/main/writing-orientation/`, `src/renderer/features/writing-orientation/`, `test/fixtures/writing-orientation/`, `test/unit/writing-orientation/`, `test/contract/writing-orientation/`, `test/integration/writing-orientation/`, `test/runtime/writing-orientation/`

**Checkpoint**: 只有 T001–T003 全部完成且没有未接受边界时，才允许进入 Phase 2。

---

## Phase 2: Foundational — 共享模型、存储与 IPC

**Purpose**: 建立所有用户故事依赖的 canonical model、验证、repository 和最小 preload bridge。

**⚠️ CRITICAL**: 本阶段阻塞全部用户故事。

- [ ] T005 [P] 定义 schema v1 document、motivation、existing/new outline save-input 可判别联合、clientDraftId→outlineItemId mapping、delete confirmation、result 与 stable error DTO，并为 `Window` 声明三个具名方法；save input 不暴露 main-owned chapterRef，路径为 `src/shared/writing-orientation.ts` 和 `src/vite-env.d.ts`
- [ ] T006 [P] 建立 canonical empty/saved document、有效/无效 request 与 disk fixture builders，路径为 `test/fixtures/writing-orientation/orientation-fixtures.ts`
- [ ] T007 为 renderer input 与 disk document 实现 main-owned parser，校验 kind/version/project identity、UUID、唯一性、status、NUL、trimmed title、safe integer revision 和 2 MiB ceiling，路径为 `src/main/writing-orientation/parser.ts`
- [ ] T008 为 parser 编写 missing/invalid/unknown schema、identity mismatch、existing/new identity XOR、unknown/omitted/duplicate durable IDs、duplicate clientDraftId、forged chapterRef、chapter uniqueness 与 size ceiling 单元测试，路径为 `test/unit/writing-orientation/parser.test.ts`
- [ ] T009 实现 per-project serial queue、missing-file revision 0 load、baseRevision conflict、method+payload-bound session mutationId 去重、clientDraftId→main UUID mapping、main-owned chapterRef merge、updatedAt、sibling-temp flush/close/rename，并调用 accepted ADR-001 main-owned Git adapter 完成 pending/structured commit/cleanup，路径为 `src/main/writing-orientation/repository.ts` 和 ADR-001 接受的 shared project storage adapter
- [ ] T010 为 atomic replacement + Git commit、100 次 save/reopen、重复 mutation、stale revision、write/commit failure、pending/dirty-worktree recovery、malformed document 与 recovery-required 编写隔离项目 integration tests，路径为 `test/integration/writing-orientation/repository.test.ts`
- [ ] T011 注册并实现 `load`、`save`、`deleteOutlineItem` handlers，验证 sender 和 main-owned active project session 并将异常映射为 redacted DTO，路径为 `src/main/writing-orientation/handlers.ts` 和 `src/main/main.ts`
- [ ] T012 将 `load`、`save`、`deleteOutlineItem` 三个具名 wrappers 暴露到独立 `window.writellmWritingOrientation` namespace，且不暴露 generic invoke、path、filesystem、Git、Electron object 或 raw Error，路径为 `src/preload/preload.cts`
- [ ] T013 为 namespace exactness、existing/new save-input XOR、identity mapping、linked-delete safe refusal、method+payload-bound idempotency、Git initialization/commit stable errors、sender/session validation 与 capability redaction 编写 contract tests，路径为 `test/contract/writing-orientation/writing-orientation-ipc.test.ts`

**Checkpoint**: canonical snapshot 可通过最小具名 IPC 安全 load/save，且 repository/contract tests 通过；用户故事可在此基础上推进。

---

## Phase 3: User Story 1 — 明确写作动机 (Priority: P1) 🎯 MVP

**Goal**: 作者可填写、清空和显式保存每项目的 problem、target readers 与 desired outcome，并在失败后保留输入、重试和重新打开恢复。

**Independent Test**: 在一个项目填写并保存写作动机，确认未触发保存前磁盘不变；关闭重开后内容完整，清空再保存显示有效空状态而非错误。

### Tests for User Story 1

- [ ] T014 [P] [US1] 为 baseline/draft dirty detection、saving 时继续编辑、成功/失败/retry 和 discard transitions 编写先失败的单元测试，路径为 `test/unit/writing-orientation/orientation-state.test.ts`
- [ ] T015 [P] [US1] 为填写、显式保存、保存失败保留输入、清空保存和重开恢复编写先失败的 renderer integration tests，路径为 `test/integration/writing-orientation/motivation-flow.test.tsx`

### Implementation for User Story 1

- [ ] T016 [US1] 实现 baseline/draft、content dirty comparison、submitted-snapshot baseline 更新与 save state reducer，路径为 `src/renderer/features/writing-orientation/orientation-state.ts`
- [ ] T017 [US1] 实现 motivation 三字段、引导性空状态、保存按钮、保存中/成功/失败状态和可执行重试 UI，路径为 `src/renderer/features/writing-orientation/WritingOrientationPanel.tsx`
- [ ] T018 [US1] 接入 load/save API 并确保仅按钮或保存快捷键提交、重复触发复用 mutationId、失败保留当前 draft，路径为 `src/renderer/features/writing-orientation/WritingOrientationPanel.tsx`
- [ ] T019 [US1] 将 writing-orientation panel 注册到 002 feature panel slot，并保持 renderer 不接触项目路径或 Node/Electron capability，路径为 `src/renderer/workspace/components/ToolPanelHost.tsx`
- [ ] T020 [US1] 为 compiled preload chain、保存快捷键、dirty/saving/saved/failed announcement 与关闭重开恢复编写 runtime journey，路径为 `test/runtime/writing-orientation/motivation-runtime.test.ts`

**Checkpoint**: US1 可独立演示和验证；这是建议 MVP。

---

## Phase 4: User Story 2 — 建立和调整文章大纲 (Priority: P1)

**Goal**: 作者可创建、选择、编辑、删除、拖拽和键盘排序单层大纲，固定详情区与列表同时可见，保存后内容和顺序可恢复。

**Independent Test**: 创建三个默认“未开始”的条目，在固定详情区修改标题、摘要和状态，分别用拖拽与上移/下移排序，删除一个未关联条目，保存重开后确认内容和顺序。

### Tests for User Story 2

- [ ] T021 [P] [US2] 为 pure move command 的上下界、no-op、drag/keyboard 等价性和重复 reorder 编写先失败的单元测试，路径为 `test/unit/writing-orientation/reorder.test.ts`
- [ ] T022 [P] [US2] 为 create/select/edit/status/title validation、固定详情区、空大纲、unlinked delete 和显式保存编写先失败的 integration tests，路径为 `test/integration/writing-orientation/outline-flow.test.tsx`
- [ ] T023 [P] [US2] 为 linked delete 的 `LINKED_DELETE_NOT_AVAILABLE`、零修改和执行时重新读取关联状态编写先失败的 integration tests，路径为 `test/integration/writing-orientation/linked-delete.test.ts`

### Implementation for User Story 2

- [ ] T024 [P] [US2] 实现数组顺序唯一 truth 的 `moveItem(from,to)` pure command，路径为 `src/renderer/features/writing-orientation/reorder.ts`
- [ ] T025 [US2] 扩展 draft commands 以创建 clientDraftId 条目、默认 `not-started`、选择/编辑标题摘要状态与 reorder 并统一标记 dirty；成功 save 后用 mapping 原子替换条目及 selection identity，成功 delete 后以返回的 canonical document 更新 baseline/draft，路径为 `src/renderer/features/writing-orientation/orientation-state.ts`
- [ ] T026 [US2] 实现始终可见的大纲列表和固定详情区、三态 badge、chapter presence、空状态、trimmed title field error 与 selection fallback，路径为 `src/renderer/features/writing-orientation/WritingOrientationPanel.tsx`
- [ ] T027 [US2] 为每个条目实现共享 T024 command 的 HTML drag 与明确上移/下移 controls，并提供 keyboard、focus 和 live status feedback，路径为 `src/renderer/features/writing-orientation/WritingOrientationPanel.tsx`
- [ ] T028 [US2] 实现 unlinked delete；linked item 显示明确暂不可用反馈且保持 draft/canonical 内容不变，路径为 `src/renderer/features/writing-orientation/WritingOrientationPanel.tsx`
- [ ] T029 [US2] 在 main 重新读取 authoritative 关联状态，未关联时删除，`chapterRef` 非空时返回 `LINKED_DELETE_NOT_AVAILABLE` 且零写入，路径为 `src/main/writing-orientation/handlers.ts` 和 `src/main/writing-orientation/repository.ts`
- [ ] T030 [US2] 为键盘排序、拖拽等价结果、状态可辨识、unlinked delete、linked safe refusal 和重开顺序编写 compiled Electron runtime journey，路径为 `test/runtime/writing-orientation/outline-runtime.test.ts`

**Checkpoint**: US2 可独立完成 003 范围内的大纲生命周期；未关联条目可删除，linked item 安全拒绝，004 不阻塞本 checkpoint。

---

## Phase 5: User Story 3 — 恢复写作方向 (Priority: P2)

**Goal**: 重开项目恢复最近成功保存的动机、大纲和仍存在的 selection；dirty 离开时提供 Save、Discard、Stay。

**Independent Test**: 保存动机和大纲、选择一个条目并重开项目，确认内容、顺序和 selection；删除原 selection 后回退到首项或空状态；分别验证 Save、Discard、Stay。

### Tests for User Story 3

- [ ] T031 [P] [US3] 为 reopen 后首项/empty default entry、session-only selection 和 selection 不改变 content revision 编写先失败的单元测试，路径为 `test/unit/writing-orientation/selection-state.test.ts`
- [ ] T032 [P] [US3] 为 Save/Discard/Stay、save failure 阻止离开和 in-flight edit 仍 dirty 编写先失败的 workspace integration tests，路径为 `test/integration/writing-orientation/leave-guard.test.tsx`

### Implementation for User Story 3

- [ ] T033 [US3] load/reopen 后不读取 durable selection，有条目时选择第一项、无条目时为 null；selection 仅保留在当前 renderer session，路径为 `src/renderer/features/writing-orientation/orientation-state.ts`
- [ ] T034 [US3] 按已接受的 002 contract 将 dirty summary 与 Save/Discard/Stay callbacks 接入 project leave orchestration，save 失败时保持当前项目和 draft，路径为 `src/renderer/workspace/WorkspaceShell.tsx`
- [ ] T035 [US3] 实现离开确认 dialog 的安全文案、默认 focus、取消/关闭等同 Stay、成功 save 后继续导航和 discard 后恢复 baseline，路径为 `src/renderer/features/writing-orientation/WritingOrientationPanel.tsx`
- [ ] T036 [US3] 为重开后的首项/empty default entry、Save/Discard/Stay 与 save failure 编写 compiled Electron runtime journey，路径为 `test/runtime/writing-orientation/restoration-runtime.test.ts`

**Checkpoint**: 所有故事均可验证；selection 不跨关闭持久化，leave guard 通过 T003 接受的 002 extension 验证。

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 对全部故事执行安全、回归、规模与人工验收。

- [ ] T037 [P] 扩展 compiled preload regression，断言 project/appearance namespaces 不变且 orientation namespace 恰好三个方法，路径为 `test/smoke/ipc-contract.test.ts`
- [ ] T038 [P] 增加 100 次 create/edit/delete/reorder/save 重复操作的零重复、零错序 SC-004 验证，路径为 `test/integration/writing-orientation/repetition.test.ts`
- [ ] T039 [P] 增加 2 MiB、NUL、raw stack/path redaction、Git executable/command/repository handle 不跨 renderer、contextIsolation/nodeIntegration/sandbox 回归验证，路径为 `test/contract/writing-orientation/writing-orientation-security.test.ts`
- [ ] T040 按 `specs/003-writing-orientation/quickstart.md` 执行六个场景并把平台、结果、门禁阻塞和人工可用性结果记录到 `specs/003-writing-orientation/validation.md`
- [ ] T041 运行 `bun run typecheck`、`bun run test`、`bun run build` 和 `bun run test:smoke`，并将最终通过结果记录到 `specs/003-writing-orientation/validation.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 — Setup**: T001–T003 是强制接受门禁；T004 可与接受审查并行，但不授权实现。
- **Phase 2 — Foundational**: 依赖 Phase 1 完成，并阻塞全部用户故事。
- **US1 / US2**: 都是 P1；依赖 Phase 2，之后可由不同人员并行，但共享 `orientation-state.ts` 和 panel 时需协调提交顺序。
- **US3**: 依赖 Phase 2；内容恢复可并行，leave-guard 集成依赖 T003 接受的 002 extension，并消费 US1/US2 的 baseline/draft 行为。
- **Phase 6 — Polish**: 依赖计划纳入发布的故事完成。

### User Story Completion Order

```text
Phase 1 acceptance gates
        ↓
Phase 2 shared model/repository/IPC
        ├──────────────┐
        ↓              ↓
US1 motivation     US2 outline
        └──────┬───────┘
               ↓
       US3 restore/leave
               ↓
          Polish & gates
```

- **US1 (P1)**: Phase 2 后即可独立完成；不依赖 US2。
- **US2 (P1)**: Phase 2 后即可独立完成；003 对 linked chapter delete 采用安全拒绝，不依赖 004。
- **US3 (P2)**: 使用 US1/US2 已产生的保存内容做完整旅程；leave guard 额外依赖 T003 的 002 extension acceptance，selection 采用 session-only default-entry 规则。

### Within Each User Story

- 先编写列出的 failing tests，再实现对应行为。
- Shared model/parser 先于 repository，repository 先于 handlers/preload。
- Pure state/reorder 先于 UI composition，UI 先于 compiled Electron runtime journey。
- 每个 checkpoint 必须独立通过后才能声明该故事完成。

---

## Parallel Execution Examples

### User Story 1

```text
Parallel: T014 state transition unit tests | T015 motivation renderer integration tests
Then: T016 → T017/T018 → T019 → T020
```

### User Story 2

```text
Parallel: T021 reorder unit tests | T022 outline UI integration tests | T023 linked-delete integration tests
Parallel after tests: T024 pure reorder command | T029 main authoritative safe-refusal boundary
Then: T025 → T026/T027/T028 → T030
```

### User Story 3

```text
Parallel: T031 selection unit tests | T032 leave-guard integration tests
Then: T033/T034 → T035 → T036
```

---

## Implementation Strategy

### MVP First — User Story 1

1. 完成 Phase 1 接受门禁。
2. 完成 Phase 2 shared model、repository 和 IPC。
3. 完成 US1 的 T014–T020。
4. 停止并按独立测试验证 motivation 显式保存、失败保留与重开恢复。

### Incremental Delivery

1. Setup + Foundational → 安全 persistence/IPC foundation。
2. US1 → 可保存和恢复写作动机的 MVP。
3. US2 → 可执行的大纲规划；未关联条目可删除，linked delete 由 003 明确安全拒绝。
4. US3 → 从稳定默认入口恢复内容并安全离开；未接受 002 leave-guard extension 时不得宣称 dirty leave 完成。
5. Polish → 重复操作、安全边界、quickstart 与全仓命令通过。

### Parallel Team Strategy

1. 团队共同完成接受门禁和 Phase 2。
2. Phase 2 后，US1 与 US2 可并行；对共享 panel/state 文件采用明确所有权或顺序合并。
3. 002 leave-guard extension 完成 T003 接受工作；004 transaction 独立继续设计，不阻塞本 feature。
4. US3 在 shared draft/selection semantics 稳定后集成，最后统一执行 runtime 与 release gates。

---

## Notes

- `[P]` 仅用于不同文件且无未完成依赖的任务。
- 所有产品实现受 T001–T003 约束；任务列表本身不代表 spec、plan 或 ADR 已被接受。
- `chapterRef` 始终是不透明 ID；003 不读取或编辑章节正文。
- selection 不写入 `workspace/writing-orientation.json`，选择条目不得增加 content revision。
- 生产 Git runtime/adapter 以 accepted ADR-001 为准；003 不实现 history UI，也不把 path、filesystem、Git capability 或 generic IPC 暴露给 renderer。
