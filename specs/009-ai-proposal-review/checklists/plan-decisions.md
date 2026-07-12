# Plan Decisions Checklist: AI 提案审阅

**Purpose**：作为第一版规划的“需求/计划单元测试”，检查 scope、决策、契约、持久化和验证边界是否写清楚；不检查代码是否已经实现。
**Created**：2026-07-12
**Feature**：../spec.md
**Related plan**：../plan.md
**Related research**：../research.md

> 本清单专门提醒尚未拍板的事项。每项都应在实现 gate 前回答；候选库/工具不能因为出现在 research.md 就被视为已批准依赖。不要覆盖同目录已有的 requirements.md。

## Scope、依赖与 ADR

- [ ] CHK001 - 009 spec 是否已从 Draft 变为项目认可的 Accepted，且实现前置条件与 plan 的 Constitution Check 保持一致？ [Decision, Spec §Status]
- [ ] CHK002 - 004 Block editor、007 source/citation、008 task/proposal 三个直接依赖是否分别定义了 owner、输入输出和不重复拥有实体的边界？ [Traceability, Spec §Assumptions]
- [x] CHK003 - 008 spec 已将提案审阅统一写成 `009-ai-proposal-review`，不再需要旧编号兼容映射。 [Resolved, Traceability, Spec §Assumptions]
- [ ] CHK004 - ADR-001 是否已被接受，或是否明确需要新增 proposal-specific ADR 来覆盖 schema、pending transaction、Git/history handoff 和 recovery？ [Decision, Gap, plan §Constitution Check]
- [ ] CHK005 - provider 调用、task 执行、资料导入、history timeline UI、远程同步和协作是否在 009 scope/out-of-scope 中形成无矛盾的边界？ [Clarity, Spec §Scope]
- [ ] CHK006 - 是否已说明当前只有 startup foundation，且计划新增的 proposal/storage/editor 目录不会被误读为现有实现？ [Traceability, plan §Existing foundation vs planned additions]

## 候选库、平台能力与版本策略

- [ ] CHK007 - diff 方案是否已在“自研 Block-first、jsdiff 辅助、受控 Git patch”之间做出最终选择，并说明该选择不会把 diff 结果当作安全 apply 授权？ [Decision, research §Candidate group A]
- [ ] CHK008 - runtime schema validation 是否已在 Zod、TypeBox+Ajv、Valibot 或无第三方实现之间选定，并写明 unknown fields、错误映射和持久化 schema 的关系？ [Decision, research §Candidate group B]
- [ ] CHK009 - 原子写入/持久化是否已在 Node 原生 pending protocol、atomic write helper、SQLite 或组合方案之间选定，并与 ADR-001 的可读项目文件方向一致？ [Decision, research §Candidate group C]
- [ ] CHK010 - diff viewer 是否已在 React 原生 Block view、CodeMirror merge、Monaco diff editor 之间选定，并比较 accessibility、bundle、长文本和未来 004 editor 的适配？ [Decision, research §Candidate group D]
- [ ] CHK011 - 每个获选候选是否有明确的精确版本、Bun lockfile 更新策略、Electron 43 packaging/CSP/worker/native rebuild 影响和许可证审查记录？ [Decision, Gap, research §未决研究项清单]
- [ ] CHK012 - 如果最终不引入第三方包，plan 是否仍写清楚自研实现的规模上限、超时、错误行为和维护责任，而不是留下“以后实现”的空白？ [Clarity, Gap, plan §Technical Context]
- [ ] CHK013 - 候选技术的维护活跃性、最新兼容性和安全公告是否在实施前重新核对，而不是把本次研究日期的状态当作永久结论？ [Decision, Traceability, research §研究摘要]

## IPC、DTO、错误和 schema

