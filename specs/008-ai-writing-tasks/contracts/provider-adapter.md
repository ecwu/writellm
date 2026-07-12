# Provider Adapter Contract（候选内部契约）

**状态**：`NEEDS DECISION`。这是 main task service 与外部 provider/SDK/utility worker 之间的内部 port；不指定 OpenAI、AI SDK、LangChain、fetch、worker 或 queue 实现，也不允许这些类型穿透到 renderer/持久化 schema。

## 目标

把“作者限定的 task context”转换为 provider request，再把外部响应转换为稳定的 `NormalizedWritingResult`。adapter 必须：

- 只接收 task service 已校验的 context 和 non-secret provider metadata。
- 从 005 的 main-owned secret capability 取得 secret；不把 secret 写入 request DTO、日志、异常或 proposal。
- 接收 `AbortSignal`，在网络请求、stream consumption、重试等待和 worker communication 中传递取消。
- 将 provider-specific HTTP/status/error/stream event 映射成稳定的 `ProviderError`。
- 不执行正文写入、不创建 citation、不扩大 source scope、不自动应用 proposal。

## Port（候选 TypeScript 形状）

```ts
type ProviderAdapter = {
  readonly id: string;
  getCapabilities(input: ProviderCapabilityInput): Promise<ProviderCapabilities>;
  runWritingTask(
    input: ProviderTaskInput,
    context: ProviderRunContext
  ): Promise<NormalizedWritingResult>;
};

type ProviderCapabilityInput = {
  profileId?: string;
  configRevision: string;
  endpointLabel?: string;
  modelLabel?: string;
};

type ProviderRunContext = {
  signal: AbortSignal;
  onProgress?: (progress: ProviderProgress) => void;
  attemptId: string;
};
```

是否用 `AsyncIterable<ProviderEvent>` 代替一次性 `Promise`、是否需要 tool calls/structured output、是否保留 token usage 和 provider request ID，均为 `NEEDS DECISION`。持久化 task/proposal 不依赖 provider event 的具体形状。

## Provider 输入

```ts
type ProviderTaskInput = {
  taskId: string;
  operation: 'generate' | 'modify';
  instruction: string;
  targetBlocks: Array<{
    chapterId: string;
    blockId: string;
    blockType: string;
    blockRevision: string;
    contentHash: string;
    text?: string;
  }>;
  sourceContext: Array<{
    sourceId: string;
    chunkId: string;
    sourceRevision: string;
    sourceName: string;
    location: Record<string, string | number>;
    text?: string;
  }>;
  provider: {
    profileId?: string;
    endpointLabel?: string;
    modelLabel?: string;
    configRevision: string;
  };
};
```

- `targetBlocks` 与 `sourceContext` 必须来自 `TaskContextSnapshot`，不能由 adapter 自己搜索或读取项目。
- `text` 是否总是进入 adapter 取决于 `payloadRetention`；adapter 不能因为缺少 text 就从文件系统补读。
- provider request 可包含 system/developer instructions，但这些不是 renderer 的公开 DTO；是否允许业务固定 prompt 模板进入源码/持久化为 `NEEDS DECISION`。
- provider profile 不能含 key；adapter 通过显式 secret getter 获得短暂 secret，secret getter 不属于 renderer IPC。

## Normalized result

```ts
type NormalizedWritingResult = {
  provider: {
    adapterId: string;
    modelLabel?: string;
    requestId?: string;
    usage?: { inputTokens?: number; outputTokens?: number };
  };
  changes: Array<NormalizedProposalChange>;
  resultHash: string;
};

type NormalizedProposalChange = {
  changeId: string;
  targetBlockIds: string[];
  originalText?: string;
  originalTextHash: string;
  suggestedText: string;
  intent: string;
  evidence: {
    status: 'sufficient' | 'insufficient' | 'unavailable' | 'not-applicable';
    sourceRefs: Array<{ sourceId: string; chunkId: string; sourceRevision: string }>;
    explanation: string;
    fabricatedCitation: false;
  };
  targetStatus: 'locatable' | 'stale' | 'unlocatable' | 'conflict';
};
```

规范化要求：

