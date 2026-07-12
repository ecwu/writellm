# Data Model: PDF 知识库摄取与索引

All canonical project documents use UTF-8 JSON/JSONL, carry `kind` and `schemaVersion: 1`, and are created/validated by main. IDs are UUIDs unless otherwise stated. Timestamps are ISO-8601 UTC. Unknown schema versions are rejected without mutation.

## Project layout

```text
sources/
├── catalog.json
└── <sourceId>/
    ├── source.json
    ├── original.pdf
    └── versions/<sourceVersionId>/
        ├── manifest.json
        ├── full.md
        ├── blocks.jsonl
        ├── media/<mediaId>.<ext>
        └── embeddings/<indexProfileId>.f32
runtime/
├── source-jobs/jobs.jsonl
├── source-jobs/snapshots.json
├── source-downloads/
└── pending/
```

`runtime/source-downloads` and active queue material are ignored/rebuildable. Canonical source files and vectors are tracked by ADR-001 transactions. Paths never cross IPC.

## SourceCatalog

Fields: `kind: "writellm.source-catalog"`, `schemaVersion: 1`, `projectId`, `revision`, `sources: SourceSummary[]`.

`SourceSummary`: `sourceId`, `displayName`, `sizeBytes`, `sha256`, `importedAt`, `currentVersionId`, `state`, `eligibleBlockCount`, `indexedBlockCount`, `failedBlockCount`, `updatedAt`.

Invariants:

- One row per `sourceId`; `sha256` is unique among non-deleted sources.
- `revision` increases once per published catalog transaction.
- No absolute path, remote task id, token, signed URL, or raw error appears here.

## Source

Fields: `kind: "writellm.source"`, `schemaVersion: 1`, `projectId`, `sourceId`, `revision`, `displayName`, `originalName`, `mime: "application/pdf"`, `sizeBytes`, `sha256`, `importedAt`, `currentVersionId`, `state`, `failure?`.

`state`: `queued | parsing | indexing | available | partial | failed`.

Validation:

- `displayName/originalName` are bounded safe leaf names (1–255 Unicode scalar values, no control/NUL/path separators in normalized comparison).
- `sizeBytes` is positive and within the accepted MinerU limit; `sha256` is lowercase 64-hex.
- The original PDF hash must match before upload, retry, and publication.
- A source is immutable in v1: retry creates work for the same version; replacement is unsupported.

## SourceVersion

Fields: `kind: "writellm.source-version"`, `schemaVersion: 1`, `projectId`, `sourceId`, `sourceVersionId`, `revision`, `sourceSha256`, `parseProfileId`, `parseState`, `indexProfileId`, `indexState`, `blockCount`, `eligibleBlockCount`, `indexedBlockCount`, `failedBlockCount`, `publishedAt?`.

Invariants:

- `sourceVersionId` is fixed at import and scopes every job/result.
- A result publishes only when `(projectId, sourceId, sourceVersionId, inputHash, profileId)` still matches.
- `available` requires every eligible block to have a valid current embedding; `partial` requires at least one valid embedding and at least one failed/ineligible block.

## ContentBlock

JSONL fields: `kind: "writellm.source-block"`, `schemaVersion: 1`, `sourceId`, `sourceVersionId`, `chunkId`, `ordinal`, `blockType`, `markdown`, `plainText`, `mediaIds`, `mineruMetadata`, `contentHash`, `eligibility`, `indexState`.

`blockType`: `heading | paragraph | list | table | image | formula | other`.

`eligibility`: `{ eligible: boolean; reason?: "empty" | "media-only" | "invalid-structure" | "too-large" }`.
`indexState`: `not-eligible | queued | running | indexed | failed`.

Invariants:

- `chunkId = base32(sha256(sourceVersionId + ordinal + blockType + contentHash))` and is unique in the version.
- Ordinals are contiguous, unique, and preserve normalized MinerU reading order.
- `plainText` is non-empty and bounded for eligible blocks; large blocks are deterministically split into child blocks before identity is frozen.
- Media references must resolve within the same source version.
- MinerU metadata is bounded JSON data, never executable markup or a durable remote identity.

## MediaAsset

Represented in the version manifest: `mediaId`, `relativePath`, `mime`, `sizeBytes`, `sha256`, `ordinal`, `referencedByChunkIds`, `integrity`.

`integrity`: `valid | missing | invalid`. Only allowlisted image formats are published; SVG/HTML and active content are rejected. A missing/invalid referenced asset makes affected blocks ineligible but need not invalidate unrelated blocks.

## IndexProfile and EmbeddingRecord

`IndexProfile`: `indexProfileId`, `provider: "siliconflow"`, `endpointContract: "v1/embeddings"`, `modelId: "BAAI/bge-m3"`, `profileRevision`, `dimensions: 1024`, `dtype: "float32"`, `normalized: true`, `maxTokens: 8192`.

`EmbeddingRecord`: `chunkId`, `contentHash`, `indexProfileId`, `offset`, `length: 1024`, `vectorHash`, `createdAt`, `valid`.

Invariants:

- A vector is valid only if all values are finite, length is exactly 1024, its norm is within the accepted profile tolerance, and hashes/profile/content match.
- Vector offsets never cross IPC. 007 consumes a main-owned query contract over eligible block summaries and the same profile.
- Re-indexing creates a new profile file and atomically switches the manifest; old results cannot overwrite it.

## ProcessingJob

JSONL event/snapshot fields: `jobId`, `jobKind: parse | embed`, `idempotencyKey`, `projectId`, `sourceId`, `sourceVersionId`, `chunkId?`, `profileId`, `state`, `attempt`, `maxAttempts: 6`, `nextAttemptAt?`, `leaseOwner?`, `leaseExpiresAt?`, `remoteTaskId?`, `progress`, `failure?`, `createdAt`, `updatedAt`.

`state`: `queued | running | waiting-retry | succeeded | failed | canceled | superseded`.

Rules:

- Exactly one non-terminal job per idempotency key.
- Expired `running` leases recover to `waiting-retry`; durable success is revalidated before marking succeeded.
- Delete/revision change supersedes outstanding jobs. Late results fail the version check and are discarded.
- `failure` contains only stable code, safe message key, stage, retryability, attempt and affected chunk ids.

## State transitions

```text
import → queued → parsing → indexing → available
                     │          ├────→ partial
                     └──────────→ failed

job: queued → running → succeeded
                ├──→ waiting-retry → running
                ├──→ failed
                ├──→ canceled
                └──→ superseded
```

Retry never erases valid results. Remove is allowed only after the main-owned citation-reference check returns zero; it atomically supersedes jobs, removes catalog/canonical source files, and commits the processing event. A tombstoned version/revision guard prevents late publication.
