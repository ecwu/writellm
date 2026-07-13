# Implementation Plan: Pi agent 驱动的 AI 写作任务

**Branch**: `008-ai-writing-tasks` | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

**Plan status**: Draft. This revision replaces the provider-adapter/completion design with one constrained Pi agent per task. Implementation remains gated by the Draft spec and unfinished 006/007 dependencies.

## Summary

作者提交目标 block IDs、任务目标和 source refs 后，main 按 FIFO 启动一个独立 `AgentHarness`。agent 的初始 prompt 只说明任务与授权 ID，不内嵌正文或资料；agent 必须调用 `read_task_brief`、`read_blocks`、`read_sources` 获取内容，并调用 `submit_proposal` / `finish_task` 产生独立提案。008 永远不给 agent 正文写入工具，最终 assistant prose 也不被解析为产品结果。

任务开始时固定可访问 ID 集合；实际读取的 revision/hash 由工具记录。proposal 工具复核目标、证据、范围扩展、删除影响和变更组，再通过 ADR-001 writer 持久化。取消建立 durable barrier 并中止 harness，崩溃后的运行中任务标记 interrupted；重试创建新 task/session。

## Technical Context

**Runtime**: TypeScript 7 strict; Electron 43 main runtime; React 19 renderer; Bun scripts.

**AI dependencies**: Existing pinned `@earendil-works/pi-agent-core` 0.80.6, `@earendil-works/pi-ai` 0.80.6 and `typebox` 1.1.38.

**Pi primitives used**: `AgentHarness`, `Session` storage, `AgentTool`, `prompt`, `subscribe`, `abort`, `waitForIdle`, active-tool snapshot and curated stream options.

**Storage**: ADR-001 project writer; product task/proposal records plus a project-owned Pi session log/reference.

**Testing**: Unit state/tool validation, Pi faux-provider multi-turn tests, storage fault injection, compiled Electron IPC smoke.

**Target**: One open local project; FIFO queue; at most one running writing agent per project.

**Performance/budgets**: Bounded turns, tool calls, returned bytes and proposal size; exact values are shared constants frozen during tasks generation. Provider `maxRetries: 0` for v1; product retries are explicit new tasks.
**Security**: No generic filesystem/shell/provider tool; no path/secret in renderer or model-visible tool args; every tool revalidates authorization and cancellation.

## Constitution Check

### Before design

| Principle | Result | Evidence |
|---|---|---|
| Secure Desktop Boundary | Pass by design | Harness and tools live in main; deny-by-default `ExecutionEnv`; renderer cannot reach Pi, filesystem, provider or secret. |
| Typed, Minimal IPC | Pass by design | Renderer receives task/proposal DTOs and named lifecycle actions only. Agent tools are internal and TypeBox validated. |
| Specification-Driven Evolution | **Gated** | 008 spec/plan remain Draft; 006/007 are Draft; no tasks or implementation allowed. |
| Failure-Boundary Verification | Pass by strategy | Faux provider tests the real Pi loop; compiled smoke tests preload/main; storage and abort barriers receive fault injection. |

### After design

- Read access is enforced by tool closures and authorization snapshots, not prompt compliance.
- The only change-producing tool writes a proposal, never block content.
- Session transcript is not renderer DTO or proposal truth.
- Cancellation checks occur before/after every read and before durable proposal commit.
- In-flight provider/tool recovery is not claimed; interrupted work needs an explicit new task.
- No planned Pi hook/facade/auto-retry API is required.

No constitution exception. Gate remains closed until source documents and dependencies are accepted.

## Architecture

```text
renderer task UI
  -> named preload IPC
  -> main WritingTaskService
       -> FIFO ProjectAgentQueue
       -> TaskAuthorizationSnapshot
       -> AgentHarness (one per task/session)
            -> read_task_brief
            -> read_blocks ------> 004 read service
            -> read_sources -----> 007 read service
            -> submit_proposal --> ProposalDraft validator
            -> finish_task ------> ADR-001 writer
       -> redacted task events

No path: AgentHarness -> editor/block write service
```

### Ownership

- `WritingTaskService`: submit/cancel/retry/list/get and product state transitions.
- `ProjectAgentQueue`: FIFO, one active run, generation-token late-result suppression.
- `WritingAgentFactory`: recreates model, auth resolver, session adapter, deny env, system prompt and exact tool registry.
- `TaskToolContext`: immutable task identity/authorization plus mutable read audit/proposal draft under the active generation token.
- `ProposalValidator`: deterministic domain validation and impact lookup; never delegates safety classification solely to model prose.
- `TaskSessionRepository`: Pi `Session` storage adapter coordinated with project writer; transcript is internal.

## Project Structure

