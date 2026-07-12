# Implementation Plan: AI Provider 设置与密钥状态

Branch: codex/v2-greenfield  
Date: 2026-07-12  
Spec: [spec.md](./spec.md)  
Status: Draft / 第一版

## Summary

保存 provider 非敏感配置与密钥状态，支持替换和验证，禁止回显或明文 fallback。

## Current baseline

当前仓库只有 Electron main/preload/shared/React renderer 的 startup foundation；已有命令为 bun run typecheck、bun run test、bun run test:smoke。以下计划只描述待实现能力。

## Technical Context

TypeScript 5.8、React 19、Electron 40、Vite 6、Bun 1.3.4；目标为 sandboxed desktop app。候选：Electron safeStorage、keytar、平台 Keychain；Vercel AI SDK、官方 provider SDK、手写 fetch；Zod/Valibot/Ajv。 Storage 暂沿用 ADR-001 的 main-owned project files 方向，但 ADR 状态仍为 Proposed。

## Constitution Check

- spec 与 storage ADR 仍为 Draft/Proposed，实现前需接受。
- renderer 只能调用 named typed preload IPC，main 验证所有输入并拥有文件/网络/凭据权限。
- durable schema、错误码、第三方包、native runtime 和性能阈值均保留 NEEDS DECISION。
- 验证必须包含 domain unit、contract test 和编译后的 Electron smoke。

Gate: BLOCKED until spec/ADR/contracts are Accepted。

## Implementation phases

1. 冻结 ProviderConfig、SecretState、ValidationResult 和脱敏错误。
2. 实现 main SecretStore、ProviderRegistry、验证 adapter。
3. 实现设置 UI 的 dirty/saved/replace/error 状态。
4. 用 fake provider 覆盖 auth、timeout、secret backend unavailable 和错误脱敏。

## Source structure

src/shared/provider.ts; src/main/providers/{registry,secret-store,validator}; src/renderer/features/provider-settings/; test/{security,contract,smoke}/provider/

## Boundary and validation

main owns files, Git, secrets, parsing jobs or restore transactions as applicable; preload exposes only named typed methods; renderer receives bounded DTOs. Domain logic must run without Electron/network. Unit tests cover Spec §FR-001–FR-009; contract tests cover DTO/error/redaction; runtime smoke covers 保存/替换只显示 configured；验证错误不泄密；未提交内容不显示为已保存；secret backend 不可用时不写明文。

## Constitution Check（Phase 1 design 后复核）

本轮设计已经把 secret、provider validation 和 IPC 放在 main-owned 边界内，但尚未把受保护存储后端、durable owner、contract version/error semantics 和 runtime failure fixtures 冻结。因此本复核确认的是设计方向，不是实现授权。

