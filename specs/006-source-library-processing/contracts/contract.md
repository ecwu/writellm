# Contract: PDF 知识库摄取与索引

Status: Draft v1. Acceptance is gated by the feature plan and ADR-005.

## Boundary rules

- `window.writellmSources` is a separate preload namespace. No generic `invoke/send/on`, path, file handle, PDF bytes, vector, credential, remote id/URL, or raw exception crosses it.
- Main resolves the active project session itself. Requests never contain a project path and cannot select another project. Every handler validates the expected sender and exact request shape.
- Normal failures resolve typed unions. Promise rejection is reserved for process loss.
- DTO strings, arrays and pages are capped; unknown keys are rejected. Renderer renders all external text as text, never trusted HTML.
- Mutations use expected revisions. A stale project/source revision returns conflict and cannot publish or delete.

## Renderer-facing methods

| Method | Channel | Request | Result |
|---|---|---|---|
| `listSources` | `writellm:sources:list` | `{ cursor?: string; limit: 1..100 }` | bounded summaries + next cursor + catalog revision |
| `importSourcesFromDialog` | `writellm:sources:import-dialog` | `{ expectedCatalogRevision: number }` | canceled or up to 100 per-file outcomes |
| `getSource` | `writellm:sources:get` | `{ sourceId; cursor?: string; limit: 1..100 }` | detail + bounded block preview page |
| `retrySource` | `writellm:sources:retry` | `{ sourceId; expectedSourceRevision }` | accepted/current summary or conflict/error |
| `removeSource` | `writellm:sources:remove` | `{ sourceId; expectedSourceRevision; confirmationToken }` | removed, referenced, conflict, or error |
| `subscribeSourceEvents` | preload-wrapped receive-only channel | `{ afterSequence: number }` | unsubscribe function; emits bounded event envelopes |

There is no public `startProcessing` because parse/index work starts automatically. There is no remote-cancel promise; removal locally supersedes jobs and rejects late results.

## Renderer-facing service credential methods

`window.writellmSourceServices` is a separate fixed preload namespace. It exposes seven named methods: `getServiceStatus`, `saveMinerUCredential`, `removeMinerUCredential`, `validateMinerUCredential`, `saveSiliconFlowCredential`, `removeSiliconFlowCredential`, and `validateSiliconFlowCredential`. Save requests contain one write-only credential plus the expected service revision; remove/validate requests contain only the expected revision. Results expose configured/available/validated timestamps, safe provider-specific status codes and the next opaque revision, never credential material or remote response content.

Credential mutations are application-global and main-serialized. Each provider has an independent revision and validation state. Saving/removing MinerU cannot alter SiliconFlow and vice versa. A missing, locked, undecryptable or revision-mismatched secret fails closed. This namespace does not accept a URL or model name: endpoints and the SiliconFlow `BAAI/bge-m3` model are fixed by ADR-005.

## Read models

```ts
type SourceState =
  | 'queued' | 'parsing' | 'indexing'
  | 'available' | 'partial' | 'failed'

type SourceSummary = {
  sourceId: string
  revision: number
  displayName: string
  sizeBytes: number
  importedAt: string
  state: SourceState
  progress: { completed: number; total: number; stage: 'queued'|'parsing'|'indexing' }
  eligibility: { indexed: number; eligible: number; failed: number }
  retryable: boolean
}

type SourceDetail = SourceSummary & {
  parseSummary: { markdownAvailable: boolean; mediaCount: number; blockCount: number }
  failure?: { code: SourceErrorCode; messageKey: string; stage: 'import'|'parse'|'index'|'remove' }
}

type BlockPreview = {
  chunkId: string
  ordinal: number
  blockType: 'heading'|'paragraph'|'list'|'table'|'image'|'formula'|'other'
  markdown: string
  media: Array<{ mediaId: string; alt: string; available: boolean }>
  searchable: boolean
}
```

Preview Markdown is bounded to 64 KiB per block and treated as untrusted input. A page is at most 100 blocks/1 MiB. Media is loaded only through a separate app-owned safe protocol keyed by `sourceId/mediaId`, with active-session and MIME validation; no filesystem path is returned.

## Import outcomes and duplicate lifecycle

The 10-second SC-001 acknowledgement measures dialog return plus a lightweight filename/size/signature screen, not full copy/hash/upload. Each selected item receives one immediate outcome:

```ts
type ImportOutcome =
  | { status: 'accepted'; source: SourceSummary }
  | { status: 'possible-duplicate'; candidateId: string; displayName: string }
  | { status: 'rejected'; displayName: string; error: SourceError }
```

Main creates an accepted source only after copying to a pending transaction and computing SHA-256. A filename/size match is a provisional candidate; hashing continues in main. If the hash matches, pending bytes are removed, no Source/job/index is published, and the candidate emits `duplicate-confirmed`. “Cancel this item” cancels the provisional candidate. If hashes differ, the candidate atomically publishes a Source and emits `accepted`. This resolves duplicate warnings without creating a durable duplicate Source.

## Events and replay

```ts
type SourceEvent = {
  sequence: number
  catalogRevision: number
  type: 'source-upserted'|'source-removed'|'candidate-updated'|'resync-required'
  source?: SourceSummary
  candidateId?: string
}
```

