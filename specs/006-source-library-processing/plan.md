# Implementation Plan: PDF 资料导入与处理

Branch: codex/v2-greenfield  
Date: 2026-07-12  
Spec: [spec.md](./spec.md)  
Status: Draft / 第一版

## Summary

导入本地 PDF，保存原始资料和可追溯解析产物，生成 Markdown、图片/表格关系、文本块和 embedding 状态。

## Current baseline

当前仓库已实现 001 project foundation，并有已接受的 ADR-003/011 UI foundation 设计；source processing 尚未实现。已有命令为 bun run typecheck、bun run test、bun run test:smoke。以下计划只描述待实现能力。

## Technical Context

TypeScript 7.0.2、React 19.2.7、Electron 43、Vite 8.1.4、Bun 1.3.14；目标为 sandboxed desktop app。候选：pdf-parse、pdfjs-dist/unpdf、MuPDF.js、Apache Tika；embedding 可来自 provider、Transformers.js 或 ONNX helper；job 可在 main/worker/utility process。 Storage 暂沿用 ADR-001 的 main-owned project files 方向，但 ADR 状态仍为 Proposed。

## Constitution Check

- spec 与 storage ADR 仍为 Draft/Proposed，实现前需接受。
- renderer 只能调用 named typed preload IPC，main 验证所有输入并拥有文件/网络/凭据权限。
- durable schema、错误码、第三方包、native runtime 和性能阈值均保留 NEEDS DECISION。
- 验证必须包含 domain unit、contract test 和编译后的 Electron smoke。

Gate: BLOCKED until spec/ADR/contracts are Accepted。

## Implementation phases

1. 冻结 Source、ParsedArtifact、TextChunk、ProcessingRun 和状态机。
2. 实现安全导入、去重、原件复制和可重建 artifact layout。
3. 实现 parser/chunker/embedding adapters 与进度、取消、重试。
4. 加入损坏/密码/无文字/重复/部分失败/大文件 fixtures。

## Source structure

src/shared/source-processing.ts; src/main/sources/{import,parser,chunker,embedding,jobs}; src/renderer/features/sources/; test/{fixtures,contract,smoke}/sources/

## Boundary and validation

main owns files, Git, secrets, parsing jobs or restore transactions as applicable; preload exposes only named typed methods; renderer receives bounded DTOs. Domain logic must run without Electron/network. Unit tests cover Spec §FR-001–FR-010; contract tests cover DTO/error/redaction; runtime smoke covers 有效/无效 PDF；阶段状态可恢复；仅有 text+embedding+location 才可检索；失败保留 partial artifacts 并可重试。

## Constitution Check（Phase 1 design 后复核）

本复核只评估 Phase 1 已形成的设计材料，不重复研究前检查。依据是 [data-model.md](./data-model.md)、[contracts/contract.md](./contracts/contract.md)、[quickstart.md](./quickstart.md)、本计划的 `Source structure` 与 `Boundary and validation`，以及 [ADR-001](../../docs/adr/001-project-storage.md) 的 Proposed 方向。

