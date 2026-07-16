# Phase 6: Project Knowledge Source Storage And Providers

## Phase overview

- Purpose: import durable project-local sources, manage provider configuration and secrets, and expose provider-neutral model gateways.
- Checkpoints: 12–14.
- Current status: Completed after audit remediation; Checkpoints 12–14 are complete and verified.
- Implementation state: functional import/provider/model implementations exist, with format, lifecycle, protocol, and recovery remediation at the end of this file.

### Checkpoint 12: Batch Source Import And Project-Local File Records

Implementation scope: add a narrow Main-owned batch source selection and ingestion boundary, schema v8 project records for content-addressed originals and knowledge item state, a streaming temp-copy/hash/publish service with duplicate and cancellation semantics, and a shadcn knowledge list wired through project-session-scoped IPC. Renderer input is limited to opaque picker/drop tokens and never receives or submits arbitrary filesystem paths. This checkpoint stops at durable local originals and high-level ingestion state; provider submission and parsing remain disabled until Checkpoints 13 and 15.

- [x] Implement batch file picker and drag/drop contracts without exposing renderer filesystem access.
- [x] Define exact supported MIME/extension capability checks for PDF, DOCX, PPTX, and common images.
- [x] Reject or clearly route legacy DOC/PPT rather than misidentifying them.
- [x] Copy each source to project temp storage while hashing.
- [x] Sanitize display names while preserving the original name in metadata.
- [x] Publish originals under content-addressed project-local paths.
- [x] Define duplicate policy by SHA-256 and ensure repeated import is idempotent.
- [x] Create `file_records`, `knowledge_items`, and high-level ingestion state.
- [x] Build the knowledge item list with per-file progress, failure, retry, cancel, delete, and reveal/open-original actions.
- [x] Implement deletion policy that cancels pending work and schedules index removal without leaving active references.
- [x] Add tests for Unicode names, spaces, long names, duplicate content, MIME mismatch, interrupted copy, insufficient disk space, and project close during import.

Acceptance criteria: imported originals are durable inside the project before remote submission; duplicate imports do not create duplicate bytes or external tasks; renderer-controlled paths cannot escape the active project.

Checkpoint 12 verification: schema v8 adds authoritative `file_records`, `knowledge_items`, and `imports` with explicit lifecycle state and migration/restore coverage. Main validates count, aggregate/per-file size, regular-file identity, supported extension, and matching PDF/OOXML/image signatures; legacy DOC/PPT is explicitly rejected. It streams each source through project temp storage while hashing, checks the source did not change, serializes publication to prevent duplicate races, atomically renames into `knowledge/originals/sha256/<prefix>/<hash>/<sanitized-name>`, and commits the project-relative record. Duplicate hashes reuse one file and knowledge item.

The sandboxed renderer receives no paths: native selection stays in Main, while dropped DOM `File` values pass through preload `webUtils.getPathForFile` and immediately invoke validated IPC. The shadcn knowledge sheet shows copy progress and stored/failed/cancelled state with retry, cancel, delete, open, and reveal actions. Project close rejects queued imports, aborts active streams, waits for cleanup, and publishes no partial artifact; deletion cancels work and removes the only authoritative reference before best-effort byte cleanup (there are no derived index references before Checkpoint 17). Tests cover Unicode/spaces, long sanitized names, SHA deduplication, MIME mismatch, legacy formats, symlinks, cancellation/interrupted copy, injected ENOSPC, migration compatibility, reopen persistence, and Electron UI import. Verification passes `pnpm check` with only the pre-existing generated shadcn sidebar cookie warning, Node/web TypeScript, Electron-hosted Vitest (40 files and 213 tests), production build, all 7 Playwright Electron E2E tests, and `git diff --check`.

### Checkpoint 13: Secrets, Provider Configuration, And Capability Registry