- [ ] CHK014 - get/decide/preview/apply/recovery 的 named IPC 方法、channel namespace、请求/响应 DTO 和是否需要 preflight token 是否已冻结？ [Decision, contracts/proposal-ipc.md]
- [ ] CHK015 - IPC contract 是否明确禁止绝对路径、任意 patch、generic IPC、Git argv、provider secret 和 raw provider response 跨越 preload？ [Clarity, contracts/proposal-ipc.md]
- [ ] CHK016 - 所有 renderer-originated input 是否都有 main 侧 sender、project/proposal/change ownership、长度、状态和 revision 校验要求？ [Completeness, plan §Architecture and boundaries]
- [ ] CHK017 - stale、overlap、target missing、source invalid、storage failure、history handoff failure 和 recovery-required 是否都有稳定 error code、用户语义和不泄密的消息边界？ [Completeness, contracts/proposal-ipc.md]
- [ ] CHK018 - Proposal/Change/Storage envelope 的 kind、schemaVersion、projectId、revision、未知字段和未知版本处理是否已经清楚到可以写迁移契约？ [Decision, Clarity, data-model §Model principles]
- [ ] CHK019 - proposal 的 operation 集合是否明确只包含 replace/insert/delete，且 move/split/merge 等超出范围的变更不会被隐式支持？ [Clarity, Spec §FR-001, data-model §ProposalChange]
- [ ] CHK020 - accepted 是否被清楚区分为作者决定，applied 是否被限定为正文与 history handoff 成功后的 durable 结果？ [Clarity, Spec §FR-003, data-model §ProposalChange]

## 过期、冲突与资料依据

- [ ] CHK021 - 过期判定是否明确使用 project revision、Block fingerprint、stable ID 和必要的 order/anchor 信息，而不是只比较显示文本？ [Clarity, Spec §FR-007, data-model §TargetRef]
- [ ] CHK022 - 外部编辑删除、复制、重复或破坏 Block identity comments 时，要求是否明确为人工判断而非静默重绑定？ [Completeness, Spec §Edge Cases, data-model §Validation and invariants]
- [ ] CHK023 - 同一 proposal 内重叠、重复、anchor 矛盾和跨章节 target 的定义是否能让作者理解哪些 change 被阻塞？ [Clarity, Spec §FR-008]
- [ ] CHK024 - “重新确认”与“重新生成”的区别、触发条件、是否使用一次性 token、token 的 revision/TTL 是否已做出决定？ [Decision, Gap, plan §Phase 3]
- [ ] CHK025 - source/citation stale、missing、unverified、evidence insufficient 时，是阻止 apply、要求显式确认还是仅显示 warning，是否已在 009 与 007 之间统一？ [Decision, Conflict, Spec §FR-002, contracts/task-proposal-boundary.md]
- [ ] CHK026 - 部分接受、拒绝、暂缓、blocked 和后续继续审阅的状态转换是否与“剩余 change 不得静默丢失”保持一致？ [Consistency, Spec §FR-003–FR-006, data-model §State machines]

## 持久化、原子保存、恢复与迁移

- [ ] CHK027 - 批量 apply 是否明确为批次内 all-or-nothing，并且能清楚描述失败时 applied/pending/blocked 三组结果？ [Decision, Spec §Edge Cases, plan §Safe apply algorithm]
- [ ] CHK028 - review-only decision 写入与 content apply 写入的 revision、文件集合和原子性边界是否已经区分？ [Clarity, contracts/proposal-storage.md]
- [ ] CHK029 - pending transaction 的 phase、before/after hash、expected/next revision、attempts、retry/cleanup/ambiguous 判定和用户可见错误是否完整？ [Completeness, Gap, contracts/proposal-storage.md]
- [ ] CHK030 - crash after file replacement、history commit failure、权限不足、磁盘空间不足和外部修改是否都有 recovery/rollback 需求，而不只写“提供重试”？ [Coverage, Spec §FR-010, quickstart §场景 F]
- [ ] CHK031 - 是否已决定单文件 fsync/rename 语义、跨文件 coordinator、Git commit/handoff 顺序以及无法判定时保留当前正文的规则？ [Decision, contracts/proposal-storage.md]
- [ ] CHK032 - schema migration、旧 proposal 打开、unknown version、备份、回滚和失败后的兼容窗口是否已定义，并与 001 storage owner 归属一致？ [Decision, Gap, data-model §Save/recovery]
- [ ] CHK033 - 009 生成的 ProposalAppliedEvent 是否与 010 的 actor、event、task/proposal/source 关联和一次批量记录要求一致？ [Traceability, Spec §Assumptions, contracts/proposal-storage.md]