| 原则 | 设计后状态 | Phase 1 证据 | 剩余 implementation gate |
|---|---|---|---|
| I. Secure Desktop Boundary | **PASS WITH ACCEPTANCE CONDITION** | `contract.md` 明确 `importSourceFromDialog` 等能力跨边界而不是传递原始二进制或绝对路径，并禁止 secret echo、任意路径和未约束外部 response；`data-model.md` 要求 stable identity、revision、validity 由 main/domain 产生或核验；本计划把文件、Git、secrets、parser/chunker/embedding jobs 和 restore transaction 放在 main。 | 接受 ADR-001，并冻结 source dialog/import 的 main owner、项目 session 校验、解析/切分/embedding adapter 的执行位置及凭据 owner。实现与 runtime smoke 必须证明 renderer 不获得 Node/Electron、路径、原始 PDF、provider secret 或任意文件能力；外部 parser/provider 的返回必须先由 main 验证，失败不得被包装成成功。 |
| II. Typed, Minimal IPC | **PASS WITH ACCEPTANCE CONDITION** | `contract.md` 只列出 `importSourceFromDialog`、`startProcessing`、`getProcessingStatus`、`retryProcessing`、`cancelProcessing` 五个 named methods；request/response/error 要有 shared TypeScript 类型和 main runtime validation，状态更新可重放，preload 不暴露 generic IPC。 | 在实现前接受并冻结 channel/version、DTO 字段与大小边界、稳定错误码、redaction、sender/project 校验、状态更新重放顺序，以及 cancel/retry/recovery 的返回语义。必须逐一验证 compiled preload 的暴露面；不得以 `invoke/send/on` 通用包装或新增未审查的 source IPC 代替这些窄方法。 |
| III. Specification-Driven, Minimal Evolution | **BLOCKED UNTIL ACCEPTANCE** | `spec.md` 仍为 Draft，ADR-001 仍为 Proposed；`research.md` 仍为 `Decision: NEEDS DECISION`；数据模型没有冻结 schemaVersion、revision/migration、幂等与错误码，contract 也明确把 contract version、DTO、取消/重试/恢复语义留为 NEEDS DECISION。 | 实现前必须接受本 feature spec、ADR-001，并逐项关闭 [checklists/plan-decisions.md](./checklists/plan-decisions.md)：至少包括 parser/embedding/job placement、依赖/许可证/打包策略、durable schema 与 revision/idempotency、source IPC、凭据/离线策略、partial artifact 与 Git/recovery 语义。未关闭的跨进程或 durable decision 必须进入 ADR 或明确记录为不需要；不能在 tasks 或代码中自行补拍板。 |
| IV. Verification at the Failure Boundary | **NEEDS DECISION** | 本计划已要求 domain unit、DTO/error/redaction contract test 和 compiled Electron smoke；`quickstart.md` 已列有效/无效 PDF、可恢复阶段、可检索资格、partial artifact 与 retry 场景；`data-model.md` 规定保存/应用/恢复失败必须返回结构化错误且不能报告成功。 | Phase 1 尚未定义真实 Electron fixture/harness、故障注入 seam 或各边界的通过断言；必须在实现前补齐并接受下表所列 renderer/preload/main、storage、processing、credentials、Git 场景。仅有 `typecheck`、静态 contract 或 renderer unit 不足以关闭本原则。 |

### 最小方案与复杂度结论

设计仍是满足需求的最小方案：以 `Source`、`ParsedArtifact`、`TextChunk`、`ProcessingRun` 四类已有实体承载资料、可追溯产物、检索资格和一次处理历史；由 main 维护一条可取消/可重试的处理编排链，parser、chunker、embedding 只通过窄 adapter 隔离选型；以五个 named IPC 方法传递 bounded DTO，而不是暴露通用文件或任务通道；失败时保留已完成的 partial artifacts 并新建/重试 run，不引入搜索界面、引用写入、AI 写作、独立数据库或自研 PDF 引擎。项目文件、原子写入、pending recovery 和 Git 继续复用 ADR-001 的 main-owned 方向，不为本 feature 增加第二套持久化模型。

这不是 Constitution exception。需要的额外复杂度（处理状态、partial artifact、取消/重试和恢复记录）直接来自 FR-007–FR-009 与边界安全要求；parser/embedding 包、worker/native runtime、凭据方案和 Git 事件细节在接受前仍是未决项，不能以“最小方案”名义隐式选定。

### 失败边界接受项

