# Research: PDF 知识库摄取与索引

Date: 2026-07-12
Status: Phase 0 complete; decisions are proposed until the feature plan and required ADR are accepted.

## 1. PDF parsing service

**Decision**: Use MinerU Precision Extract API v4 through a narrow main-owned adapter. Import local PDFs with the signed-upload flow, submit at most one source per durable parse job, poll durable remote task identity, and download the result archive only after a successful terminal state. Select the `vlm` model and request the default Markdown and JSON outputs. Do not use the Agent Lightweight API.

**Rationale**: The spec requires scanned-PDF OCR, tables, images, stable reading order, and block metadata. MinerU documents the Precision API as asynchronous, token-protected, batch-capable, and returning Markdown plus JSON; it supports files up to 200 MB and exposes structured output files. The lightweight API returns Markdown only and therefore cannot satisfy FR-005–FR-007. One source per local durable job preserves independent retry, cancellation, deletion, and progress even though the remote API supports batches.

**Alternatives considered**:

- Local MinerU CLI/server: rejected for v1 because Python/model/runtime packaging, GPU/CPU variance, process supervision, and multi-platform signing materially enlarge the Electron product.
- PDF.js, unpdf, MuPDF.js, Tika: rejected as the canonical parser because none matches the accepted requirement to consume MinerU OCR and its structured output.
- MinerU Agent Lightweight API: rejected because Markdown-only output loses the required media and block metadata contract.

