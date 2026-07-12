# Implementation Plan: 写作动机与文章大纲

**Branch**: `003-writing-orientation` | **Date**: 2026-07-12 | **Spec**: [spec.md](./spec.md)
**Status**: Design complete; implementation gated on acceptance

## Summary

在 002 workspace 的 feature panel 中提供显式保存的写作动机与单层大纲。renderer 保持完整草稿、固定条目详情区和统一 reorder command；main 校验不可信输入，并以 revision-protected、单文件原子替换和 ADR-001 Git commit 保存 `workspace/writing-orientation.json`。独立具名 IPC 不暴露路径或 generic channel。重新打开使用稳定的大纲默认入口，不持久化 selection；003 只删除未关联条目，linked delete 安全拒绝并留给 004 accepted extension。

## Technical Context

**Language/Version**: 仓库 lockfile 中的 TypeScript 7、React 19、Electron 43、Bun 1.3。003 不升级版本。
**Primary Dependencies**: 现有 Electron、React、011 UI foundation，以及 accepted ADR-001 选定并由项目 storage foundation 提供的 app-managed Git runtime/adapter；003 不自行选择第二套 Git 实现。
**Storage**: main-owned `workspace/writing-orientation.json`，schema v1，per-project serial queue，同目录 temp + flush/close + rename。
**Testing**: Bun unit/contract/integration，typecheck/build，compiled Electron UI/runtime harness。
**Target Platform**: 项目既有 Electron desktop 发布矩阵。
**Project Type**: sandboxed Electron + React desktop app。
**Performance Goals**: 满足 SC-001～SC-006；100 次保存/重开与重复操作验证零丢失、零重复。
**Constraints**: 显式保存；2 MiB safety ceiling；单层 ordered list；renderer 无文件系统/路径/Git/raw IPC；保存失败保留草稿。
**Scale/Scope**: 每个 active project 一个 orientation snapshot；正文、AI、资料、history UI 和协作不在范围。成功内容保存按 accepted ADR-001 进入项目 Git history。

## Constitution Check — pre-research

| Principle | Status | Evidence / gate |
|---|---|---|
| I. Secure Desktop Boundary | PASS | renderer 只收 DTO；main 拥有 session、validation、storage 和 chapter transaction。 |
| II. Typed, Minimal IPC | PASS | 独立 namespace 仅三个具名方法；contract 禁止 path、generic channel 和 raw Error。 |
| III. Specification-Driven, Minimal Evolution | PASS FOR PLANNING / IMPLEMENTATION GATED | 技术未知项已解决；003 spec/plan、ADR-001 storage/Git 和 leave-guard extension 必须接受后才实施；004 transaction 不再阻塞 003。 |
| IV. Verification at Failure Boundary | PASS | parser/unit、IPC contract、temp-directory storage 和 compiled Electron runtime 分层验证。 |

无 Constitution exception。未接受的 durable/process decisions 明确保持为 implementation gate。

## Research Decisions

[research.md](./research.md) 已解决全部技术澄清：named IPC、手写 parser、Node atomic writer、integer revision/session idempotency、native UUID、shared reorder command、Bun + Electron validation，以及通过 accepted ADR-001 的 main-owned Git adapter 记录成功内容保存。

## Project Structure

```text
specs/003-writing-orientation/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── writing-orientation-ipc.md
    ├── writing-orientation-storage.md
    └── workspace-leave-guard.md

src/
├── shared/writing-orientation.ts
├── main/writing-orientation/
│   ├── handlers.ts
│   ├── parser.ts
│   └── repository.ts
├── preload/preload.cts
└── renderer/features/writing-orientation/
    ├── WritingOrientationPanel.tsx
    ├── orientation-state.ts
    └── reorder.ts

test/
├── unit/writing-orientation/
├── contract/writing-orientation/
├── integration/writing-orientation/
└── runtime/ui/
```

**Structure Decision**: 保持 main/preload/renderer/shared 四层；业务 UI 位于 feature，通用控件复用 011；storage 只在 main。

## Design Phases

### Phase 0 — Accept boundaries

