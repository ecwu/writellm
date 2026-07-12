# 规划决策检查清单：AI 写作任务与提案生成

**Purpose**：把本清单作为“需求/计划的 unit tests”，检查需求和设计是否足够清楚、完整、可追溯；不用于验证代码实现是否运行。  
**Created**：2026-07-12  
**Feature**：[spec.md](../spec.md) · [plan.md](../plan.md) · [research.md](../research.md)  
**Audience**：维护者、架构评审者、实现前决策人

## 范围、边界与需求完整性

- [ ] CHK001 — 是否明确限定本 feature 只负责 task 创建/执行/状态/取消/重试/证据不足/独立 proposal，并把 proposal 接受、正文写入和版本时间线分别交给 009/010？ [Clarity, Traceability, Spec §Scope]
- [ ] CHK002 — 是否明确“任务完成”与“提案被接受/正文被修改”是不同状态和不同 owner，且没有任何文字暗示 AI 结果会自动写入正文？ [Consistency, Traceability, Spec §FR-006–FR-007]
- [ ] CHK003 — 是否明确任务必须记录哪些目标块、资料范围、版本和 hash，才能满足“100% 能证明使用范围”的要求？ [Completeness, Traceability, Spec §FR-004, §SC-005]
- [ ] CHK004 — 是否解决 FR-003 的“有效资料范围”与 US3 的“资料不足/证据不足”之间的张力：空 source selection 是阻止提交，还是允许提交并标记 insufficient？ [Gap, Decision, Spec §FR-003, §User Story 3]
- [ ] CHK005 — 是否定义目标块被删除、重复、跨章节、稳定 ID 缺失或提交后版本变化时的不同处理，而不是统称为“失败”？ [Clarity, Traceability, Spec §Edge Cases, §FR-010]
- [ ] CHK006 — 是否区分 provider 返回“结构有效但证据不足”、返回“无法定位目标”和返回“响应格式非法”三类结果及其对 task/proposal 状态的影响？ [Clarity, Gap, Spec §FR-008, §FR-010]
- [ ] CHK007 — 是否明确任务指令的空白、控制字符、最大长度、语言/格式限制和超限提示，使 FR-001/FR-003 可被客观解释？ [Gap, Clarity, Spec §FR-001, §FR-003]

## 技术选型、版本与 ADR 决策

- [ ] CHK008 — 是否最终选定 provider 调用候选（原生 fetch、官方 SDK、provider-agnostic SDK 或 LangChain 类框架），并记录适用范围、排除理由和版本策略？ [Decision, Gap, Research §候选一]
- [ ] CHK009 — 是否最终选定网络 transport，并说明系统代理、TLS、stream、timeout、online/offline 判定和 Electron packaged runtime 的适配要求？ [Decision, Gap, Research §候选三]
- [ ] CHK010 — 是否最终选定 main async runner、Electron `utilityProcess`、`worker_threads` 或其他载体，并说明其退出、崩溃、取消、打包和 secret 生命周期语义？ [Decision, Gap, Research §候选二]
- [ ] CHK011 — 是否最终选定 schema/runtime validation 方案及其版本锁定、unknown field、schemaVersion、错误路径和迁移策略？ [Decision, Gap, Research §候选五]
- [ ] CHK012 — 是否最终选定自有 retry/concurrency policy 或候选库，并明确库默认值不能覆盖产品的 retry budget、cancel 和 durable attempt 规则？ [Decision, Gap, Research §候选四]
- [ ] CHK013 — 是否定义所有候选依赖的版本策略（精确版本/允许范围/lockfile/升级 cadence/安全漏洞处理/回滚），并明确它们尚未获准加入 `package.json`？ [Decision, Traceability, Gap, Spec §Assumptions]
- [ ] CHK014 — 是否在实现前接受 ADR-001，并明确是否需要新增 task/provider/storage/secret/worker ADR；所有跨进程或 durable boundary 的未决事项是否都有 owner 和接受条件？ [Decision, Gap, Traceability, ADR-001 §Status, Constitution §III]
- [ ] CHK015 — 是否明确当前 greenfield foundation 的 scope gate：spec、storage ADR、IPC/storage/error contract 未 Accepted 前不得生成 tasks.md 或实现产品代码？ [Clarity, Traceability, AGENTS.md, Constitution §III]

## IPC、DTO 与错误契约

