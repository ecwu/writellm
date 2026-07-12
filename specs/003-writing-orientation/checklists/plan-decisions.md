# Plan Decisions Checklist: 写作动机与文章大纲

**Purpose**: 作为第一版规划的“需求/计划单元测试”，检查写作方向的 scope、数据、跨进程边界、持久化恢复、非功能要求和未决技术选择是否已经写清楚；不检查代码是否实现。
**Created**: 2026-07-12
**Feature**: [spec.md](../spec.md)；关联 [plan.md](../plan.md)、[research.md](../research.md)、[data-model.md](../data-model.md) 和 [contracts/](../contracts/)

## 需求完整性与范围

- [ ] CHK001 是否明确区分“动机全空仍可保存”与“空白大纲标题不得保存”的需求、状态文案和验收语义？ [Completeness, Spec §Edge Cases, Spec §FR-007]
- [ ] CHK002 是否为动机的“问题、目标读者、预期结果”分别定义允许为空、文本格式和最大长度，而不是只写“内容完整”？ [Clarity, Spec §User Story 1, Gap]
- [ ] CHK003 是否明确大纲条目的摘要可为空、标题不得为空、状态三态的值域，以及每个字段的保存边界？ [Completeness, Spec §FR-003, Spec §Edge Cases]
- [ ] CHK004 是否明确重复条目的判定依据是稳定 ID、标题还是其他业务规则，并与“不能产生重复条目”保持一致？ [Clarity, Spec §SC-004, Gap]
- [ ] CHK005 是否明确“最近一次编辑位置”包含面板、选中条目、焦点和滚动中的哪些部分，以及哪些部分属于 002？ [Completeness, Spec §User Story 3, Gap]
- [ ] CHK006 是否明确本 feature 不拥有章节正文、资料、AI、provider、版本历史和多层嵌套，并为每个排除项给出跨 feature 责任归属？ [Traceability, Spec §Scope, Spec §Assumptions]
- [ ] CHK007 是否明确“保存动机或大纲不影响其他项目内容”所覆盖的文件、revision 和 Git event 范围？ [Clarity, Spec §FR-006, Gap]

## 持久化与跨边界决策

- [ ] CHK008 是否已接受 ADR-001，并明确 portable root、canonical JSON、project-local Git、pending transaction 和 recovery 规则后再实施？ [Decision, Gap]
- [ ] CHK009 是否已接受 001 的 project IPC/storage contract，使 projectId、project session、revision、错误码和目录验证不在 003 中重复定义？ [Decision, Gap]
- [ ] CHK010 是否已接受 002 的 workspace/location contract，明确写作方向位置与内容保存是否同一事务？ [Decision, Gap]
- [ ] CHK011 是否已经在计划中明确 canonical document 的路径、kind、schemaVersion、revision scope、未知字段策略和迁移窗口？ [Decision, Gap]
- [ ] CHK012 是否明确单文件原子写入与多文件/Git 事务的区别，并记录 pending 在每个中断阶段的可解释状态？ [Clarity, ADR-001, Gap]
- [ ] CHK013 是否明确外部修改、权限不足、磁盘满、Git commit 失败和 pending 状态不确定时，哪些路径可重试、只读或必须人工处理？ [Completeness, Spec §FR-007, Gap]
- [ ] CHK014 是否明确 renderer 当前 dirty 草稿、main pending transaction 和最近一次成功保存之间的恢复边界，尤其是未发送草稿在崩溃后的承诺？ [Decision, Spec §FR-007, Gap]

## 库、工具与版本策略

- [ ] CHK015 是否最终选定 schema validator 候选（手写 guard、Zod、Valibot 或其他），并记录包名、版本范围、锁定策略、运行位置和升级责任？ [Decision, research.md, Gap]
- [ ] CHK016 是否最终选定 atomic writer 候选（Node fs、write-file-atomic、atomically 或其他），并明确 fsync、重试、权限和跨平台验证策略？ [Decision, research.md, Gap]
- [ ] CHK017 是否最终选定 Git history adapter（携带 Git runtime、isomorphic-git 或其他），并明确平台打包、许可证、安全更新、binary/cache 和失败策略？ [Decision, ADR-001, Gap]
- [ ] CHK018 是否最终选定大纲排序能力（语义按钮/平台能力、dnd-kit、Pragmatic DnD/React Aria 或其他），并明确 React 19 适配、无障碍责任和版本策略？ [Decision, Spec §SC-003, Gap]
- [ ] CHK019 是否最终选定 durable ID 的生成位置和格式（main/runtime crypto、uuid 包或其他），并明确未来迁移、chapterRef 稳定性和重复提交语义？ [Decision, data-model.md, Gap]
- [ ] CHK020 是否明确现有 Electron 40.10.5、React 19、Bun 1.3.4、TypeScript 5.8.x 的支持窗口、升级策略和新增依赖的批准条件？ [Decision, research.md, Gap]

