# Implementation Plan: 项目版本历史与恢复

Branch: codex/v2-greenfield  
Date: 2026-07-12  
Spec: [spec.md](./spec.md)  
Status: Draft / 第一版

## Summary

以单作者、线性、本地 history 记录人工/模型正文变更，支持 diff、范围恢复和失效引用提示。

## Current baseline

当前仓库已实现 001 project foundation，并有已接受的 ADR-003/011 UI foundation 设计；content history 尚未实现。已有命令为 bun run typecheck、bun run test、bun run test:smoke。以下计划只描述待实现能力。

## Technical Context

TypeScript 7.0.2、React 19.2.7、Electron 43、Vite 8.1.4、Bun 1.3.14；目标为 sandboxed desktop app。候选：系统 Git + simple-git、isomorphic-git、libgit2 binding；Git diff/patch、jsdiff、结构化 document diff。 Storage 暂沿用 ADR-001 的 main-owned project files 方向，但 ADR 状态仍为 Proposed。

## Constitution Check

- spec 与 storage ADR 仍为 Draft/Proposed，实现前需接受。
- renderer 只能调用 named typed preload IPC，main 验证所有输入并拥有文件/网络/凭据权限。
- durable schema、错误码、第三方包、native runtime 和性能阈值均保留 NEEDS DECISION。
- 验证必须包含 domain unit、contract test 和编译后的 Electron smoke。

Gate: BLOCKED until spec/ADR/contracts are Accepted。

## Implementation phases

1. 接受 ADR-001 history 条款，冻结 actor/event trailers、revision 和 binary policy。
2. 实现 GitRepository、timeline、diff read model 和 normalized history DTO。
3. 实现 project/chapter/block compare、restore plan 和非破坏 restore transaction。
4. 加入历史损坏、Git error、失效引用、恢复失败和真实 runtime smoke。

## Source structure

src/shared/history.ts; src/main/history/{git-repository,timeline,diff,restore}; src/renderer/features/history/; test/{fixtures,contract,smoke}/history/

## Boundary and validation

main owns files, Git, secrets, parsing jobs or restore transactions as applicable; preload exposes only named typed methods; renderer receives bounded DTOs. Domain logic must run without Electron/network. Unit tests cover Spec §FR-001–FR-010; contract tests cover DTO/error/redaction; runtime smoke covers 人工与模型成功保存均有记录；失败/取消不产生正文记录；任意两版本可比较；恢复生成新人工记录且不删除旧历史。

## Constitution Check（Phase 1 design 后复核）

本节只复核 Phase 1 已形成的设计材料，不把 Draft/Proposed 文档或尚未实现的测试当作实现授权。整体结论是：边界设计可供评审，但实现 gate 仍未通过。

| Principle | 状态 | Phase 1 证据 | 剩余 implementation gate |
|---|---|---|---|
| I. Secure Desktop Boundary | **PASS WITH ACCEPTANCE CONDITION** | `Boundary and validation` 已规定 main 拥有文件、Git、凭据、解析/处理和 restore transaction；`contracts/contract.md` 明确 renderer 不执行 Git，restore 经 WriteQueue 和 pending/recovery；ADR-001 §6–§8 规定 main-owned Git、路径/输入校验和不向 renderer 暴露任意命令。 | 接受 ADR-001 的 history/transaction 条款，并在编译后的 Electron runtime 验证 renderer 不能取得 Node/Electron、绝对路径、文件系统、Git 命令或凭据；任何 citation validity、history parsing 和 restore decision 都必须继续由 main 核验。 |
| II. Typed, Minimal IPC | **PASS WITH ACCEPTANCE CONDITION** | contract 只提出 `listHistory`、`compareHistory`、`planRestore`、`applyRestore` 四个命名能力；`data-model.md` 要求 `kind/schemaVersion`、stable identity、revision 和 validity 由 domain/main 产生或核验；计划要求 normalized、bounded history DTO，并覆盖 DTO/error/redaction。 | `contract.md` 当前仍把 contract version、DTO、错误码、取消/重试/恢复语义标为 NEEDS DECISION。实现前必须冻结 shared TypeScript request/response/error 类型、sender/project/revision 校验、DTO 字段与大小边界；changed files 只能是安全的 scope/相对标识，不得泄露绝对路径、raw Git response、secret 或 raw exception，也不得增加 generic IPC。 |
| III. Specification-Driven, Minimal Evolution | **BLOCKED** | `spec.md` 仍为 Draft，ADR-001 仍为 Proposed；`research.md` 的 Git/diff 选择仍为 `Decision: NEEDS DECISION`；`plan-decisions.md` 的 spec/ADR、schema、IPC、失败语义和候选依赖项均未勾选。 | 实现前必须接受本 feature spec、ADR-001 的 Git-backed history 与 pending recovery 条款，并冻结依赖 feature 的 project/content/citation/task-proposal handoff；同时决定 Git/diff adapter、版本/许可证/native runtime、durable schema/revision/migration、错误与幂等/取消语义。所有跨 durable/process boundary 的决定须进入已接受 ADR 或明确记录为不需要；在此之前不得生成实现任务或开始代码。 |
| IV. Verification at the Failure Boundary | **PASS WITH ACCEPTANCE CONDITION** | 计划已经把验证分到 domain unit、contract/redaction、main storage、preload bridge 和 compiled Electron smoke；`quickstart.md` 覆盖人工/模型成功、失败/取消、任意版本比较、恢复后新增人工记录和旧历史保留。设计也明确 Git diff/restore 不是 renderer 行为，失败不得报告成功。 | 必须按真实失败边界补齐可运行 fixture/fault injection，并把以下断言纳入实现验收：renderer→preload→main 的实际调用和 sender/DTO 校验；原子替换、Git commit、pending cleanup/recovery、history 损坏/不可读和错误 worktree；处理/AI 接受成功与拒绝、失败、取消不产生正文记录；010 不读取或回显凭据，模型记录只关联 task/proposal；旧版本失效 citation 在 `RestorePlan.invalidCitations` 中标记，apply 前阻止静默重绑，失败时当前正文不被覆盖。`bun run typecheck`/`test` 不能替代 `bun run build` + `bun run test:smoke` 的 Electron runtime 验证。Git runtime、故障注入 seam、稳定错误终态仍是 NEEDS DECISION。 |

