# Planning Decision Checklist: AI Provider 设置与密钥状态

Purpose: 检查需求/计划是否清晰，不是实现测试。  
Feature: [spec.md](../spec.md)  
Plan: [plan.md](../plan.md)

- [x] CHK001 已由 spec、plan Summary/Boundary 和 quickstart 确认最小垂直切片、验收边界和 Out of Scope。 [Completeness, Traceability]
- [x] CHK002 依赖 001/002/011 与 ADR-003 已 Accepted；005 spec/plan 和 ADR-004 已由 maintainer 接受。ADR-001 明确不适用于 application-global provider state。 [Decision]
- [x] CHK003 已选 Electron 43 async safeStorage + pinned Pi Agent/AI/TypeBox tool-loop runtime + 手写设置边界 parsers；替代方案和维护边界见 research。 [Decision]
- [x] CHK004 data-model 已冻结 schema v1、opaque revision/CAS、无自动 migration、错误码和 stale/idempotency 语义。 [Decision]
- [x] CHK005 contract 已冻结五方法 IPC/adapter、expected sender、exact parsing、redaction 和 main 权限边界。 [Decision, Traceability]
- [x] CHK006 quickstart 已定义 local fake provider/protector、真实服务非默认前置、凭据生命周期和隐私扫描范围。 [Decision]
- [x] CHK007 contract/data-model 已定义取消、失败、冲突、crash reconciliation、stale result 和 retry。 [Clarity]
- [x] CHK008 plan/quickstart 已定义 30 s/two-turn probe cap、输入上限、960×640/200% zoom、appearance/accessibility 与平台 secret-unavailable 行为；大文件不适用。 [Clarity]
- [x] CHK009 ADR-004 已 Accepted；plan 明确 tasks/implementation 以 spec/plan/ADR 接受和 registry 同步为前置。 [Decision, Traceability]

技术决策与 maintainer acceptance gate 均已关闭。当前可生成并审查 implementation tasks；
在 `tasks.md` 生成前不修改产品代码。
