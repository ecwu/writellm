# Planning Decision Checklist: 可移动项目与启动工作区基础

Purpose: 检查需求/计划是否清晰，不是实现测试。  
Feature: [spec.md](../spec.md)  
Plan: [plan.md](../plan.md)

- [x] CHK001 是否已确认 Spec §FR-001–FR-014 的最小垂直切片、验收边界和 Out of Scope？ [Completeness, Traceability]
- [x] CHK002 spec、ADR-002 和 project IPC contract 是否都已 Accepted，并明确 ADR-001 的内容/Git history 条款不属于 001 前置条件？ [Decision, Gap]（spec、ADR-002 与 contract 均已接受；ADR-001 排除已确认）
- [x] CHK003 是否已选定候选库/工具、版本、许可证、维护策略和替代方案？ [Decision, Gap]（已确认升级并精确冻结 Bun 1.3.14、TypeScript 7.0.2、Electron 43.1.0、React/React DOM 19.2.7、Vite 8.1.4 及相关直接开发依赖；升级后四条基线命令必须先通过，不新增运行时库）
- [x] CHK004 是否已冻结 durable schema、revision、migration、错误码和幂等语义？ [Decision, Gap]（已接受 manifest-only v1 schema、无内容 revision、未知版本只读拒绝、不可续接 cleanup receipt 与用户发起重试语义）
- [x] CHK005 是否已冻结 IPC/adapter contract、sender validation、redaction 和权限边界？ [Decision, Traceability]（6-method contract 已接受；每次由 main-owned native dialog 选择位置，无默认目录设置，绝对路径不跨 IPC）
- [x] CHK006 是否已明确外部服务、凭据、离线/fake fixture 和隐私范围？ [Decision, Gap]（001 无外部服务或凭据，仅使用本地/fake fixture）
- [x] CHK007 是否已定义取消、失败、部分成功、冲突、恢复和重试，且不会误报成功？ [Clarity, Gap]
- [x] CHK008 是否已定义性能、可访问性、平台本地名称、单实例和大文件等客观边界？ [Clarity, Gap]（沿用 spec success criteria；不新增毫秒级 SLA 或大文件承诺）
- [x] CHK009 是否已确认需要接受/新增的 ADR，并把决策放在 tasks.md 前置条件？ [Decision, Traceability]（ADR-002 已接受且无需新增 ADR；tasks 已从接受后的设计重新生成，并包含依赖升级、只读项目验证与真实 Electron 双进程 smoke 前置条件）

产品澄清已经完成，技术 unknowns 也已由 Phase 0 研究解决；当前剩余的是正式接受门禁。
全部规划门禁已通过；001 可按重新生成的 `tasks.md` 从 T001 开始 implementation。
ADR-001 的内容/Git history 条款仍不属于 001 的前置条件。
