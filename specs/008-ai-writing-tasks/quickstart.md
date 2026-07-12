# Quickstart：AI 写作任务端到端验证

**状态**：验证方案草案；当前仓库还没有 task/proposal 实现，因此 feature 场景在实现前只能作为验收脚本和 fixture 约定。不会在本次规划中安装依赖或启动外部 provider。

## 0. 当前 foundation 基线

前提：仓库已有 `node_modules`/Electron 可执行文件；如果没有，按用户要求本次不执行联网安装。项目命令来自当前 `package.json`。

```bash
bun run typecheck
bun run build
bun run test
bun run test:smoke
```

当前预期：这些命令只证明 Electron + React startup foundation；现有 smoke 只检查 `getRuntimeInfo` 和显式 preload bridge，不证明 AI task 功能。`bun run dev` 与 `bun run dev:electron` 可用于观察当前启动页，但当前 renderer 尚无任务 UI。

## 1. 实现前需要准备的本地 fixture

下列 fixture 目录和 harness 由未来实现阶段创建，本次不新增源码或测试文件：

```text
tests/fixtures/ai-tasks/
├── project-valid/
│   ├── project.json
│   ├── content/chapter-1.md
│   ├── sources/source-a/...
│   └── ai/provider-config.fixture.json  # 不含真实 secret
├── project-stale-target/
├── project-pending-transaction/
└── provider-responses/
    ├── success.json
    ├── insufficient-evidence.json
    ├── unlocatable-target.json
    ├── malformed.json
    └── delayed.json
```

fixture provider 需要是 deterministic 的本地 adapter 或本地 HTTP server，支持注入：success、delay、abort、timeout、429/Retry-After、auth failure、网络中断、malformed response 和 late chunk。它不能访问互联网、读取真实 key 或写真实用户项目。

仍需准备的 runtime 能力：

- 编译后 Electron smoke 如何创建临时 `.writellm` 项目并注入 active project/session。
- 如何让 main 使用 fixture adapter，而不让 renderer 选择任意 provider。
- 如何在 smoke 中模拟正文被手动编辑、source 被替换、窗口关闭和 storage rename/commit 失败。
- 如何清理临时项目和 pending transaction，且不触碰用户现有目录。

## 2. 场景 A：限定目标块与资料范围的成功任务

**目的**：覆盖 spec US1、FR-001–FR-008、SC-002/SC-005。

fixture：chapter-1 有 `block-a`、`block-b`，chapter-2 有 `block-other`；source `chunk-1`/`chunk-2` 可检索并带 page/location；fixture provider 返回只针对 `block-a`、`block-b` 的两个 changes。

步骤（实现后可由 runtime harness 执行；若有 UI，也可用 `bun run dev:electron` 手动执行同一流程）：

1. 通过 task UI 提交 `operation=modify`、两个目标块、非空指令和两个明确 source refs。
2. 读取任务 detail，确认包含 target IDs、source IDs/revisions、instruction、provider config revision 和 `queued`/`running` 状态。
3. 在 fixture provider 延迟期间编辑正文，确认编辑器可继续工作且 content revision 变化。
4. 让 provider 返回成功结果；确认 task 为 `completed`，独立 proposal 已保存，正文没有任何自动变化。
5. 重新打开项目，确认 task/proposal 可读，且 proposal 的 base revision/hash 能指出任务运行期间发生过正文变化。
6. 确认 `block-other`、其他章节和未选择 source 不出现在 task context 或 proposal target 中。

通过标准：任务记录可证明授权范围；proposal 可被 009 读取；没有 `applyProposal` IPC；内容文件、正文 revision 和手动编辑只由 004/009 的边界改变。

## 3. 场景 B：证据不足但不伪造引用

**目的**：覆盖 US3、FR-008、SC-003。

fixture provider 对已选择的 source refs 返回建议文本，但返回空/不足 evidence。

通过标准：

- task 可是 `completed`（如果响应结构有效），proposal summary 为 `insufficient` 或 `mixed`；
- change 的 `sourceRefs=[]` 或只包含实际输入子集，`fabricatedCitation=false`；
- UI 明确出现“证据不足/需要作者判断”，不把模型文本标成已证实引用；
- 任何 source name/page/citation 都不会由 provider 的自由文本自行创建成可追溯引用。

## 4. 场景 C：运行中取消、失败和显式重试

**目的**：覆盖 US2、Edge Cases、FR-005/FR-009/FR-010、SC-004。

fixture provider 在 request/stream 中延迟，并记录是否收到 abort signal。