- [ ] CHK016 — 是否冻结 renderer→preload→main 的方法白名单、channel 命名、request/response envelope、版本策略和 listener unsubscribe 语义？ [Decision, Gap, Traceability, Contract §命名方法]
- [ ] CHK017 — 是否明确每个 IPC 方法的项目身份、当前 workspace/session、chapter/block/source revision 和权限校验责任？ [Completeness, Traceability, Contract §Main 端安全校验, Spec §FR-001–FR-004]
- [ ] CHK018 — 是否明确 IPC DTO 只传 opaque IDs、非敏感摘要和必要版本/hash，禁止绝对路径、API key、raw provider response、任意 endpoint 和通用 command？ [Clarity, Traceability, Contract §Request DTO, AGENTS.md]
- [ ] CHK019 — 是否冻结 task status、`cancelRequested`、attempt number、proposal readiness 和 stale/manual-review 字段，避免 UI 自己推断状态？ [Clarity, Decision, Contract §Response DTO, Spec §FR-004–FR-005]
- [ ] CHK020 — 是否冻结错误码集合、retryable 矩阵、用户 message、diagnostic ID、provider status/Retry-After 是否外露以及 Electron IPC error serialization 规则？ [Decision, Gap, Traceability, Data Model §TaskAttempt, Contract §Error DTO]
- [ ] CHK021 — 是否明确 task update event 只推送哪类脱敏状态、是否允许 progress、事件丢失后如何由 get/list 恢复，以及窗口销毁时如何清理 listener？ [Completeness, Gap, Traceability, Contract §Task update event]
- [ ] CHK022 — 是否明确没有 `applyProposal`、`getSecret`、`readFile`、`runProvider` 或 generic IPC 的契约，并说明 009 的读取边界？ [Consistency, Traceability, Contract §责任边界, Spec §Out of Scope]

## 状态机、取消、重试与异常场景

- [ ] CHK023 — 是否明确 queued/running/completed/failed/canceled/interrupted 的定义、允许转换、终态和非法转换的错误？ [Clarity, Traceability, Spec §FR-005, §Edge Cases]
- [ ] CHK024 — 是否明确 queued/running 取消的幂等性、取消请求无法立即中断时的 UI/durable 状态、迟到 provider chunk 的处理和是否产生 proposal？ [Gap, Decision, Spec §FR-009]
- [ ] CHK025 — 是否明确 retry 只能由作者显式触发还是允许恢复自动触发，并定义 attempt 是否追加、taskId 是否复用、completed task 是否不可覆盖？ [Decision, Clarity, Spec §FR-009, §FR-010]
- [ ] CHK026 — 是否定义超时、429、5xx、网络中断、认证失败、invalid response、用户取消和应用退出各自的 retryable/terminal 语义？ [Completeness, Gap, Traceability, Research §候选四]
- [ ] CHK027 — 是否明确一个 task 同时只允许一个 running attempt，以及队列并发、排队上限、重复提交和重复 cancel 的产品语义？ [Clarity, Gap, Spec §FR-004–FR-005]
- [ ] CHK028 — 是否明确 Electron main 崩溃、utility/worker 退出、窗口关闭、系统休眠和应用重启后 running task 如何变成 interrupted、queued 或 failed？ [Recovery, Decision, Gap, ADR-001 §7]

## Storage schema、恢复与迁移

- [ ] CHK029 — 是否冻结 `ai/tasks/<taskId>.json`、`ai/proposals/<proposalId>.json` 的 kind/schemaVersion/projectId/required fields，以及 proposal 与 task 的一对零或一关系？ [Decision, Traceability, Data Model §持久化布局]
- [ ] CHK030 — 是否明确任务上下文保存 exact selected content，还是 references + revisions + hashes，并说明隐私、文件大小、可复现性和资料替换后的语义？ [Decision, Gap, Traceability, Data Model §TaskContextSnapshot]
- [ ] CHK031 — 是否明确 task/proposal index 是 canonical truth、可重建 cache 还是完全不存在，并规定 index 损坏、缺失和重复记录的处理？ [Gap, Clarity, ADR-001 §5, Data Model §持久化布局]
- [ ] CHK032 — 是否明确 task/proposal 写入如何接入 ADR-001 的串行 writer、同目录 temp+rename、pending transaction、Git task event commit 和 commit 失败恢复？ [Completeness, Traceability, ADR-001 §6–§7]
- [ ] CHK033 — 是否明确失败/取消 task event 的 Git trailers、`WriteLLM-Content-Change=false`、正文 revision 不变和 010 可读的 task/proposal ID？ [Clarity, Traceability, ADR-001 §6, Data Model §持久化布局]
- [ ] CHK034 — 是否定义未知 schemaVersion、缺失字段、旧 task/proposal、部分写入、损坏 JSON 和 migration 不可判断时的用户可执行结果？ [Recovery, Gap, Traceability, ADR-001 §5/§7]