## IPC Contract 与错误语义

- [ ] CHK021 是否冻结 renderer↔preload↔main 的方法名、method 粒度、请求/响应 DTO 和是否并入 001 `saveProjectWorkspace`？ [Decision, contracts/writing-orientation-ipc.md, Gap]
- [ ] CHK022 是否为每个 renderer-originated failure 定义稳定 error code、用户可执行动作、retryable 语义和不泄露路径/secret 的 details 规则？ [Completeness, contracts/writing-orientation-ipc.md, Spec §FR-007]
- [ ] CHK023 是否明确 base revision、client mutation ID、重复提交、过期保存和冲突后的 reload/merge 责任？ [Clarity, Spec §Edge Cases, Gap]
- [ ] CHK024 是否明确 main 在 IPC sender、projectId、绝对路径、数组唯一性、文本控制字符、大小和 chapter association 上的运行时校验责任？ [Completeness, Constitution §I–II, contracts/writing-orientation-ipc.md]
- [ ] CHK025 是否明确 IPC 返回值只含 structured-clone 可序列化 DTO，并排除 generic IPC、Node/Electron 对象、raw Error、文件路径和 Git 参数？ [Traceability, Constitution §I–II, Gap]

## 章节关联与场景覆盖

- [ ] CHK026 是否明确有 chapterRef 时删除大纲条目的确认对象、影响提示、取消结果以及 003 与 004 各自负责的删除行为？ [Completeness, Spec §Edge Cases, Spec §Assumptions]
- [ ] CHK027 是否明确 chapter 缺失、重复、外部变更或 needs_review 时大纲列表显示什么，并禁止静默重绑定？ [Clarity, Spec §FR-003, Gap]
- [ ] CHK028 是否明确大纲状态与章节是否存在的关系，避免“未开始/进行中/已完成”被章节 lifecycle 隐式覆盖？ [Consistency, Spec §FR-005, data-model.md]
- [ ] CHK029 是否覆盖主流程、空状态、异常保存、revision 冲突、恢复、外部修改、重启位置和关联章节删除等至少两类以上 scenario，并指向 quickstart 场景？ [Coverage, Spec §User Scenarios & Testing, quickstart.md]

## 非功能、可访问性与可衡量性

- [ ] CHK030 是否明确普通文档的 load/save p95、最大动机/摘要长度、最大条目数和 100 次保存/重开测试的可接受资源范围？ [Decision, Spec §SC-002, Gap]
- [ ] CHK031 是否明确支持的操作系统、最小 Electron/Node runtime、Git runtime availability 和离线时的功能降级/阻塞行为？ [Decision, plan.md, Gap]
- [ ] CHK032 是否明确键盘排序等价路径、焦点恢复、读屏身份/位置/状态、错误 announcement、非颜色状态和 960×640 窄窗口要求？ [Completeness, Spec §Assumptions, Gap]
- [ ] CHK033 是否明确“可执行的重试提示”“尚未填写”“需要检查”和“影响章节”等用户可见文案的可理解性、语言和本地化责任？ [Clarity, Spec §FR-007–FR-008, Gap]
- [ ] CHK034 是否明确无网络、无 provider credentials、无外部 worker 时本 feature 的完整可用范围，并避免把外部服务误写成前置依赖？ [Decision, Spec §Scope, Gap]

## 验证与可追溯性

- [ ] CHK035 是否把每个 FR-001～FR-008 和 SC-001～SC-004 映射到 plan phase、data-model 规则、IPC/storage contract 和 quickstart 场景？ [Traceability, Spec §Requirements, Gap]
- [ ] CHK036 是否明确哪些问题由 Bun/domain test、storage integration、compiled Electron smoke、手工 workspace/a11y 审查分别回答，而不是把 checklist 变成实现测试？ [Clarity, Constitution §IV, quickstart.md]
- [ ] CHK037 是否在进入 tasks 前处理所有标记为 `Decision: NEEDS DECISION` 的跨系统、跨进程、持久化、恢复、性能、可访问性和迁移项？ [Decision, Constitution §III, Gap]

## Notes

- 每项检查需求/规划是否写清楚、完整、可追溯；不要把本文件当作代码测试用例。
- `[Decision]` 表示需要用户/维护者明确选择；`[Gap]` 表示当前 spec/plan/contract 缺少必要信息；`[Clarity]`、`[Completeness]`、`[Consistency]`、`[Coverage]`、`[Traceability]` 表示要审查的需求质量维度。
- 技术候选均不是已批准依赖；只有接受后的决策才能进入 `tasks.md` 和实现。
