# Planning Decision Checklist: Block 章节编辑器

Purpose: 检查需求/计划是否清晰，不是实现测试。
Feature: [spec.md](../spec.md)
Plan: [plan.md](../plan.md)

- [x] CHK001 是否已确认 Spec §FR-001–FR-016 的最小垂直切片、验收边界和 Out of Scope？ [Completeness, Traceability]
- [ ] CHK002 spec、ADR-001 和依赖 feature 是否都已 Accepted？ [Decision, Gap]
- [x] CHK003 是否已接受 BlockNote editor 方向，并冻结 package/version、UI adapter、许可证、维护策略和替代方案？ [Decision, Gap]
- [ ] CHK004 是否已冻结 durable schema、revision、migration、错误码和幂等语义？ [Decision, Gap]
- [ ] CHK005 是否已冻结 IPC/adapter contract、sender validation、redaction 和权限边界？ [Decision, Traceability]
- [ ] CHK006 是否已明确外部服务、凭据、离线/fake fixture 和隐私范围？ [Decision, Gap]
- [ ] CHK007 是否已定义取消、失败、部分成功、冲突、恢复和重试，且不会误报成功？ [Clarity, Gap]
- [ ] CHK008 是否已定义性能、可访问性、跨平台和大文件等客观阈值？ [Clarity, Gap]
- [ ] CHK009 是否已确认需要接受/新增的 ADR，并把决策放在 tasks.md 前置条件？ [Decision, Traceability]
- [ ] CHK010 是否已确认 BlockNote JSON 是章节 canonical document，Markdown 仅作为输入/粘贴/导出互操作？ [Decision, Traceability]
- [ ] CHK011 是否已冻结 custom block schema、unknown block migration、BlockNote block id 和 citation anchor 规则？ [Decision, Gap]
- [ ] CHK012 是否已定义 Markdown lossy warning、不可表达内容的 fallback，以及 export 失败与 canonical save 失败的边界？ [Clarity, Gap]

以上项目故意未勾选，待用户审阅后逐项决策。