| 真实失败边界 | Phase 1 必须验证的行为 | 当前状态与实现前接受项 |
|---|---|---|
| renderer | 只渲染 bounded source/status/error DTO；可区分 importing/parsing/chunking/embedding/available/partial/failed；取消、重试和部分产物提示不会把资料误列为可引用。 | **PASS WITH ACCEPTANCE CONDITION**：必须在 compiled Electron 中验证 renderer 收不到 path、原始 PDF、secret，并能在失败/取消后显示可恢复状态；不能只测 React 状态。 |
| preload | 五个 named methods 与 shared contract 一一映射；无 generic IPC、raw `ipcRenderer`、任意 listener 或未约束 response。 | **PASS WITH ACCEPTANCE CONDITION**：补充 compiled preload 暴露面断言、未知/超大/非法 DTO 拒绝断言，并验证状态更新可重放而不是只依赖一次性 UI 事件。 |
| main / source IPC | main 校验 sender、当前 project session、导入选择、类型/格式、重复处理选择、run/source identity 和请求范围；parser/chunker/embedding 的取消信号、超时、错误和 retryability 由 main 归一化。 | **NEEDS DECISION**：必须冻结错误码、幂等键、duplicate choice、cancel 的终态、retry 是否创建新 `ProcessingRun`、重启后状态恢复和外部 response 校验规则，然后用 runtime-level IPC 场景验证。 |
| storage / partial artifacts | 原始 PDF、Markdown、图片/表格关系、chunks 和 embedding 状态以可追溯 revision 保存；任一阶段失败保留可用 partial artifacts；原子写入、pending 和恢复不能覆盖有效原件或误报成功。 | **NEEDS DECISION**：ADR-001 尚未接受，且未定义 source artifact layout、文件级/处理 run 级提交边界、partial artifact 的有效性标记、crash-after-replace 和 unknown recovery 的处理；需在 storage contract/ADR 中冻结并用临时 project fixture 注入写入、rename、恢复失败。 |
| processing adapters | 损坏、加密、无文字 PDF，图片/表格提取失败，chunk 边界不足，embedding timeout/429/malformed result 都产生可解释状态；只有 text+embedding+location 的 chunk 可进入可检索。 | **NEEDS DECISION**：`research.md` 尚未选 parser、embedding 或 job placement，也没有 deterministic fake adapter 与故障注入协议；实现前需选择或明确自研窄 adapter、版本/许可证/离线策略，并用 fixture 验证不把未经验证结果标为 available。 |
| credentials / external processing | 凭据只能由 main-owned capability 取得并用于外部处理；renderer、preload、日志和错误 DTO 不得看到 secret；超时、认证失败、不可验证响应和离线时不报告成功。 | **NEEDS DECISION**：Phase 1 没有冻结 provider/credentials owner、数据出境范围、脱敏规则、fake/offline adapter 或重试退避；需在相关 ADR/contract 中接受，并用无网络、认证失败和日志 redaction fixture 验证。 |
| Git / history | source import、processing completion、partial failure、cancel 和 retry 的 history event 与 source/run revision 可追溯；commit 失败或提交状态未知时返回恢复状态，不把文件替换误报为成功。 | **NEEDS DECISION**：ADR-001 的 main-owned Git 方向仍 Proposed，本计划未决定每个阶段是否提交、partial artifact 是否进入 commit、retry 如何关联历史、crash recovery 如何重试；需冻结 Git event/trailer、pending transaction 和 commit failure 语义，并注入 commit failure/replace-before-commit 场景。 |

**Post-design implementation gate：BLOCKED。** 设计可以进入 review，但不能生成 tasks 或开始实现，直到 spec 与 ADR-001 被接受，source IPC/数据模型/处理 adapter/凭据/存储与 Git 语义完成上述冻结，并且 quickstart 的真实 Electron runtime 验证能够覆盖 renderer→preload→main→storage/processing→Git 的成功、取消、重试、部分失败和恢复路径。无条件 PASS 尚未成立；任何未决项必须保留为 `NEEDS DECISION` 或写入可接受的 ADR/contract，而不能沉淀为实现者的默认选择。

## Open decisions

候选：pdf-parse、pdfjs-dist/unpdf、MuPDF.js、Apache Tika；embedding 可来自 provider、Transformers.js 或 ONNX helper；job 可在 main/worker/utility process。

**Decision: NEEDS DECISION。** 本版不把候选写成批准依赖。

## ADR-003 / 011 renderer integration

- source list、processing status、empty/error states 和导入确认优先组合 `Card`、`Badge`、`StatusNotice`、`EmptyState`、`Button`、`ScrollArea` 和 `Dialog`；processing/domain truth 仍归 006。
- 解析内容 preview 使用 source-owned Typeset preset；图片/表格关系和 artifact identity 不因 appearance 改变，appearance 不进入 project files 或 exports。
- feature 不直接导入 Base UI 或复制 primitive；覆盖 semantic tokens、light/dark、forced-colors、reduced-motion、键盘与焦点，缺口走 `FoundationExtensionRequest`。
