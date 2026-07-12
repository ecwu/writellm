# Contract 草案：renderer ↔ preload ↔ main

**状态**：`NEEDS DECISION`；这是供 001/004/006/007 共同评审的最小接口，不是已冻结的实现 API。  
**原则**：所有方法均为 named、typed、最小能力；preload 不暴露 generic IPC，main 不信任 renderer 参数。

## 1. Named methods（候选命名）

以下方法以 `window.writellm` 为候选 namespace；最终命名、版本前缀和是否拆分 search/citation namespace 需与既有 project IPC contract 一起冻结。

| 方法 | 请求 | 响应 | 说明 |
|---|---|---|---|
| `searchSources` | `SearchSourcesRequest` | `SearchSourcesResponse` | 关键词/自然语言/混合查询，资料名/标签过滤，返回可引用资格和 locator。 |
| `getSourceContext` | `GetSourceContextRequest` | `SourceContextDto` | 只读返回结果附近的 Markdown、原始页码、图片/表格 context refs。 |
| `getSourceSearchStatus` | `GetSourceSearchStatusRequest` | `SourceSearchStatusDto` | 返回 index state、eligible counts、rebuild/error 摘要，不返回内部路径。 |
| `insertCitation` | `InsertCitationRequest` | `CitationMutationResponse` | 以当前 result/target 和 expected block revision 请求 004 content save。 |
| `listBlockCitations` | `ListBlockCitationsRequest` | `CitationBindingDto[]` | 返回当前章节/block 的 citation status 和 display snapshot。 |
| `rebindCitation` | `RebindCitationRequest` | `CitationMutationResponse` | 只接受用户选定的 candidate，校验 source/block revision。 |
| `removeCitation` | `RemoveCitationRequest` | `CitationMutationResponse` | 只移除指定 binding/placement；不得删除其他位置的同一 target。 |

**Decision: NEEDS DECISION**：方法是否合并、是否需要 streaming/progress subscription、是否采用 request/response envelope version、是否延续 `src/shared/ipc.ts` 的 channel naming。

## 2. Request DTO 约束

### SearchSourcesRequest

```text
{
  projectId: OpaqueId,
  query: string,
  mode: "keyword" | "natural-language" | "hybrid" | "auto",
  sourceIds?: OpaqueId[],
  tags?: string[],
  limit: number,
  cursor?: string,
  indexRevision?: OpaqueId
}
```

- `projectId` 可由当前 main workspace 注入；renderer 传值时仍需校验，不能跨项目查询。
- `query` trim 后不得为空；main 校验长度、控制字符和资源上限。
- `limit` 有 main-owned 上限；cursor 为 opaque，renderer 不构造 SQL/engine cursor。
- `indexRevision` 是可选的 optimistic check；不匹配时返回 `SEARCH_INDEX_STALE`，不能静默降级到不完整 index。
- 不允许 `path`、SQL、provider endpoint、embedding vector、raw document、任意 filter expression 或 engine-specific options。

### GetSourceContextRequest

```text
{
  projectId: OpaqueId,
  sourceId: OpaqueId,
  sourceVersionId: OpaqueId,
  chunkId: OpaqueId,
  contextRevision?: OpaqueId,
  before?: number,
  after?: number
}
```

main 重新验证 source/version/chunk 和 project scope；不能只相信 resultId 或 renderer 保存的 text。

### InsertCitationRequest

```text
{
  projectId: OpaqueId,
  sourceId: OpaqueId,
  sourceVersionId: OpaqueId,
  chunkId: OpaqueId,
  resultRevision: OpaqueId,
  targetFingerprint: OpaqueDigest,
  blockId: OpaqueId,
  placementId?: OpaqueId,
  expectedContentRevision: OpaqueRevision
}
```

main 必须重新读取 source provenance 和 block revision；无 locator/text/retrieval representation、source version 已变更、block 已变更或 target fingerprint 不符时拒绝写入。

### RebindCitationRequest / RemoveCitationRequest

```text
RebindCitationRequest {
  projectId, bindingId, expectedBindingStatus,
  candidate: { sourceId, sourceVersionId, chunkId, targetFingerprint },
  expectedContentRevision
}

RemoveCitationRequest {
  projectId, bindingId, expectedContentRevision
}
```