Implementation scope: add app-schema provider and encrypted credential records, a Main-owned safeStorage credential service with explicit Linux backend policy, a validated capability registry and renderer-safe status contracts, sender-authorized app IPC, and the global shadcn Command settings surface for endpoints/models/connection tests. No plaintext secret may cross IPC back to the renderer or enter project state, diagnostics, snapshots, logs, or job payloads.

- [x] Implement `app.sqlite` provider configuration records and `safeStorage` ciphertext persistence.
- [x] Detect and report the Linux safeStorage backend, including the `basic_text` policy.
- [x] Expose configured/unconfigured provider status without returning secret values.
- [x] Define a provider capability registry for agent chat/tool-calling, embeddings, reranking, and MinerU parsing.
- [x] Validate base URLs, provider IDs, models, dimensions, batch limits, file limits, timeout limits, and supported formats.
- [x] Implement a credential resolver that decrypts only for the current utility request.
- [x] Ensure secrets never enter project files, job payloads, renderer state, logs, snapshots, or diagnostic exports.
- [x] Add settings UI for provider endpoints, model choices, connection tests, and capability status.
- [x] Test redaction, missing keys, invalid auth, key replacement, provider removal, project portability without keys, and Linux backend reporting.

Acceptance criteria: project folders and snapshots contain no plaintext credentials; only Main can persist/decrypt secrets; provider capability failures are explicit before durable work starts.

Checkpoint 13 verification: the existing application-owned `provider_configs` and `encrypted_credentials` tables now have a typed service that persists only `safeStorage` ciphertext and renderer-safe metadata. Main reports Keychain/DPAPI/Linux backend state, refuses both persistence and resolution on Linux `basic_text`, decrypts one credential only around the current request callback, and never returns a secret through IPC. The capability registry separates agent chat/tool-calling, embeddings, reranking, and MinerU parsing; its MinerU limits come from the official MinerU API documentation (precise API: 200 MB, 200 pages, and 200-file batches) while supported formats deliberately remain bounded to the current import slice.

Sender-authorized IPC and the global shadcn Command settings surface support endpoint/model/limit editing, key replacement, removal, capability/backend status, and normalized connection tests. Connection tests run in a short-lived Electron utility process rather than Main; the credential crosses only the Main-to-utility message for that request, and response/error protocols contain no provider body or credential. Review hardening added versioned-base-path preservation, utility abort/exit arbitration, `ciphertext` diagnostic redaction, rejection of legacy `basic_text` records, and a real E2E loopback provider. Verification passes Biome on 180 files with only the pre-existing generated shadcn sidebar cookie warning, Node/web TypeScript, Electron-hosted Vitest (45 files and 228 tests), production build with the provider-probe entrypoint, all 8 Playwright Electron E2E tests, and `git diff --check`. The E2E proves safeStorage-to-utility Bearer use, restart without secret echo, and project opening under fresh application data without provider keys.

### Checkpoint 14: Pi Model Runtime, Embedding Gateway, And Rerank Gateway

Implementation scope: pin only the approved Pi and AI SDK runtime packages, introduce separate agent/embedding/rerank boundaries, add project-local normalized `model_requests` provenance, and execute all provider I/O in the appropriate credential-scoped utility processes. Work proceeds package/API characterization first, then contracts and schema, runtime adapters, utility protocols, and mock-provider failure/streaming/abort/redaction verification. Functional writing-agent orchestration remains owned by Phase 9, beginning with Checkpoint 20.

- [x] Install and pin `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai`.
- [x] Install and pin AI SDK Core plus only the embedding/rerank provider packages required by the first product slice.
- [x] Define separate `AgentModelRuntime`, `EmbeddingGateway`, and `RerankGateway` interfaces.
- [x] Implement a Pi `CredentialStore` adapter backed by Main-owned safeStorage records rather than Pi's default file store.
- [x] Implement AI SDK `embedMany` adapters with batch limits, retry policy, usage, response IDs, and abort support.
- [x] Implement AI SDK rerank adapters with top-N limits, retry policy, usage where available, and abort support.
- [x] Implement OpenAI-compatible custom endpoint support only behind validated adapters.
- [x] Normalize provider/model fingerprints, timing, token/usage metadata, estimated cost, retry count, and structured errors in `model_requests`.
- [x] Place external requests in the appropriate utility process and keep credentials ephemeral.
- [x] Add mock-provider contract tests for success, streaming, abort, rate limit, authentication failure, malformed response, retryable server error, and redaction.