| Principle | 状态 | Phase 1 设计证据 | 剩余 implementation gate / 接受条件 |
|---|---|---|---|
| I. Secure Desktop Boundary | **PASS WITH ACCEPTANCE CONDITION** | `contracts/contract.md` 规定 secret 只一次性进入 main；`src/main/providers/secret-store`、`validator` 和 `registry` 由 main 持有；renderer 只接收 redacted summary/status。Spec §FR-003/004/008 进一步禁止 secret 回显、明文 fallback 和可恢复凭据的错误信息；data model 也要求 main 在跨边界前验证 durable entity。 | 必须选定并接受 `safeStorage`、`keytar` 或平台 Keychain 的 main-only adapter、可用性检测、生命周期和打包策略。backend unavailable/invalid、权限失败和替换失败都必须 fail closed：拒绝保存、不写项目文件或普通设置、不进入导出/日志/诊断/Git，并明确旧 secret 是否继续有效。未完成这些决定前不能声称满足 safe storage。 |
| II. Typed, Minimal IPC | **PASS WITH ACCEPTANCE CONDITION** | contract 只列出 `getProviderSummary`、`saveProviderConfig`、`replaceProviderSecret`、`validateProvider`；request/response/error 共享 TypeScript 类型并由 main runtime validation 复核。contract 同时明确禁止 generic IPC、任意路径/命令、secret echo 和未约束的外部 response；secret 不进入 summary/status DTO。 | 必须冻结 contract version、每个 DTO、稳定错误码、sender/project scope validation、输入长度/字符规则，以及取消/重试/恢复语义。`validateProvider` 必须由 main 取用已保存 secret，不能要求 renderer 重传或从 response 暴露 secret；外部 provider response 也必须先经 adapter/schema validation，再映射为 redacted `safeMessage`/`diagnosticCode`。preload compiled smoke 需证明暴露面只有这些 named methods。 |
| III. Specification-Driven, Minimal Evolution | **BLOCKED** | `spec.md` 仍为 Draft，`docs/adr/001-project-storage.md` 仍为 Proposed；`research.md` 的 safe-storage/provider/validator 选型为 `NEEDS DECISION`，contract 的 version/DTO/error/cancel/retry/recovery 也未决，`checklists/plan-decisions.md` 的 CHK001–CHK009 尚未勾选。当前计划的最小模块形状（单一 ProviderConfig/SecretState/ValidationResult、窄 secret store、四个 named methods、fake provider fixture）尚未被接受为 durable/process contract。 | 实现前必须：1）接受本 feature spec；2）接受 ADR-001 对项目存储的适用范围，并为 provider secret 的受保护存储、非敏感配置归属和是否进入 project Git 明确新增/引用 ADR，或明确记录不需要 ADR；3）关闭候选库、版本、许可证、打包与 provider validation 协议决策；4）冻结 schema/revision、错误码、替换幂等性、取消/失败/恢复语义和 IPC contract。未完成前不得生成 implementation tasks 或把候选实现写入代码。 |
| IV. Verification at the Failure Boundary | **NEEDS DECISION** | `Boundary and validation`、`quickstart.md` 和 Phase 1 计划已列出 typecheck/test/smoke，并覆盖保存/替换只显示 configured、验证错误不泄密、未提交内容不算已保存、secret backend 不可用不写明文；计划也要求 domain unit、contract test 和 compiled Electron smoke。 | 当前材料还没有把这些场景冻结成可执行的 runtime-level fixture 和判定。实现前需为以下真实边界分别定义 fixture、注入点和断言：renderer 的 dirty/saved/replace 状态；preload 的 exact named surface；main 的 sender/input/provider-response validation；secret backend 的 unavailable/permission/replacement failure；provider 的 auth/timeout/malformed response；存储的 atomic write/permission/crash/recovery；以及 Git commit failure、working-tree/revision 冲突。验证必须证明失败时不报告成功、不泄露 secret，且 project files、普通设置、导出、Git object/message/diagnostic 中均没有 secret；不能只用 renderer unit 或静态类型检查替代 Electron runtime。 |

**最小方案结论**：四个显式方法、一个非敏感 `ProviderConfig` 快照、一个由 main 管理的受保护 `SecretStore`、一个 `ValidationResult` 脱敏读模型，以及设置页的 dirty/saved/failed 状态，已经覆盖 FR-001–FR-009 所需的配置、替换、验证和展示闭环。它不新增 generic config API、renderer 文件权限、项目正文写入、远程密钥服务或 provider SDK 直连；secret 与非敏感配置的 owner 仍由接受后的 storage/ADR decision 决定，避免为假设的多账号、同步或未来 provider 能力引入复杂度。

**Post-design implementation gate**：只有在上述四项中的接受条件关闭、`spec.md`/ADR/contract 状态被接受或明确记录为不需要、且 quickstart 场景在编译后的 Electron runtime 中通过后，Phase 1 设计才能转为 implementation-ready。本节不构成 Constitution exception；若最终选择增加 native secret module、额外进程或新的 durable boundary，必须在 Complexity Tracking 和相应 ADR 中记录 rationale、impact 与 approval。

## Open decisions

候选：Electron safeStorage、keytar、平台 Keychain；Vercel AI SDK、官方 provider SDK、手写 fetch；Zod/Valibot/Ajv。

**Decision: NEEDS DECISION。** 本版不把候选写成批准依赖。