## 外部服务、凭据与离线边界

- [ ] CHK034 - 是否明确 009 不调用 provider、不读取密钥、不重跑 task，且 provider SDK/HTTP/worker protocol 由 005/008 负责？ [Clarity, Spec §Out of Scope, contracts/task-proposal-boundary.md]
- [ ] CHK035 - 008 的 completed proposal producer DTO、允许 review 的 task 完成态、invalid result 处理和持久化 owner 是否已接受？ [Decision, Gap, contracts/task-proposal-boundary.md]
- [ ] CHK036 - 无网络、provider 不可用、凭据缺失、source index 不可用时，009 使用 fixture/缓存的离线策略和可理解提示是否已写明？ [Decision, Gap, quickstart §前置准备]
- [ ] CHK037 - proposal/evidence 中可能出现的 secret-like 文本、完整路径、provider raw response 和用户敏感内容是否有脱敏/不落盘要求？ [Completeness, Spec §Edge Cases, contracts/proposal-ipc.md]

## 性能、可访问性与可观测性

- [ ] CHK038 - proposal 最大 change 数、单 Block 文本上限、批量上限、diff/apply/recovery timeout、p95 和内存预算是否已量化？ [Decision, Gap, plan §Technical Context]
- [ ] CHK039 - 009 的作者时间目标（60 秒指出差异、2 分钟部分接受）与工程性能阈值是否区分，并有可重复的 fixture/benchmark 定义？ [Clarity, Spec §Success Criteria, quickstart §场景 H]
- [ ] CHK040 - 键盘顺序、focus return、screen reader 状态播报、diff 的非颜色表达、冲突/失败/成功的可读文本是否覆盖所有 review actions？ [Completeness, Gap, Spec §User Story 1–3]
- [ ] CHK041 - loading、empty、invalid proposal、source unavailable、stale、blocked、saving、recovery 和 retry 的用户可理解文案/状态是否已定义？ [Coverage, Gap, Spec §Edge Cases]
- [ ] CHK042 - main 侧诊断是否包含足以定位 transaction/revision/error 的脱敏信息，同时不把路径、secret、raw provider data 或 stack trace 暴露给 renderer？ [Clarity, contracts/proposal-ipc.md]
- [ ] CHK043 - apply 取消、窗口关闭、重复提交、并行打开两个 proposal 和重启后继续审阅的行为是否已明确？ [Coverage, Gap, Spec §FR-003–FR-010]

## 验收、验证与可追溯性

- [ ] CHK044 - FR-001–FR-010、SC-001–SC-005、Edge Cases 是否都能追溯到 data-model、contracts、quickstart 的至少一个明确章节？ [Traceability, Spec §Requirements, §Success Criteria]
- [ ] CHK045 - quickstart 是否使用现有 bun run typecheck/test/build/test:smoke scripts，并区分当前 foundation smoke 与计划新增 proposal runtime smoke？ [Traceability, quickstart §基线命令]
- [ ] CHK046 - fixture 是否能证明“未选中章节/Block 不变”、source validity、overlap、stale、atomic failure 和 restart recovery，而不是只有 happy path？ [Completeness, quickstart §场景 A–G]
- [ ] CHK047 - 是否已决定哪些验证必须运行真实 Electron runtime，哪些可由 shared/unit/contract fixture 覆盖，并写明静态检查不能发现的 failure boundary？ [Decision, Constitution IV, plan §Validation strategy]
- [ ] CHK048 - 最终候选、ADR、IPC、storage schema、error codes、offline、性能、可访问性、recovery/migration 是否都在实现 gate 前有 owner、状态和决策链接？ [Decision, Traceability, plan §Constitution Check]
