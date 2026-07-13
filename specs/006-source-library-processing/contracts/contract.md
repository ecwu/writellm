# Contract: PDF 知识库摄取与索引

Status: Accepted v1.2 — original contract, 013 original-PDF preview amendment, and fixed SiliconFlow China endpoint accepted by maintainer 2026-07-13.

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
| `removeSource` | `writellm:sources:remove` | `CancelImportRequest | RemoveSourceRequest` | candidate canceled; confirmation required; removed, referenced, conflict, or error |
| `subscribeSourceEvents` | preload-wrapped receive-only channel | `{ afterSequence: number }` | unsubscribe function; emits bounded event envelopes |

There is no public `startProcessing` because parse/index work starts automatically. There is no remote-cancel promise; removal locally supersedes jobs and rejects late results.

`removeSource` is the single bounded cancellation/removal capability. It accepts an exact discriminated union so canceling a provisional import does not add a generic job method:

```ts
type CancelImportRequest = {
  target: 'candidate'
  candidateId: string
  expectedCatalogRevision: number
}

type RemoveSourceRequest = {
  target: 'source'
  sourceId: string
  expectedSourceRevision: number
  confirmationToken?: string
}

type RemoveSourceResult =
  | { status: 'candidate-canceled'; candidateId: string; catalogRevision: number }
  | { status: 'confirmation-required'; source: SourceSummary; confirmationToken: string; impact: { activeJobCount: number; searchableBlockCount: number } }
  | { status: 'removed'; sourceId: string; catalogRevision: number }
  | { status: 'referenced'; source: SourceSummary }
  | { status: 'conflict'; currentSource?: SourceSummary; catalogRevision: number }
  | { status: 'error'; error: SourceError }
```

For a source, omitting `confirmationToken` performs the fail-closed reference check and, only when the count is zero, returns a short-lived main-signed token. Supplying that token performs deletion only if its project, source and catalog revisions still match. For a candidate, cancellation removes only pending bytes/state; it cannot target a published source or an internal job id.

## Renderer-facing service credential methods

`window.writellmSourceServices` is a separate fixed preload namespace. It exposes seven named methods: `getServiceStatus`, `saveMinerUCredential`, `removeMinerUCredential`, `validateMinerUCredential`, `saveSiliconFlowCredential`, `removeSiliconFlowCredential`, and `validateSiliconFlowCredential`. Save requests contain one write-only credential plus the expected service revision; remove/validate requests contain only the expected revision. Results expose configured/available/validated timestamps, safe provider-specific status codes and the next opaque revision, never credential material or remote response content.

| Method | Channel | Request |
|---|---|---|
| `getServiceStatus` | `writellm:source-services:get` | none |
| `saveMinerUCredential` | `writellm:source-services:mineru-save` | `SaveServiceCredentialInput` |
| `removeMinerUCredential` | `writellm:source-services:mineru-remove` | `ServiceRevisionInput` |
| `validateMinerUCredential` | `writellm:source-services:mineru-validate` | `ServiceRevisionInput` |
| `saveSiliconFlowCredential` | `writellm:source-services:siliconflow-save` | `SaveServiceCredentialInput` |
| `removeSiliconFlowCredential` | `writellm:source-services:siliconflow-remove` | `ServiceRevisionInput` |
| `validateSiliconFlowCredential` | `writellm:source-services:siliconflow-validate` | `ServiceRevisionInput` |

```ts
type SaveServiceCredentialInput = { expectedRevision: string | null; credential: string }
type ServiceRevisionInput = { expectedRevision: string }

type SourceServiceSummary = {
  provider: 'mineru' | 'siliconflow'
  revision: string | null
  configured: boolean
  available: boolean
  validation: {
    status: 'never' | 'running' | 'succeeded' | 'failed'
    completedAt?: string
    code?: SourceErrorCode
  }
}

type GetServiceStatusResult =
  | { status: 'ok'; mineru: SourceServiceSummary; siliconflow: SourceServiceSummary }
  | { status: 'error'; error: SourceError }

type ServiceMutationResult =
  | { status: 'saved' | 'removed'; summary: SourceServiceSummary }
  | { status: 'conflict'; currentSummary: SourceServiceSummary }
  | { status: 'error'; error: SourceError; currentSummary?: SourceServiceSummary }

type ValidateServiceResult =
  | { status: 'completed' | 'stale'; summary: SourceServiceSummary }
  | { status: 'error'; error: SourceError; currentSummary?: SourceServiceSummary }
```

Credentials are 1–4096 characters after rejecting all-whitespace, NUL and control characters; a valid credential is not trimmed or normalized. Exact-key parsing rejects unknown fields, provider/model/endpoint overrides and forged summaries before any storage or network side effect. Validation performs only the provider-specific bounded authentication/capability probe defined by ADR-005, with a 30-second timeout and one in-flight validation per provider revision.

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
  retrying: boolean
  retryable: boolean
}

