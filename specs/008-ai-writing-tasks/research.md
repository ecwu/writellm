# Research: Pi agent 原语驱动的 AI 写作任务

**Date**: 2026-07-13

**Basis**: 仓库已锁定的 `@earendil-works/pi-agent-core` / `@earendil-works/pi-ai` 0.80.6 类型与实现，以及 Pi `packages/agent/docs` 当前主线文档。

## Decision 1: 每个 WritingTask 运行一个受限的 `AgentHarness`

使用 `AgentHarness.prompt()` 执行一个 agent run，而不是新增一次性 `ProviderAdapter.runWritingTask()`。每个任务创建独立 session、固定 system prompt、任务级 model/config snapshot 和白名单工具；同一项目的 runner 仍按提交顺序一次只运行一个任务。

**Rationale**: Pi 的核心能力是 provider turn → schema-valid tool call → tool result → 后续 turn。写作任务需要 agent 自主决定读哪些授权内容、迭代读取并提交提案，不能把所有正文/资料预先拼成 provider payload。

**Alternatives considered**:

- 直接调用 `Models.streamSimple()`：绕开 agent tool loop，无法满足“读取和改动都是工具调用”。
- 继续使用 provider adapter 返回结构化 JSON：把 agent 降级为一次 completion，重复实现 Pi 已提供的工具执行、取消和事件语义。
- 使用低层 `Agent`：005 probe 适合它，但 008 需要 session、turn snapshot、active tools 与持久化事件，因此选择更高层 harness。

## Decision 2: agent 不获得项目文件系统，只获得领域工具

不给 harness 暴露通用 `readTextFile`、`writeFile`、shell 或项目路径。`ExecutionEnv` 使用 deny-by-default adapter，仅满足 harness 构造契约；写作能力全部由 main-owned `AgentTool` 实现：

- `read_task_brief`：读取目标、作者指令、授权范围和当前预算。
- `read_blocks`：按 opaque block ID 读取授权正文及版本。
- `read_sources`：按授权 source/chunk ID 读取资料与位置元数据。
- `submit_proposal`：提交完整、可验证的提案草稿；这是唯一“改动”工具，但只写 proposal，不写正文。
- `finish_task`：在至少一次成功 `submit_proposal` 后终止 run；无可用建议时提交显式 empty outcome。

所有工具参数用 TypeBox exact schema；main 在每次执行时重新验证 taskId、授权集合、ID、大小和 `AbortSignal`。读取工具只返回白名单内容；提交工具只能引用本次工具读取获得的 revision/hash/source ref。

**Rationale**: Pi 本身不提供权限沙箱，工具拥有宿主进程权限。真正的安全边界必须是应用提供的窄工具，而不是 system prompt 中的“请勿越界”。

**Alternatives considered**:

- 提供受 cwd 限制的文件工具：仍暴露内部布局、路径与非授权文件，且把稳定领域 ID 降级为路径协议。
- 把初始正文和资料放进 prompt：读取不再是工具调用，也无法审计 agent 实际访问了什么。

## Decision 3: 提案由工具调用产生，最终 assistant 文本不构成产品结果

`submit_proposal` 接收 proposal summary、changes、change groups、evidence refs、scope classification 与 impact disclosure。工具执行器验证并暂存规范化 proposal；只有 durable write 成功后才返回成功工具结果。最终 assistant message 仅作为 session transcript/诊断，不解析为 proposal，也不展示为可应用内容。

范围扩展不能通过任意新 block ID 实现。agent 使用 `scope: "extension"`、锚点与自然语言说明提交建议；009 必须单独确认。删除建议的影响由工具执行器调用 004/007 领域读取能力计算或复核，不能信任模型自报“无影响”。

## Decision 4: 一任务一 session，但领域 task/proposal 是产品真相

Pi session 保存 agent message/tool-call/tool-result 的顺序和 active-tool 状态；`WritingTask` 保存产品状态、授权范围、实际读取审计、provider snapshot、session reference 和 proposalId。session 不是 task queue/proposal 的替代品。

使用项目内的 session storage adapter 接入 ADR-001 串行 writer。session 中的正文/资料工具结果属于敏感项目内容，不进入 renderer IPC、日志或 Git commit message；保留与删除周期由项目数据策略管理。

**Rationale**: Pi 文档将 session 定义为 append-only durable state tree，但 runtime tools/model/auth 仍由 host 重建。领域状态必须能在不重放 transcript 的情况下列出任务和审阅提案。

## Decision 5: 开始运行时建立授权集合，实际内容按工具调用读取

提交时只记录选择的稳定 ID。任务从 `queued` 转为 `running` 时，main 校验这些 ID 仍存在并固定 `authorizationSnapshot`（允许读取哪些 block/source，以及开始 revision）。agent 随后通过工具读取内容；每次读取记录实际 revision/hash。未读取的授权内容不声称为依据。

任务运行中作者继续编辑不会改变 agent 已成功读取的工具结果。再次读取同一 ID 时若 revision 已变化，工具返回 `changed_since_start`，任务最终 proposal 标记 stale/manual-review；绝不静默扩大范围或猜测新位置。

## Decision 6: 取消、重试与恢复遵循现有原语的保守边界

- queued cancel 直接终止任务。
- running cancel 先持久化 `canceled` barrier，再 `await harness.abort()`；barrier 后的工具调用、session event 和 proposal write 全部按 task generation token 丢弃。
- provider timeout/retry 使用 harness `streamOptions`，首版 `maxRetries: 0`，避免隐藏产品 attempt；失败由产品 task 记录。
- retry 总是创建带 `sourceTaskId` 的新任务和新 session。
- main/app 崩溃后遗留 running task 变为 `interrupted`；不恢复 provider stream，不自动重放未完成工具调用。

**Rationale**: Pi 当前明确说明 provider stream 不可恢复，未完成 tool call 除非工具声明幂等/可重试否则不安全；auto-retry 与 fully durable restore 仍未完成。

## Decision 7: 不依赖计划中的 hooks、facade 或 model registry

首版只使用 0.80.6 已导出的 `AgentHarness`、`Session` storage、`AgentTool`、subscribe events、`prompt()`、`abort()`、`waitForIdle()`、turn snapshot 与 stream options。不会依赖文档中仍标记 planned/in-progress 的通用 hook system、session facade、auto-compaction、auto-retry、model registry builder 或 in-flight resume。

## Decision 8: 版本、安全与验证

复用 005 已锁定的 Pi Agent/AI/TypeBox 版本与经过 tool-loop 验证的 model profile；008 不引入 vendor SDK。真实 auth 每个 provider request 由 005 main-owned capability 解析，secret 不进入 harness config/session/tool details。

测试使用 Pi faux provider 和内存/临时项目 session adapter，覆盖多轮读取、非法 ID、未读引用、越界提案、取消迟到结果、session write 失败和最终文本试图绕过 `submit_proposal`。

## Sources

- Pi `AgentHarness lifecycle`: https://github.com/earendil-works/pi/blob/main/packages/agent/docs/agent-harness.md
- Pi durable harness/session design: https://github.com/earendil-works/pi/blob/main/packages/agent/docs/durable-harness.md
- Pi package security note: https://github.com/earendil-works/pi
- Installed 0.80.6 declarations under `node_modules/@earendil-works/pi-agent-core/dist/` are the implementation target; upstream `main` documents direction and is not treated as the installed API contract.
