# Contract 草案：main ↔ index/provider/worker

**状态**：`NEEDS DECISION`；这是 domain adapter 边界，不绑定 SQLite、Orama、Meilisearch、sqlite-vec、LanceDB、Transformers.js 或 ONNX Runtime。

## 1. SearchIndexAdapter

主进程使用的最小能力可表达为：

```text
open(scope: ProjectSearchScope): Promise<IndexHandle>
upsert(entries: readonly IndexEntryInput[]): Promise<IndexRevision>
remove(sourceVersionIds: readonly OpaqueId[]): Promise<IndexRevision>
search(request: ProviderSearchRequest): Promise<ProviderSearchResponse>
getStatus(): Promise<IndexStatus>
rebuild(request: RebuildRequest): AsyncResult<RebuildProgress, IndexRevision>
close(): Promise<void>
```

这些是抽象方法，不是要求直接导出给 renderer 的 API。具体库的 document schema、SQL、HTTP path、native handle 和 vector type 不得越过 adapter。

### ProviderSearchRequest

```text
{
  queryText: string,
  queryEmbedding?: readonly number[],
  mode: "keyword" | "natural-language" | "hybrid",
  filter: {
    projectId: OpaqueId,
    sourceIds?: readonly OpaqueId[],
    tags?: readonly string[],
    eligibleOnly: true
  },
  limit: number,
  cursor?: string,
  expectedIndexRevision?: OpaqueId
}
```

Provider 必须返回 source/version/chunk IDs、rank/score、matched text/offset（如果能力支持）和 provider index revision。main 再回查 canonical SourceChunk，不能直接把 provider document 当最终 evidence。

### IndexStatus

至少表达：`not-ready`、`ready`、`indexing`、`stale`、`error`、`recovery-required`；包含 canonical source revision watermark、index revision、eligible/ineligible counts 和 safe error code。不得暴露内部路径、端口、完整 command line 或 credentials。

## 2. EmbeddingProvider

```text
capabilities(): Promise<{
  queryEmbedding: boolean,
  dimensions?: number,
  modelIdentity?: string,
  offline: boolean
}>
embedQuery(input: { text: string, expectedModelIdentity?: string }): Promise<{
  vector: readonly number[],
  modelIdentity: string,
  modelRevision?: string
}>
cancel(requestId: OpaqueId): Promise<void>
```

- `vector` 只在 main/provider adapter 内流转；不进入 renderer DTO、不写入 error message。
- 如果 006 已产生 chunk embeddings，007 必须比较 `modelIdentity`/dimensions，不能把不同模型的向量混在同一 index。
- 远程 provider 由 main 取得 005 的受保护 capability；本地 model cache/模型文件路径不跨 IPC。
- `offline` 的含义（完全离线、cache-only、允许远程 fallback）和 provider timeout/retry 仍为 `NEEDS DECISION`。

## 3. Worker/message boundary（仅在采用 worker 时）

如果选择 worker thread、Electron utility process 或 child process，建议使用内部 versioned envelope：

```text
{
  protocolVersion: string,
  requestId: OpaqueId,
  method: "open" | "upsert" | "remove" | "search" | "rebuild" | "cancel" | "close",
  payload: JSON-safe DTO
}
```

- 只允许 main 创建和关闭 worker；renderer 没有 worker port。
- 所有 message 必须可序列化、有限大小、带 requestId；不传文件 path、native object、secret 或无限 stream。
- worker 崩溃、超时、取消和部分 rebuild 必须转换为 main 的 stable error/status，并保留可重建 marker。
- worker 是否必要、选择何种 process、是否允许 native addon、如何做跨平台签名/打包均为 **NEEDS DECISION**。

## 4. Required adapter invariants

1. `eligibleOnly` 不得被 provider 忽略；provider 返回的 ineligible entry 必须由 main 丢弃或标记，不能成为可引用结果。
2. Upsert/remove 必须幂等于 `(sourceVersionId, chunkId, indexRevision)`，重复通知不产生重复 citation identity。
3. Rebuild 从 canonical source/chunk 读取，不能从旧 index 自举；中途失败可继续/重试，不覆盖旧的可用 index 直到新 revision 完成。
4. Search result 必须可回查到 canonical provenance；回查失败返回 `RESULT_NOT_CITABLE` 或 `SEARCH_INDEX_STALE`。
5. adapter 不负责正文 block mutation；引用写入由 main 调用 004 content contract 完成。

**Decision: NEEDS DECISION**：具体 adapter、索引布局、provider protocol、worker placement、版本策略、进度/取消语义、远程网络和离线 policy。