`candidate` 必须来自 main 先前生成的候选或经过同等验证；renderer 不能凭空提交 source path/任意 chunk text。移除是明确的正文 mutation，仍需走 004/ADR 的保存和恢复 contract。

## 3. Response DTO 约束

- 所有 response 都带 `contractVersion`、`projectId`、`requestId` 和 `generatedAt`（若已有通用 envelope 则复用）。
- `SearchSourcesResponse` 包含 `status: "results" | "no-results" | "indexing" | "unavailable"`、`results: SearchResultDto[]`、`nextCursor`、`indexRevision` 和 safe warning；没有结果时 `results` 必须为空，不以错误伪造结果。
- `SearchResultDto` 必须包含 source name/ID、chunk text、parsed locator、original locator、context asset refs、citation eligibility 和 source version identity。
- `SourceContextDto` 不得带绝对路径；图片/表格以安全的 project asset reference 或受控展示 DTO 表示。缺失 asset 必须显式标记。
- `CitationMutationResponse` 包含 `status: "saved" | "stale" | "conflict" | "needs-review"`、binding/target snapshot、new content revision 和 safe warning；只有 main/004 确认保存成功才返回 `saved`。

## 4. Error envelope 与稳定 code

```text
{
  contractVersion: string,
  requestId: string,
  code: StableErrorCode,
  message: SafeUserMessage,
  retryable: boolean,
  details?: { field?: string, entityId?: OpaqueId, state?: string }
}
```

建议稳定 codes（最终表需 Decision freeze）：

| Code | 含义 |
|---|---|
| `INVALID_REQUEST` / `EMPTY_QUERY` | 参数结构、空 query 或超限。 |
| `INVALID_SCOPE` / `IPC_UNAUTHORIZED` | project/entity 不属于当前 scope，或 sender 不可信。 |
| `SOURCE_NOT_READY` | source 仍 processing/partial/failed，不能作为完整证据。 |
| `NO_RESULTS` | 正常查询无匹配；可用 response status 表达，不必抛异常。 |
| `SEARCH_INDEX_UNAVAILABLE` / `SEARCH_INDEX_STALE` | 索引缺失、损坏、版本不一致或正在 rebuild。 |
| `SEARCH_TIMEOUT` / `EMBEDDING_UNAVAILABLE` / `EXTERNAL_PROVIDER_UNAVAILABLE` | provider/worker/查询超时或不可用。 |
| `RESULT_NOT_CITABLE` / `CONTEXT_UNAVAILABLE` | 结果缺少必要文本、representation、locator 或上下文。 |
| `CITATION_NOT_FOUND` / `CITATION_STALE` / `REBIND_AMBIGUOUS` | 引用不存在、失效或候选不唯一。 |
| `CONTENT_REVISION_CONFLICT` | block/正文在请求期间已变化。 |
| `STORAGE_RECOVERY_REQUIRED` / `UNSUPPORTED_SCHEMA_VERSION` | ADR-001 的恢复或迁移边界被触发。 |

错误 message、details 和日志不得包含密钥、完整 endpoint credentials、绝对路径、原始 provider response 或未经脱敏的本地文件信息。

## 5. 安全边界

### Renderer → preload

- renderer 只能调用上述具体函数；不能取得 `ipcRenderer`、`send`、`invoke`、文件系统、shell、child process 或 engine client。
- preload 中的实现只调用固定 channel，并对返回值保持 shared type；不把异常原样暴露给 renderer。

### Preload → main

- main 对每个 handler 校验 `event.sender` 是否为已创建且允许的 window/webContents，并验证所有 request 字段。
- main 再校验 project manifest、source/chunk/block revision、index state 和 citation eligibility；任何来自 renderer 的 ID 都视为不可信。
- provider/worker 调用只在 main 内部发生；网络/密钥/模型 cache 不跨 bridge。

**Contract freeze**：方法名、channel、DTO 字段、错误 codes、最大 query/limit、分页、progress/cancel 机制需在 spec/ADR 接受后标记为 Accepted；当前仍为 **NEEDS DECISION**。