Acceptance criteria: Pi owns interactive agent generation; AI SDK owns embedding/rerank adapters; business code does not depend on provider-specific response shapes; no credential or unredacted body leaks into ordinary logs.

Checkpoint 14 verification: Pi Agent Core/Pi AI 0.80.7, AI SDK Core 7.0.28, OpenAI-compatible 3.0.10, and Cohere 4.0.10 are exact production pins. Main exposes three provider-neutral boundaries and a safeStorage-backed Pi `CredentialStore`; actual credentials are resolved only around a request and cross only into one short-lived agent or auxiliary utility process. The Pi worker injects the validated custom OpenAI-compatible model and credential resolver, streams bounded text deltas, enforces timeout/abort, and counts real fetch attempts for retry metadata without using Pi's file/session stores. The AI SDK worker owns sequential bounded `embedMany` batches and Cohere-compatible reranking with top-N/index/dimension validation, retry limits, disabled input/output telemetry, response IDs, and abort signals.

Project schema v9 adds STRICT `model_requests` provenance with provider/request SHA-256 fingerprints, timing, attempt/retry counts, token/cache/cost fields, item counts, response IDs, correlation IDs, and allowlisted safe errors. It never stores prompts, document bodies, responses, credentials, or vectors. Utility diagnostics retain only a generic operation message, HTTP status, and stack frames, so provider bodies cannot enter ordinary logs. Contract tests cover Pi streaming plus 429 retry, AI SDK batching/retry/rerank, wrong dimensions, utility abort, 401/429/503 classification, terminal-state arbitration, safeStorage serialization, and content/credential exclusion. Verification passes Biome on 198 files with only the pre-existing generated shadcn sidebar cookie warning, Node/web TypeScript, Electron-hosted Vitest (51 files and 241 tests), production build with both utility entrypoints, all 8 Playwright Electron E2E tests, and `git diff --check`.

## Audit remediation

The 2026-07-16 completion audit reopened this Phase. These items are required before the affected Checkpoints can return to completed and verified:

- [x] Make batch import startup non-blocking from the renderer perspective so newly created `importing` records, byte progress, and cancellation remain reachable while copies are active.
- [x] Add Electron E2E coverage for long-copy progress, cancellation, retry, project close, delete, open, and reveal behavior.
- [x] Log every original import or cleanup error as top-level `err` before another cleanup/database failure can replace or hide it, and verify parent-directory durability after publication.
- [x] Align the import capability set and MinerU `supportedFormats`, including an explicit TIFF decision, and enforce the selected format before creating durable parse work.
- [x] Add a capability-registry test proving every importable format is either accepted by the selected parser or rejected with an explicit pre-job error.
- [x] Reject duplicate rerank document indices at the utility response/schema boundary rather than relying on downstream fallback validation.
- [x] Expand real worker/provider-protocol tests for authentication failure, retryable server failure, timeout, abort, malformed response, and terminal correlation; define recovery for model requests left `running` after process loss.

Remediation verification: IPC import handlers return immediately after durable `importing` rows are created, while the service retains cancellable operations and progress polling; publication fsyncs the containing directory and logs original copy, cleanup, and persistence failures. The import/parser capability test covers PDF, OOXML, common images, and TIFF; MinerU rejects unsupported extensions before parse-task creation. Rerank responses reject duplicate indices at the shared schema boundary, and startup recovery transitions model requests left `running` by a lost utility to a bounded aborted state. Existing import cancellation/ENOSPC/reopen E2E and Electron-hosted worker/provider tests pass.