1. 创建任务后，在 `queued` 或 `running` 阶段调用取消。
2. 确认任务最终为 `canceled` 或设计中明确的 interrupted 状态，且原因/attempt 被保存；迟到 chunk 不会把任务推进为 completed。
3. 确认正文、手动编辑、项目 revision 和 proposal 文件没有被成功结果覆盖；UI 不显示虚假的 proposal-ready。
4. 对失败/取消/中断 task 执行一次显式 retry，确认新 attempt 被追加，旧错误仍可查看；completed task 不能被 retry 覆盖已有 proposal。
5. 对 timeout、auth failure、429、网络中断分别确认 retryable 与不可 retry 的错误码和用户提示符合冻结后的 policy。

通过标准：取消贯穿 queue/provider/retry delay/storage；没有隐式重试、没有重复 running attempt、没有把“请求已取消”显示为“已成功”。

## 5. 场景 D：目标过期、无法定位与人工判断

**目的**：覆盖 Edge Cases、FR-008/FR-010，并交接 009。

1. 创建任务后改变目标块文本或 block revision，再让 provider 返回原 base 的建议。
2. 确认 proposal change 的 `targetStatus=stale`，应用入口（属于 009）必须要求重新确认/重新生成。
3. fixture provider 返回不在 task target set 的 block ID，或返回重复/冲突 change。
4. 确认结果进入 `PROVIDER_RESPONSE_INVALID` 或 proposal change 的 `unlocatable/conflict + needs-author-judgment`；不得自动写回正文。

通过标准：所有过期/无法定位结果保留可理解原因和 task/proposal 关联，但不改变未选择章节或正文内容。

## 6. 场景 E：持久化失败、pending 和重启恢复

**目的**：覆盖 ADR-001 的写入/恢复边界以及 FR-009。

fixture writer 在写 task、写 proposal、替换文件或 Git event commit 的各阶段注入失败。

- 写入失败时 IPC 不返回成功/完成，task record 保留可恢复状态；
- `runtime/pending/<transactionId>.json` 包含目标 revision/hashes，不包含 secret；
- 重新启动并打开项目时，main 检测 pending，重试或返回 `STORAGE_RECOVERY_REQUIRED`，不覆盖无法判断的文件；
- 已取消/失败的 task event 可以存在，但 `WriteLLM-Content-Change=false` 且正文 revision 不增加；
- recovery 后重复打开不会产生重复 proposal、重复 attempt 或丢失原有手动编辑。

通过标准：runtime smoke 看到真实 Electron main + 文件系统行为，而不是只对 service mock 做断言。

## 7. 场景 F：IPC 和 secret 安全边界

通过 compiled Electron runtime（不是仅调用 renderer 函数）执行：

- renderer 传入错误 projectId、非当前 taskId、重复/未知字段、绝对路径和空 instruction；main 返回稳定错误码，不创建 task。
- 非预期 sender/frame 尝试调用 task handler；main 返回 `IPC_UNAUTHORIZED_SENDER`。
- provider fixture 使用 sentinel secret；读取 task/proposal JSON、IPC DTO、错误、诊断和 renderer DOM，均不得出现 sentinel 或 authorization header。
- renderer 只能看到命名的 task 方法和受控 update listener；不存在通用 `ipcRenderer`、文件读取、secret getter 或 apply proposal 方法。
- window close、project switch、renderer remount 后 listener 正确移除/重建；状态以 `get/list` snapshot 为准，不依赖丢失的 event。

## 8. 使用已有 Bun scripts 的最终验证顺序

在实现、决策和 fixtures 都准备好后，建议按以下顺序执行（本次不执行联网安装）：

```bash
bun run typecheck
bun run test
bun run build
bun run test:smoke
```

若保留 `bun run dev:electron` 作为人工验收入口：

```bash
bun run dev:electron
```

手动验收应从当前打开项目进入 AI task panel，完成场景 A–D；场景 E/F 必须由 runtime harness 或 smoke 记录 filesystem/IPC 证据，不能只凭 UI 观察。

## 外部 provider 验证（可选、非 CI 默认）

仍需产品决策后才能做：真实 endpoint、provider/model、数据发送范围、凭据提供方式、网络代理、地区/合规、收费/配额和数据保留。外部测试必须：

- 明确 opt-in，不把 API key 写入 repo、fixture、命令历史或测试输出；
- 禁止 CI 自动依赖网络；默认使用 local fixture provider；
- 验证 authentication、rate limit、timeout、stream abort 和 provider response version；
- 清理生成的任务/提案和 provider-side data（若 provider 有保存/训练设置）；
- 把一次真实调用与本地 deterministic contract test 分开记录。

## 当前尚未具备的条件

1. `spec.md` 与 ADR-001 尚未显示 Accepted。
2. IPC contract、storage schema、provider adapter port、error code 和 state transition 尚未冻结。
3. 还没有 feature-specific task runner、fixture provider、临时 project harness 或 runtime smoke 场景代码。
4. provider SDK/网络 transport/执行载体/schema/retry/secret 方案仍为 `NEEDS DECISION`。
5. 性能阈值、可访问性验收、离线策略、恢复/迁移边界和外部服务责任仍需补齐。
