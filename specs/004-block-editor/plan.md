# Implementation Plan: Block 章节编辑器

Branch: codex/v2-greenfield  
Date: 2026-07-12  
Spec: [spec.md](./spec.md)  
Status: Draft / 第一版

## Summary

以稳定 Block identity 和 Markdown canonical content 实现章节编辑、移动/拆分/合并/删除、引用标记与冲突保护。

## Current baseline

当前仓库只有 Electron main/preload/shared/React renderer 的 startup foundation；已有命令为 bun run typecheck、bun run test、bun run test:smoke。以下计划只描述待实现能力。

## Technical Context

TypeScript 5.8、React 19、Electron 40、Vite 6、Bun 1.3.4；目标为 sandboxed desktop app。候选：Tiptap/ProseMirror、Lexical、BlockNote；unified/remark、ProseMirror Markdown 或手写 codec；jsdiff/diff-match-patch。 Storage 暂沿用 ADR-001 的 main-owned project files 方向，但 ADR 状态仍为 Proposed。

## Constitution Check

- spec 与 storage ADR 仍为 Draft/Proposed，实现前需接受。
- renderer 只能调用 named typed preload IPC，main 验证所有输入并拥有文件/网络/凭据权限。
- durable schema、错误码、第三方包、native runtime 和性能阈值均保留 NEEDS DECISION。
- 验证必须包含 domain unit、contract test 和编译后的 Electron smoke。

Gate: BLOCKED until spec/ADR/contracts are Accepted。

## Implementation phases

1. 冻结 ChapterDocument、Block、CitationMark、identity comment 与 migration。
2. 实现独立于 UI 的 codec 和纯函数 block commands。
3. 建立 editor adapter，接入 selection、dirty/revision、保存和恢复。
4. 加入外部修改、重复/缺失 identity、冲突和 Electron smoke。

## Source structure

src/shared/document.ts; src/main/project/content-repository.ts; src/renderer/features/editor/{adapter,commands,components}/; test/{unit,fixtures,smoke}/editor/

## Boundary and validation

main owns files, Git, secrets, parsing jobs or restore transactions as applicable; preload exposes only named typed methods; renderer receives bounded DTOs. Domain logic must run without Electron/network. Unit tests cover Spec §FR-001–FR-009; contract tests cover DTO/error/redaction; runtime smoke covers 章节创建；基础 block 操作；重开后 identity/order/citation 保持；重复/缺失标识需人工检查；stale save 不覆盖当前内容。

## Constitution Check（Phase 1 design 后复核）

本节是对上方研究前检查的复核，不把设计产物视为实现授权。复核重点是 stable Block identity、Markdown codec、editor adapter、save conflict 和 citation integrity。