**Primary sources**: [MinerU API documentation](https://mineru.net/doc/docs/index_en/), [MinerU output-file reference](https://opendatalab.github.io/MinerU/reference/output_files/), [MinerU rate-limit policy](https://mineru.net/doc/docs/limit_en/).

## 2. MinerU limits and adaptive scheduling

**Decision**: Validate PDF signature and the documented Precision API size/page ceiling before upload when page count can be read safely; otherwise let MinerU return a bounded rejection. Default to one active upload/parse per project, use server `Retry-After` when present, otherwise exponential backoff with full jitter (5 s base, 15 min cap), and cap automatic attempts at 6. Poll no faster than every 5 seconds per task and globally throttle below documented submission/result ceilings. Persist `nextAttemptAt`, remote task id, and attempt count.

**Rationale**: MinerU currently documents dynamic limits, 429 responses, and separate submission/result ceilings. A conservative client limit avoids bursts while persisted scheduling makes restart safe. Authentication, invalid input, exceeded hard limits, and malformed terminal archives are not automatically retried; 429, timeout, network loss, and 5xx are retryable.

**Alternatives considered**:

- Hard-code the published maximum request rate: rejected because limits may change and desktop workloads do not need that throughput.
- Infinite retry: rejected because it hides permanent failures and can create an abusive loop.
- In-memory timers only: rejected because tasks must survive app/project restart.

## 3. Credentials and data egress

**Decision**: Add dedicated application-global MinerU and SiliconFlow credential configurations owned by main and protected with Electron `safeStorage`, reusing the fail-closed security mechanics and redaction rules of ADR-004 but not its provider-settings contract. Users obtain and configure both credentials themselves. Credentials, signed upload URLs, remote raw errors, absolute paths, and response bodies never cross preload or enter project files/Git/logs. ADR-005 records this durable/network boundary.

**Rationale**: Feature 005 owns Pi generation settings, not document parsing or embedding. 006 therefore does not depend on or expand 005. Configuring and using user-supplied credentials is the user's choice to use those third-party services; 006 protects secrets and minimizes payloads but does not promise provider retention, deletion, residency, subprocessors or training behavior.

**Alternatives considered**:

- Reuse the 005 API key: rejected because it is scoped to an OpenAI-compatible endpoint.
- Store the token in each project: rejected because secrets must not enter portable project content or Git.
- Anonymous lightweight parsing: rejected because it cannot return the required structured artifacts.

## 4. Parse output normalization

**Decision**: Treat the downloaded archive as untrusted. Accept only an allowlisted bounded set (`full.md`, content list/layout JSON, referenced media), reject path traversal/symlinks/duplicate normalized paths, cap expanded bytes and entry count, and validate JSON with exact schema adapters. Derive app-owned `chunkId` values from source version plus canonical block ordinal/type/content hash; never use remote ids as durable identity. Preserve the remote block metadata as bounded JSON after removing unknown oversized values.

**Rationale**: MinerU output names and schemas can evolve. App-owned normalization isolates that evolution, provides stable identity, and prevents archive extraction vulnerabilities or old/late remote results from becoming current.

**Alternatives considered**:

- Persist the archive as the domain model: rejected because third-party schema and archive paths would become an irreversible project contract.
- Reconstruct blocks from Markdown alone: rejected because it loses layout/media relationships required by the spec.

## 5. Semantic embedding

**Decision**: Generate dense embeddings through SiliconFlow `POST /v1/embeddings` using the fixed model id `BAAI/bge-m3`, `encoding_format: "float"`, and user-supplied SiliconFlow key. Persist a fixed profile with provider, endpoint contract version, model id, 1024 dimensions, max input 8192 tokens, normalization policy and profile revision. Main sends only eligible block text in bounded batches and validates response order, count, finite values and exact dimensions before publication.

**Rationale**: The user selected SiliconFlow and `BAAI/bge-m3`. SiliconFlow documents the OpenAI-shaped endpoint, bearer authentication, batched string input and an 8192-token limit for this model; the BAAI model card fixes the dense vector at 1024 dimensions. A fixed profile lets 007 embed queries through the same provider/model contract and reject mixed vector spaces.

**Alternatives considered**:

- Use the configured 005 model: rejected because it is a generation-model contract and 006 is independent of 005.
- Local Transformers.js/ONNX inference: rejected by product decision; it adds model packaging, platform compatibility, size and utility-process complexity.
- Renderer/WebGPU inference: rejected because renderer is untrusted and availability varies by device.
- Store an approximate nearest-neighbor database now: rejected; 006 persists validated vectors, while 007 chooses/query-tests the smallest retrieval structure suitable for project scale.

**Primary sources**: [SiliconFlow embeddings API](https://docs.siliconflow.com/en/api-reference/embeddings/create-embeddings), [BAAI/bge-m3 model card](https://huggingface.co/BAAI/bge-m3).

## 6. Durable jobs and concurrency

**Decision**: Store a project-owned JSONL job ledger plus per-source canonical manifests. Main is the sole scheduler and writer. Parse jobs are source-version scoped and serial per project; independent SiliconFlow embedding jobs use bounded batches with at most two active requests per project and provider-aware throttling. Leasing uses `leaseOwner`, `leaseExpiresAt`, CAS revision, and idempotency key. On open, expired `running` jobs become `waiting-retry`; completed results are revalidated and never recomputed when their version/profile hashes match.

**Rationale**: ADR-001 already defines main-owned project transactions and recoverable pending state. A compact append-only ledger plus canonical snapshots is sufficient for a single-author desktop queue and avoids adding SQLite before query needs justify it.

**Alternatives considered**:

- SQLite: rejected for v1 because it adds native/runtime/migration complexity without a demonstrated need.
- One job per source covering parse and all embeddings: rejected because partial success and block-level retry would be lost.
- Renderer-owned queue: rejected by the security and restart requirements.

## 7. Project storage and Git

**Decision**: Track original PDFs, normalized Markdown, validated metadata, media, source manifests, and job terminal summaries under `sources/`. Keep active leases, downloaded archives, temporary extraction, and regenerable vector payloads under ignored `runtime/`; persist canonical vector files under `sources/` because 007 requires durable offline retrieval. Commit import acceptance, normalized parse publication, indexing terminal/partial publication, retry outcome, and deletion as separate `processing` events through ADR-001 transactions. Progress heartbeats do not create commits.

**Rationale**: Canonical user source and reproducible retrieval state must move with the project. Churn-heavy intermediates must not inflate history. Publication transactions prevent a valid old version from being overwritten by partial or late work.

**Alternatives considered**:

- Ignore all embeddings: rejected because FR-010 requires persistent index results and moving a project would lose search readiness.
- Commit every progress update: rejected because it creates noisy history with no user-value boundary.

## 8. Contract and verification strategy

**Decision**: Expose six source-library methods: `listSources`, `importSourcesFromDialog`, `getSource`, `retrySource`, `removeSource`, and `subscribeSourceEvents`. Import opens the native dialog in main; renderer never supplies paths. Event delivery uses bounded sequence-numbered snapshots and must recover gaps through `listSources/getSource`. All mutations carry `projectId`, `projectRevision`, and expected source revision where applicable.

**Rationale**: These operations cover the accepted user actions without exposing generic file/job controls. Sequence/gap recovery prevents UI truth from depending on an ephemeral event.

**Alternatives considered**:

- Poll-only UI: possible but needlessly delays progress; retained as the recovery mechanism rather than primary delivery.
- Generic job API: rejected because it exposes internal orchestration and broadens preload authority.

## Resolved unknowns and remaining acceptance gates

There are no `NEEDS CLARIFICATION` items in the technical design. The following are acceptance gates, not hidden implementation choices:

1. Maintainer acceptance of the feature spec, contracts and this plan.
2. Acceptance of ADR-005 covering both user-supplied credentials and data-egress boundaries.