## Provider、凭据、外部服务与离线策略

- [ ] CHK035 — 是否明确 008 只消费 005 的 provider summary/config revision/secret capability，且 provider profile selection 与 secret storage 的 owner 和接口版本已经冻结？ [Decision, Traceability, Spec §Assumptions, Research §候选六]
- [ ] CHK036 — 是否明确 secret 在 main/worker/utility 的最短生命周期、不得进入 task/proposal/IPC/log/Git/crash dump 的规则，以及 Linux protected storage 不可用时是拒绝还是降级？ [Security, Decision, Gap, Spec §005 FR-004/FR-008, Research §候选六]
- [ ] CHK037 — 是否明确外部 provider 会接收哪些正文/资料、是否记录/训练、数据保留/删除、区域/合规、企业代理和用户告知要求？ [Gap, Decision, Traceability, Spec §Assumptions]
- [ ] CHK038 — 是否明确无网络/服务不可用/凭据失效时，用户能否创建本地 queued task、是否立即失败、如何取消、何时恢复和是否自动 retry？ [Offline, Decision, Gap, Spec §Edge Cases]
- [ ] CHK039 — 是否冻结 provider/model/endpoint 的显示与 durable snapshot 字段，避免 URL query secret、provider-specific options 或 raw request body 被保存？ [Security, Clarity, Traceability, Contract §Provider 输入]

## 性能、可访问性与可观测性要求

- [ ] CHK040 — 是否为任务创建响应、首个 queued/running 状态更新、取消确认、单次 timeout、总耗时、并发数、队列长度和 fixture/真实 provider smoke 设定可测阈值？ [Performance, Gap, Decision, Spec §SC-001–SC-005]
- [ ] CHK041 — 是否明确大 instruction、多个 target/source、provider response、partial stream 和 proposal 文件的大小上限、背压和内存策略？ [Performance, Gap, Traceability, Data Model §校验清单]
- [ ] CHK042 — 是否明确 loading/running/canceling/failed/insufficient/stale/manual-review 状态不只依赖颜色，并定义键盘可达、焦点、读屏文案和错误恢复入口？ [Accessibility, Gap, Traceability, Spec §FR-004/FR-009, Dependency §002 FR-006/FR-008]
- [ ] CHK043 — 是否明确本地日志、diagnostic ID、attempt metrics、provider request ID、token usage 的采集范围、脱敏规则、保留期限和关闭方式？ [Security, Gap, Decision, Contract §Provider error]

## 验收、依赖与可追溯性

- [ ] CHK044 — 是否把每个 FR-001–FR-010 映射到 data model、IPC/provider contract 和 quickstart 场景，而不是只写“有测试”？ [Traceability, Completeness, Spec §FR-001–FR-010]
- [ ] CHK045 — 是否把每个 SC-001–SC-005 映射到可观察的 runtime evidence、fixture 数据和性能/可用性门槛，并明确哪些当前 foundation 尚不能证明？ [Traceability, Clarity, Spec §SC-001–SC-005]
- [ ] CHK046 — 是否明确 004 的 block revision/identity、005 的 provider config/secret、007 的 source/chunk/location、009 的 proposal review 和 010 的 history contract 何时 Accepted？ [Dependency, Decision, Traceability, Spec §Assumptions]
- [ ] CHK047 — 是否明确 local fixture provider、临时 `.writellm` 项目、pending transaction 注入、Electron compiled smoke 和真实外部 provider opt-in 的准备责任？ [Completeness, Gap, Traceability, Quickstart §1/§外部 provider]
- [ ] CHK048 — 是否明确本 feature 的 quickstart 在当前 foundation 阶段只能通过 baseline scripts 证明启动，feature-specific runtime smoke 需实现后补齐，避免把规划文档误当成已实现功能？ [Clarity, Traceability, AGENTS.md, Quickstart §0/§当前尚未具备]
- [ ] CHK049 — 是否明确不生成 `tasks.md`、不实现源码、不运行联网安装，直到上述 Decision/Gap 项有记录的维护者答案和接受的 ADR/contract？ [Decision, Traceability, User scope, Plan §Phase 1]
- [x] CHK050 — 已将 `spec.md` Scope 中的下游 feature 统一为 `009-ai-proposal-review`，并同步 plan 与交接契约引用。 [Resolved, Traceability, Spec §Scope, Plan §依赖命名已统一]