Main emits monotonically increasing per-session sequence values. The preload supports only the fixed source event channel and validates envelopes. On sequence gap, restart, overflow, or `resync-required`, renderer discards incremental assumptions and calls `listSources/getSource`. Events are hints; durable reads are authoritative.

## Stable errors

`NO_ACTIVE_PROJECT`, `SOURCE_INVALID_INPUT`, `SOURCE_UNAUTHORIZED_SENDER`, `SOURCE_CONFLICT`, `SOURCE_NOT_FOUND`, `SOURCE_IMPORT_UNREADABLE`, `SOURCE_UNSUPPORTED_PDF`, `SOURCE_LIMIT_EXCEEDED`, `SOURCE_DUPLICATE`, `SOURCE_STORAGE_UNAVAILABLE`, `SOURCE_RECOVERY_REQUIRED`, `SOURCE_MINERU_NOT_CONFIGURED`, `SOURCE_MINERU_AUTH`, `SOURCE_MINERU_RATE_LIMITED`, `SOURCE_MINERU_TEMPORARY`, `SOURCE_MINERU_REJECTED`, `SOURCE_MINERU_MALFORMED`, `SOURCE_SILICONFLOW_NOT_CONFIGURED`, `SOURCE_SILICONFLOW_AUTH`, `SOURCE_SILICONFLOW_RATE_LIMITED`, `SOURCE_SILICONFLOW_TEMPORARY`, `SOURCE_INDEX_MODEL_UNAVAILABLE`, `SOURCE_INDEX_MALFORMED`, `SOURCE_INDEX_FAILED`, `SOURCE_REFERENCED`, `SOURCE_INTERNAL`.

`SourceError` contains only `{ code, messageKey, retryable, affectedChunkCount? }`. It never includes a path, filename rejected by a remote service, token, signed URL, remote task id, response body, stack, vector, or arbitrary external message.

## MinerU adapter (main-only)

```ts
interface MinerUAdapter {
  submitLocalPdf(input: {
    jobId: string; dataId: string; absolutePath: MainOnlyPath;
    modelVersion: 'vlm'; ocr: true; tables: true; formulas: true;
    signal: AbortSignal
  }): Promise<{ remoteBatchId: SecretRemoteId }>
  poll(input: { remoteBatchId: SecretRemoteId; signal: AbortSignal }): Promise<MinerUObservation>
  download(input: { resultUrl: SecretUrl; destination: MainOnlyPath; signal: AbortSignal }): Promise<void>
}
```

External observations are mapped to `pending | running | done | failed` plus bounded progress and stable failure classification. The adapter follows signed-upload → PUT → poll → immediate result download. It conservatively enforces 200 MB/200 pages and submits one source per app job because official pages currently disagree on larger page/batch limits. Remote cancellation/deletion is not promised. Archive output is accepted only by the normalization validator described in `research.md`.

## SiliconFlow embedding adapter (main-only)

```ts
interface EmbeddingAdapter {
  describeProfile(): Promise<IndexProfile>
  embed(input: { jobId: string; model: 'BAAI/bge-m3'; texts: Array<{ chunkId: string; contentHash: string; text: string }>; signal: AbortSignal }):
    Promise<Array<{ chunkId: string; contentHash: string; vector: Float32Array }>>
}
```

Main calls only `https://api.siliconflow.com/v1/embeddings` with bearer authentication, `model: "BAAI/bge-m3"`, `encoding_format: "float"`, and bounded eligible plain text. It batches at most 16 blocks/256 KiB and never exceeds 8192 input tokens per item. Main validates response count/order, ids mapped from request indices, exact 1024 dimensions, finite values and profile consistency, then owns persistence. The SiliconFlow key, response bodies, usage metadata and remote errors never cross preload or enter project files/Git/logs. Tests replace both external adapters with deterministic fakes.

## 006 → 007 searchable-block contract

006 owns this main-domain read interface; it is not exposed directly to renderer:

```ts
type SearchableBlock = {
  projectId: string; sourceId: string; sourceVersionId: string; chunkId: string
  ordinal: number; plainText: string; contentHash: string
  mediaIds: string[]; mineruMetadata: BoundedJson
  indexProfileId: string; vector: Float32Array
}

interface SourceIndexReader {
  getIndexProfile(projectSession: ProjectSession): Promise<IndexProfile>
  listSearchableBlocks(projectSession: ProjectSession): AsyncIterable<SearchableBlock>
  getBlock(projectSession: ProjectSession, sourceId: string, chunkId: string): Promise<SearchableBlock | null>
}
```

Only current-version, structurally valid, indexed blocks are yielded. 007 must use the same profile for queries and must not infer eligibility from files or display names.

## Citation reference guard

```ts
interface SourceReferenceReader {
  countReferences(projectSession: ProjectSession, sourceId: string): Promise<number | 'unknown'>
}
```

006 supplies a reader that scans currently understood chapter citation nodes. 007 extends the shared citation parser/contract when it introduces citations. `unknown`, read failure, or unsupported citation schema fails closed as `SOURCE_REFERENCED`; deletion never guesses zero. `removeSource` first returns a short-lived main-signed confirmation token describing impact, then requires the same source/project revisions for final deletion.
