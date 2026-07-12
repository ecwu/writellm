# ADR-005: User-configured source ingestion services and data-egress boundary

- Status: Proposed — maintainer acceptance pending
- Date: 2026-07-13
- Owners: WriteLLM v2 maintainers
- Scope: `006-source-library-processing` MinerU parsing, SiliconFlow embedding, protected credentials, transport and data egress

## Context

006 sends user-selected PDFs to MinerU for OCR/structured parsing and sends eligible normalized block text to SiliconFlow for dense embeddings with `BAAI/bge-m3`. Both services require credentials obtained and configured by the user. These secrets are application-global and must never enter portable `.writellm` projects, Git, renderer read models or logs.

This boundary is distinct from ADR-004. Feature 005 owns one Pi generation-provider contract; it does not own document parsing or embedding and is not a dependency of 006. ADR-001 remains authoritative for canonical project artifacts and ADR-003 for renderer primitives.

## Decision

1. Main owns versioned 006 service settings and encrypted secrets under Electron `userData`. MinerU and SiliconFlow credentials use Electron async `safeStorage` with no plaintext fallback. Unavailable protection, decrypt failure, revision mismatch or atomic-write failure is fail closed.
2. Renderer may submit a credential through fixed, typed credential methods but can never read it back. Read DTOs expose only configured/available/validation state, safe timestamps and opaque revisions. Credentials, absolute paths, signed URLs, remote ids, raw bodies and external exceptions never cross preload.
3. MinerU transport is a narrow main-only adapter for Precision API v4 signed local upload, polling and result download. It receives only validated current-project PDFs and publishes nothing until the untrusted result archive is normalized and version-fenced.
4. SiliconFlow transport is a narrow main-only adapter fixed to `https://api.siliconflow.com/v1/embeddings`, bearer authentication, `model: "BAAI/bge-m3"` and `encoding_format: "float"`. It receives only bounded eligible block text. Main requires exact request/response correspondence, finite 1024-dimensional vectors and the current index profile before persistence.
5. The two credentials are independent. Neither reuses the 005 key, enters project storage, or grants renderer/network authority. Saving or removing one cannot mutate the other.
6. Main maps authentication, throttling, timeout, service and malformed-response failures to provider-specific stable codes. Logs and diagnostics contain only safe codes, attempt metadata and counts.
7. Durable jobs apply provider-specific throttling, `Retry-After` when present, persisted bounded backoff, attempt caps, idempotency and project/source/profile fencing. App shutdown aborts requests; expired leases resume only when the same project reopens.
8. Users obtain and configure both third-party credentials themselves. Choosing to configure and use a credential is the user's decision to use that service. WriteLLM protects credentials and limits transmitted payloads but does not verify or promise provider retention, deletion, residency, subprocessors, encryption or training policy, and does not promise remote cancellation/deletion.
9. Deterministic fake adapters are mandatory in default tests. Real-service smoke tests require user-supplied disposable credentials and fixtures, remain outside default CI, and must not persist response bodies or secrets.

The exact schemas, typed methods, error codes, job semantics and validation scenarios are frozen by the accepted 006 plan, data model, contract and quickstart.

## Consequences

- 006 no longer requires a local model runtime, ONNX artifacts or an Electron utility process.
- Indexing requires network access, a valid SiliconFlow key and continued availability of `BAAI/bge-m3`; offline projects retain existing vectors but cannot create new embeddings.
- Canonical vectors remain portable project artifacts, while credentials and remote orchestration details remain application-local/runtime-only.
- A provider contract change, model removal or vector-dimension change requires a new index profile and reviewed plan/ADR amendment; results from different profiles cannot mix.
- Third-party costs, quotas and policies are borne under the user's own accounts. UI status must distinguish missing credentials, authentication, throttling, temporary service failure and malformed output without leaking remote details.

## Alternatives considered

- Reuse feature 005 provider settings: rejected because generation, parsing and embedding have different contracts and data-egress purposes.
- Store credentials per project or in Git: rejected because portable content must not contain application secrets.
- Local Transformers.js/ONNX embedding: rejected by product decision and because it adds package size, compatibility and process-supervision complexity.
- Renderer-owned HTTP calls: rejected because it would expose credentials and network authority across the untrusted renderer boundary.
- Treat provider policy review as an implementation gate: rejected by product decision; users supply and choose their own third-party accounts.

## Acceptance checklist before implementation

- [ ] `specs/006-source-library-processing/spec.md`, `plan.md` and `contracts/contract.md` are Accepted.
- [ ] Maintainer accepts two independent user-supplied credentials protected by async `safeStorage` with no plaintext fallback.
- [ ] Maintainer accepts MinerU PDF egress and SiliconFlow eligible-block-text egress through main-only fixed adapters.
- [ ] Maintainer accepts fixed SiliconFlow `BAAI/bge-m3`, 1024-dimensional profile validation and provider-specific durable retry.
- [ ] Maintainer accepts that third-party policy unknowns are not a WriteLLM implementation gate or remote-processing guarantee.