1. `targetBlockIds` 只能来自输入的 target set；新 block、别的 chapter 或模糊名称必须拒绝/人工判断。
2. `originalTextHash` 必须与提交时 snapshot 可比较；缺失时不能标记为安全可审阅。
3. `evidence.sourceRefs` 只能是输入的 source refs 子集；不能凭模型生成一个 sourceId/page/citation。
4. 不足证据用 `status=insufficient` 和解释文字；不得为了满足 UI 而生成 citation。
5. provider 返回空结果、重复 changeId、超限文本、未知字段、错误 JSON、非法 encoding 或无法定位目标时走 `PROVIDER_RESPONSE_INVALID`/`PROPOSAL_TARGET_UNLOCATABLE`，不写正文。
6. `resultHash` 对规范化结果计算，不使用可变 raw response 字符串作为唯一身份。

## Provider error

```ts
type ProviderError = {
  kind:
    | 'unreachable'
    | 'authentication'
    | 'rate-limit'
    | 'timeout'
    | 'aborted'
    | 'invalid-response'
    | 'unsupported'
    | 'unknown';
  retryable: boolean;
  providerStatus?: number;
  retryAfterMs?: number;
  safeMessage: string;
  diagnosticId?: string;
  cause?: unknown; // main-only; never serialized
};
```

`retryable` 不能由 HTTP status 单独决定：认证、无效参数、provider schema error 和 user abort 不应自动重试；网络中断、适当的 429/5xx 可能可重试。具体矩阵和预算必须在 retry ADR/decision checklist 中冻结。

## 取消、timeout 和生命周期

```text
task runner creates AbortController per attempt
  ├─ user cancel ───────────────┐
  ├─ timeout signal ────────────┼─► AbortSignal.any(...) / chosen equivalent
  ├─ project/window shutdown ───┘
  └─ retry delay waits on signal

adapter aborts provider call/stream/worker boundary
  └─ task service persists canceled/interrupted, never completed
```

- provider 若支持 AbortSignal，应将同一 signal 传入；若只支持自有 `.abort()`，adapter 必须保证两者生命周期一致。
- 中止后收到迟到的 chunk 不得重新推进到 completed；attemptId/taskId 用于丢弃迟到事件。
- `onProgress` 不能传输 secret、raw token request、未经验证的 suggestion 或无上限文本；是否把 token progress 暴露给 UI 为 `NEEDS DECISION`。
- adapter 不能自行 sleep/retry，除非任务层明确把其作为 provider capability；默认由 task service 统一记录 attempt。

## 执行载体插拔边界

以下都是 port 的实现候选：

| 载体 | adapter 可以看到什么 | 不能跨边界什么 | 状态 |
|---|---|---|---|
| main async | `ProviderTaskInput`、secret getter、AbortSignal | renderer API、文件路径、raw error | 候选 A |
| Electron utility process | 最小化后的 serializable provider input、一次性 secret/reference、message port | main 的任意 capability、renderer channel、项目路径 | 候选 B |
| Node worker thread | 可 clone 的已校验 input、cancel/terminate signal | 安全隔离假设、长期 secret、直接写项目 | 候选 C |

执行载体最终 `NEEDS DECISION`；无论选择哪一项，project writer、state machine 和 proposal normalizer 仍由 main domain service 管理。

## Contract tests（实现时）

fixture adapter 至少要表达：

- deterministic success：两个 target blocks、两个 source refs，生成可定位 proposal；
- insufficient evidence：返回空 evidence refs 和明确 explanation；
- unlocatable target：返回不在 input 的 block ID；
- malformed response：重复 ID、缺 text、未知 evidence status、超限文本；
- abort during request/stream/retry delay；
- timeout、429 with retry-after、auth failure、network failure 和 late chunk；
- raw error/secret 不进入 `PublicTaskError`、task JSON、proposal JSON 或 renderer update。

## 冻结前必须回答的问题

- [Decision] 使用原生 fetch、Electron net、vendor SDK 还是 provider-agnostic SDK？
- [Decision] `Promise<NormalizedWritingResult>` 还是可取消/可消费的 event stream？
- [Decision] input context 是否保存 exact selected text，还是只保存 references + hashes？
- [Decision] provider-specific options/capabilities 是否允许进入 adapter port？
- [Decision] schema validator、unknown field policy、response size limit 和 JSON schemaVersion 如何统一？
- [Decision] retry/timeout 由 task service 还是 adapter 拥有？用户 cancel 是否绝对禁止自动 retry？