| Constitution 原则 | Phase 1 状态 | 设计证据与剩余 implementation gate |
|---|---|---|
| I. Secure Desktop Boundary | **PASS WITH ACCEPTANCE CONDITION** | `data-model.md` 要求由 main/domain 产生或核验 stable identity、revision、validity；`contracts/contract.md` 规定 editor adapter 不接触文件路径；本计划明确 main 拥有文件、Git、凭据和恢复/处理事务，renderer 只接收 bounded DTO。实现前必须用编译后的 Electron smoke 证明 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true` 下 renderer 只能通过 preload 工作，并证明路径、任意命令、凭据和 raw 外部错误不会跨边界。004 本身不需要 provider 或凭据；若复用处理/restore 能力，仍必须保持 main-owned，不能以 editor adapter 绕过边界。` |
| II. Typed, Minimal IPC | **NEEDS DECISION** | `contracts/contract.md` 已收窄为 `loadChapter`、`validateChapter`、`applyBlockCommand`、`saveChapter`，并禁止 generic IPC、任意路径、secret echo 和未约束外部 response；`src/shared` 类型和 main runtime validation 也已列入设计。但 contract version、完整 DTO、错误码、sender/session 校验细节、取消/重试/恢复语义仍明确为 `NEEDS DECISION`。实现 gate 要求冻结这些 named methods 的 request/response/error union，并以 contract test + compiled Electron smoke 验证 preload 逐项映射且 main 拒绝越权、过期 revision、重复/缺失 identity 和超限输入。` |
| III. Specification-Driven, Minimal Evolution | **BLOCKED** | 设计材料选择了最小边界：ChapterDocument/Block/CitationMark、独立 codec 和纯函数 block commands、窄 editor adapter、main 串行保存/transaction/Git；没有引入协作、数据库、provider 或历史 UI。但 `spec.md` 仍是 Draft，ADR-001 仍是 Proposed，且 stable identity comment grammar、Markdown canonical codec、durable schema/migration、citation validity、save conflict 语义和 editor/IPC contract 尚未被接受。实现前必须接受本 spec 与 ADR-001，或明确记录“不需要新增 ADR”，并冻结上述跨 durable/process boundary 的 decisions；未完成不得生成实现任务或写产品代码。` |
| IV. Verification at the Failure Boundary | **PASS WITH ACCEPTANCE CONDITION** | 计划已按失败边界安排 domain unit、DTO/error/redaction contract test 和真实 Electron smoke；`quickstart.md` 覆盖创建、Block 操作、重开 identity/order/citation、重复/缺失标识和 stale save。Phase 1 的验证仍必须落到实际边界：renderer/editor adapter 的 selection、dirty 和拆分/合并行为；preload→main 的 sender/DTO 校验；main codec/schema/revision/citation 判定；storage 的原子写入、pending recovery、权限/写入失败；处理/外部修改的 malformed、duplicate/missing marker；Git commit/working-tree/commit-failure；以及“无凭据进入 renderer、日志、错误或 Git trailer”。在这些 fixture 和 compiled Electron runtime 场景完成前，不得把静态类型或 renderer unit test 当作通过。` |

### 设计为何仍是满足需求的最小方案

- Markdown 是 canonical content，稳定 Block identity 只通过受控的 identity comment/codec 与正文一起保存；Block 操作由不依赖 Electron/network 的纯函数完成。这样覆盖 FR-002–FR-008，同时不把第三方编辑器的内部 JSON 变成第二套 durable schema。
- editor adapter 只负责把选区、dirty/revision 和用户意图映射到 domain commands；文件路径、codec、revision、transaction、Git 和 citation validity 仍由 main/storage owner 负责。采用窄 adapter 可以替换 Tiptap/ProseMirror、Lexical、BlockNote 或手写 UI，而不扩散依赖或改变 Block identity 真相。
- 一个受限的 load/validate/apply/save 边界配合 main 串行写入、pending recovery 和 stale revision 检查，足以覆盖创建、编辑、移动、拆分、合并、删除、保存/恢复和冲突保护；不增加独立数据库、实时协作、远程服务、PDF/资料处理或版本时间线。
- citation mark 只保留 source/chunk/placement 等可验证关系；移动、拆分、合并、外部删除或重复 marker 时进入 needs-review/冲突路径，不在 renderer 中复制资料真相，也不静默重绑定。这是满足 citation integrity 的最小所有权划分。

### Implementation gate 的可执行接受项

以下项目在实现前必须逐项接受、拒绝并记录替代方案，或明确标为不适用；不能由实现者隐式决定：

1. 冻结 `Block` identity comment 的语法、解析/序列化 round-trip、复制/缺失/重复 marker 的判定，及 split/merge 后 citation placement 的保留或 `needs_review` 规则。
2. 冻结 ChapterDocument 的 `kind`、`schemaVersion`、`revision`、migration/unknown-version policy，以及 Markdown codec 的错误和不可表示内容处理；第三方库、版本、许可证、native runtime、fallback 需有明确选择。
3. 冻结 editor adapter 的输入/输出和 lifecycle：selection 映射、dirty 基线、命令结果、保存中继续编辑、失败后可恢复草稿，以及 stale save 的拒绝/重载/重试语义。
4. 接受 `contracts/contract.md` 的完整 IPC DTO、error code、cancel/retry/recovery 语义和 sender/project/session validation；确认 preload 不暴露路径、Git、凭据、generic IPC 或 raw exception。
5. 准备并运行真实失败 fixture：codec malformed/外部编辑、重复或缺失 identity、citation source/chunk invalid、并发或过期 revision、只读/写入中断、pending 未决、Git working-tree/commit 失败、重启恢复，以及 renderer 继续编辑时保存失败；每种情况都不得返回假成功或静默覆盖。
6. 接受 `spec.md`、ADR-001、依赖 project/workspace/orientation contract 和上述本 feature contract 后，才能生成 `tasks.md` 并开始实现；若任一跨边界决策仍未定，状态保持 `NEEDS DECISION` 或 `BLOCKED`。

## Open decisions

候选：Tiptap/ProseMirror、Lexical、BlockNote；unified/remark、ProseMirror Markdown 或手写 codec；jsdiff/diff-match-patch。

**Decision: NEEDS DECISION。** 本版不把候选写成批准依赖。