1. 接受 003 spec、plan、data model 和三个 contracts。
2. 接受 `workspace/writing-orientation.json` 的 durable storage decision（更新 ADR-001 或接受一个窄 ADR）。
3. 接受 003 的 linked-item safe-refusal boundary；004 将来通过独立 accepted extension 定义 opaque chapter identity、create/link 和 linked delete transaction，不阻塞 003。
4. 通过 003 accepted contract 扩展 002 的 project-leave orchestration：feature 提供 dirty summary 与 Save/Discard/Stay callbacks；selection 不持久化，不需要 durable location contract。

### Phase 1 — Shared model and repository

1. 编码 schema v1 DTO、stable errors 和 main-owned parser。
2. 实现 missing-file → revision 0 empty snapshot；malformed/unknown version 保持显式错误。
3. 实现 per-project serial save、baseRevision、method/payload-bound mutationId 去重和 atomic replacement，并按 accepted ADR-001 在文件替换后创建结构化 Git commit；commit/pending 失败进入 ADR 定义的恢复流程，不得把未完成事务报告为保存成功。
4. 新条目由 renderer 使用 `clientDraftId` 表达临时 identity；durable IDs 由 main `crypto.randomUUID()` 分配，成功 save 返回完整 identity mapping。save input 不接受 `chapterRef`，也不得通过省略已有 ID 执行删除。

### Phase 2 — IPC boundary

1. 实现 load/save/delete handlers，验证 sender、active project、payload、revision 和 mutation。
2. preload 逐一包装具名 methods；不暴露 `ipcRenderer`、path、filesystem、Git 或 raw exceptions。
3. delete 在 main 重新读取关联状态；`chapterRef` 非空时稳定拒绝且不修改内容。

### Phase 3 — Renderer workflow

1. 在 002 panel slot 同时呈现 motivation、大纲列表和固定详情区。
2. 维护 baseline/draft；每次编辑、创建、状态变化和 reorder 标记 dirty，仅按钮/快捷键保存。
3. 上移/下移与 HTML drag 共享 pure reorder command；提供 focus/live status feedback。
4. 保存失败保留输入并可重试；保存期间继续编辑不会错误显示 saved。
5. 离开 dirty project 时提供 save/discard/stay；重新打开时从完整大纲默认入口开始。

### Phase 4 — Failure-boundary verification

1. unit: validation、empty state、status enum、reorder、dirty/save transitions。
2. contract: namespace/method/DTO/error/redaction exactness。
3. integration: 100 次 save/reopen、duplicate mutation、stale revision、write failure、malformed disk document。
4. runtime: sandbox preload chain、keyboard save/reorder、drag reorder、linked delete safe refusal、leave guard、default reopen entry。
5. 运行 `bun run typecheck`、`bun run test`、`bun run build`、`bun run test:smoke`。

## Cross-boundary ownership

| Boundary | Owner | Contract |
|---|---|---|
| renderer ↔ preload | 003 | bounded DTO through three named methods |
| preload ↔ main | main handlers | sender/session/input validation and discriminated results |
| main ↔ project storage/Git | accepted ADR-001 | schema v1, revision, serial atomic replacement, pending recovery and structured content commit |
| 003 ↔ 002 | [workspace leave-guard extension](./contracts/workspace-leave-guard.md) | panel slot, dirty summary and Save/Discard/Stay callbacks |
| 003 → future 004 | extension point, not a 003 gate | 003 preserves opaque chapterRef and refuses linked deletion; 004 must accept create/link and linked-delete transactions before producing links |

## Constitution Check — post-design

| Principle | Status | Design evidence |
|---|---|---|
| I. Secure Desktop Boundary | PASS | privileged state and persistence remain main-owned; runtime smoke covers the real bridge. |
| II. Typed, Minimal IPC | PASS | three domain methods, explicit DTOs, no generic capability. |
| III. Specification-Driven, Minimal Evolution | PASS FOR DESIGN / IMPLEMENTATION GATED | no unresolved technical clarification; every durable dependency has an explicit acceptance gate and no speculative Git/database/router. |
| IV. Verification at Failure Boundary | PASS | revision/storage faults are integration-tested and process behavior is tested in compiled Electron. |

## Complexity Tracking

| Gate | Why required | Simpler unsafe alternative rejected |
|---|---|---|
| Storage ADR acceptance | File path/schema/revision are durable cross-feature decisions | Writing files before acceptance silently freezes a contract |
| 002 leave-guard extension acceptance | FR-011 requires Save/Discard/Stay before leaving a dirty project | Directly invoking the existing synchronous leave callback would discard unsaved work |

No Constitution exception is requested.