### 最小方案复核

该设计仍是满足 FR-001–FR-010 的最小方案：以项目内、main-owned、单线性 Git 记录作为版本真相，直接复用 log/diff 和结构化 trailers；以一个 timeline/diff read model 和 bounded history DTO 提供查询，不引入第二套数据库或 raw Git UI；以 `planRestore` → `applyRestore` 通过既有串行 WriteQueue、pending/recovery 和一次新人工 commit 完成非破坏恢复。失效 citation 只是 restore plan 的显式阻断结果，不另建一套资料副本或静默重绑流程；失败/取消的 task 可保留系统追踪，但不进入正文版本。这正好覆盖记录、比较、恢复、历史保留和失效引用要求，同时保留远程同步、协作、分支/合并和未保存逐字版本在 scope 外。

### Post-design implementation gate

当前状态为 **BLOCKED UNTIL ACCEPTED**。下列接受项完成前，Phase 1 设计只能进入 review：

1. 接受 `spec.md`、ADR-001 及所依赖的 project/content/citation/task-proposal contracts，并确认 `main-owned Git history`、structured trailers、canonical content 和 pending transaction 是唯一 owner 边界。
2. 关闭 `plan-decisions.md` 中的 Git/diff 实现、history DTO/schema/revision/migration、稳定错误码、redaction、取消/重试/recovery 和跨平台 runtime 决策；未决项必须逐项 ACCEPT、REJECT 或拆成后续明确范围。
3. 为 `planRestore`/`applyRestore` 冻结 transaction precondition、invalid citation 的阻断与 rebind/remove 结果、commit 前后失败语义和幂等/retry 规则；任何不确定状态都返回 recovery-required，不得报告成功。
4. 准备真实或等价 Electron runtime fixture，覆盖 renderer/preload/main、存储/处理/凭据/Git 的失败边界，并证明任意失败都保留当前可恢复正文、旧历史和可解释错误。

本次没有申请 Constitution exception；以上复杂度均来自已接受需求所要求的安全和可恢复边界，若后续选型需要额外例外，必须在实现前补充 rationale、impact、approval 和被拒绝的更简单替代方案。

## Open decisions

候选：系统 Git + simple-git、isomorphic-git、libgit2 binding；Git diff/patch、jsdiff、结构化 document diff。

**Decision: NEEDS DECISION。** 本版不把候选写成批准依赖。

## ADR-003 / 011 renderer integration

- history timeline、版本状态、compare/restore actions 和 destructive confirmation 优先复用 `Card`、`Badge`、`Button`、`StatusNotice`、`ScrollArea` 和 `Dialog`；history parsing、restore plan 和 safety policy 仍归 010/main。
- content preview 使用 Typeset，但 compare/restore 以 editor-native canonical document 和 Git metadata 为真相，不能从 HTML/Markdown projection 反推 canonical content。
- 覆盖 semantic tokens、light/dark、forced-colors、reduced-motion、键盘比较/恢复流程和 focus return；共享缺口走 `FoundationExtensionRequest`。