```text
src/shared/ai-writing-tasks.ts
src/main/ai-writing-tasks/
├── task-service.ts
├── project-agent-queue.ts
├── writing-agent-factory.ts
├── task-session-repository.ts
├── task-tools.ts
├── proposal-validator.ts
├── task-repository.ts
└── errors.ts
src/main/ipc/ai-writing-task-handlers.ts
src/preload/preload.cts
src/renderer/features/ai-writing-tasks/
test/unit/ai-writing-tasks/
test/smoke/ai-writing-tasks/
```

Pi/vendor types stop at `writing-agent-factory.ts` and `task-tools.ts`. Shared/preload/renderer contracts contain only product DTOs.

## Execution Flow

1. `createAiWritingTask` validates current project, non-empty instruction, selected blocks/source refs and 005 readiness; it persists `queued` without reading content.
2. FIFO runner selects the oldest queued task, revalidates selected IDs, creates `authorizationSnapshot`, provider snapshot and unique session, then persists `running`.
3. Factory builds a harness with the five active tools and a system prompt requiring tool-only reads/changes. Initial prompt includes task intent and opaque authorization summary only.
4. Each read tool calls 004/007 by ID, returns bounded content and persists/accumulates `ToolReadAudit` with actual revision/hash.
5. `submit_proposal` accepts model intent only after deterministic authorization, read-before-reference, impact and schema validation.
6. `finish_task` atomically writes the proposal and terminal task. If the run ends without a successful finish tool, task fails with `AGENT_NO_TERMINAL_TOOL`; final prose is retained only in the internal session.
7. Service emits redacted state events after durable commit; renderer refreshes via get/list after remount or event loss.

## Cancellation, Failure and Recovery

- `cancel(queued)`: persist canceled; queue skips it.
- `cancel(running)`: persist canceled + increment generation, then abort/wait. Any later event/tool result with old generation is ignored.
- Provider/auth/timeout/tool/schema/session/storage errors map to stable product error codes. Raw messages and content remain main-only.
- App startup changes leftover running records to interrupted. It does not replay the session or resume provider/tool calls.
- Retry creates a new queued task with `sourceTaskId`, revalidates current selections at its own start and uses a new session.

## Data and Contract Decisions

- Product truth: [data-model.md](./data-model.md).
- Renderer boundary: [contracts/task-ipc.md](./contracts/task-ipc.md).
- Model capability boundary: [contracts/agent-tools.md](./contracts/agent-tools.md).
- There is no provider adapter contract in 008; 005 supplies `Models`, selected `Model` and auth capability used by the harness.
- There is no `applyProposal`, generic `readFile`, generic tool dispatch or raw transcript IPC.

## Implementation Sequence (not tasks.md)

1. Accept/update 006/007 contracts needed for source reads and reference impact; accept 008 spec/plan and ADR gate.
2. Freeze product DTOs/state/errors and project session storage schema.
3. Build repository + FIFO queue + recovery without provider calls.
4. Build read tools and their authorization/read-audit tests.
5. Build proposal/finish tools and no-body-write invariants.
6. Integrate `AgentHarness` with faux-provider success/failure/abort scenarios.
7. Add named IPC/preload and renderer task/proposal UI.
8. Add compiled Electron smoke and optional real-provider acceptance.

## Verification Strategy

| Boundary | Proof |
|---|---|
| Tool-only content access | Initial provider payload fixture lacks body/source text; faux agent must call read tools; unauthorized IDs fail. |
| Tool-only changes | Proposal exists only after valid `submit_proposal` + `finish_task`; assistant JSON/prose alone fails. |
| Scope/evidence | Proposal refs must be subsets of successful read audits; extension and insufficient evidence remain explicit. |
| Cancellation | Abort during provider/read/proposal write; generation barrier prevents late completion/proposal. |
| Durability | Session/task/proposal writer faults never emit completed; restart yields interrupted. |
| Security | No path/key/raw transcript in IPC, logs, task/proposal public DTO or DOM. |
| Runtime | `bun run typecheck`, `bun run test`, `bun run build`, `bun run test:smoke`. |

See [quickstart.md](./quickstart.md) for end-to-end scenarios.

## ADR Gate

ADR-001 and ADR-004 are accepted and constrain project writes/provider secrets. Before accepting this plan, maintainers must decide whether project-owned Pi session schema/lifecycle requires a new ADR because it adds durable tool transcript data. If not required, record the rationale in this plan and registry. ADR-003 remains applicable to renderer work.

## Out of Scope

- Proposal acceptance/application (009) and content history after application (010).
- General-purpose chat, arbitrary user-defined tools, filesystem/shell tools, multi-agent delegation or remote workers.
- Resuming an in-flight Pi provider stream/tool call.
- Pi hooks, skills, prompt templates, compaction, tree navigation or automatic retry.