type SourceDetail = SourceSummary & {
  sourceVersionId: string
  parseSummary: {
    markdownAvailable: boolean
    originalPreviewAvailable: boolean
    mediaCount: number
    blockCount: number
    indexedBlockCount: number
    failedBlockCount: number
    incompleteBlockCount: number
  }
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

`sourceVersionId` is a bounded app-owned identity for the same current version as the
returned detail and block page; it is never a filesystem path, content hash, signed
URL, credential, or remote provider id. All parse counts and availability flags are
reconciled by 006 for that version. A version change during a read returns a
conflict/resync result instead of a mixed detail/page pair.

## Fixed original-PDF preview route (accepted v1.1)

The existing `writellm-source` scheme reserves exactly:

```text
writellm-source://<sourceId>/__original__/<sourceVersionId>.pdf
```

The renderer may construct this URL only from a successful current `SourceDetail`.
Main resolves the active project session itself, validates bounded source/version IDs
and the exact route, requires the current source/version, and resolves only the
owner-defined canonical `original.pdf`. Query strings, fragments, extra segments,
alternate extensions, encoded traversal, arbitrary paths, and non-current versions
are rejected.

Before serving bytes, main verifies a regular file, `%PDF-` signature, accepted size
ceiling, and stored size/hash. Verification may be cached only for the active project
session + source + version + file identity and is invalidated on project/session,
source/version, or file-identity change. No resolved path or raw verification error
leaves main.

- Methods are `HEAD` and `GET` only.
- `GET` accepts no Range or one valid bytes range. Malformed, multi-range,
  overflowing suffix, and unsatisfiable requests return 416.
- Full responses use 200; ranged responses use 206 with exact `Content-Range`,
  `Content-Length`, and `Accept-Ranges: bytes`.
- Successful responses include `Content-Type: application/pdf`, `Cache-Control:
  no-store`, `X-Content-Type-Options: nosniff`, and a restrictive sandbox CSP.
- Invalid, stale, unauthorized, unavailable, or tampered identities share a safe 404
  response. Internal diagnostics contain only accepted safe codes.
- Bytes are streamed and bounded; the implementation must not `readFile` or transfer
  a 200 MB PDF through preload IPC.

The renderer consumes this route through a locally bundled, exact reviewed
`pdfjs-dist` display build and worker. It disables editing, attachments, document
JavaScript, form submission, remote resources, printing/exporting, and Electron PDF
plugins; renders canvas plus accessible text where supported; cancels work on
source/version/mode changes; and ignores late results. Preview success never changes
Markdown availability, indexing completion, or search eligibility.

Contract verification covers exact route/traversal/encoding, sender and active-session
fencing, current-version and file replacement/hash/signature checks, `HEAD`, full and
first/middle/final range reads, 404/416 normalization, cancellation, maximum-size
streaming, project move/switch/removal invalidation, CSP, offline bundled worker load,
and absence of paths, raw exceptions, remote requests, expanded scheme privileges,
or PDF bytes in preload IPC.

## Import outcomes and duplicate lifecycle

The 10-second SC-001 acknowledgement measures dialog return plus a lightweight filename/size/signature screen, not full copy/hash/upload. Each selected item receives one immediate outcome:

```ts
type ImportOutcome =
  | { status: 'queued'; candidateId: string; displayName: string }
  | { status: 'possible-duplicate'; candidateId: string; displayName: string }
  | { status: 'rejected'; displayName: string; error: SourceError }
```

Every readable selection receives a provisional candidate before the 10-second acknowledgement boundary; `queued` means the item passed the lightweight screen and `possible-duplicate` means its filename/size matched an existing source. Neither outcome claims that full copy/hash has completed or exposes a path. Main then copies to a pending transaction and computes SHA-256. If the hash matches, pending bytes are removed, no Source/job/index is published, and a `candidate-updated` event carries `candidateStatus: 'duplicate-confirmed'`. A candidate-targeted `removeSource` call cancels the provisional item and cleans pending bytes. If hashes differ, the candidate atomically publishes a Source and emits `source-upserted` plus candidate acceptance. This resolves duplicate warnings without creating a durable duplicate Source and keeps acknowledgement independent of full-file hashing.

## Events and replay

```ts
type SourceEvent = {
  sequence: number
  catalogRevision: number
  type: 'source-upserted'|'source-removed'|'candidate-updated'|'resync-required'
  source?: SourceSummary
  candidateId?: string
  candidateStatus?: 'queued'|'possible-duplicate'|'duplicate-confirmed'|'accepted'|'canceled'|'failed'
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

Main validates credentials only through `GET https://api.siliconflow.cn/v1/models` and calls only `https://api.siliconflow.cn/v1/embeddings` for embedding, with bearer authentication, `model: "BAAI/bge-m3"`, `encoding_format: "float"`, and bounded eligible plain text. The product exposes no region or endpoint selector and never sends the credential or content to `api.siliconflow.com`. It batches at most 16 blocks/256 KiB and never exceeds 8192 input tokens per item. Main validates response count/order, ids mapped from request indices, exact 1024 dimensions, finite values and profile consistency, then owns persistence. The SiliconFlow key, response bodies, usage metadata and remote errors never cross preload or enter project files/Git/logs. Tests replace both external adapters with deterministic fakes.

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
