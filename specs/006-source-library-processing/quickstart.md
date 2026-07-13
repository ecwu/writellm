# Quickstart: validate PDF knowledge ingestion and indexing

This is a validation guide, not implementation code. Real third-party calls remain opt-in and require user-supplied credentials.

## Prerequisites

- Accepted 006 spec, plan, and ADR-005; implemented dependencies 001, 002, and 011.
- Deterministic fake MinerU and SiliconFlow adapters enabled by the test harness.
- PDF fixtures: valid text, scanned OCR, tables/images, encrypted, corrupt, oversized metadata/archive, duplicate, and 500-block benchmark.

## Baseline commands

```sh
bun run typecheck
bun run test
bun run build
bun run test:smoke
```

## Scenario 1 — batch acknowledgement and duplicate handling

1. Open a temporary `.writellm` project and select 100 valid PDF fixtures.
2. Assert every item receives queued/rejected/possible-duplicate acknowledgement within 10 seconds without blocking editor interaction or waiting for full copy/hash.
3. Select a same-name/same-size different file and an exact-content duplicate.
4. Assert SHA-256 decides identity, the exact duplicate leaves no Source or index job, the different file is accepted, and candidate-targeted `removeSource` cancellation cleans pending bytes.

Evidence: FR-001–FR-003, FR-016; SC-001, SC-007.

## Scenario 2 — validated MinerU normalization

1. Make fake MinerU return Markdown, ordered content-list blocks, images/tables, OCR text, and bounded location metadata.
2. Assert canonical preview order, stable app-owned chunk ids, valid media relationships, and identity lookup after restart.
3. Repeat with traversal archive names, symlink, duplicate ordinals/ids, missing media, oversized expansion, malformed JSON, and late result for an old version.
4. Assert only consistent portions publish; invalid portions never become searchable and raw external data never reaches IPC/logs.

Evidence: FR-004–FR-007; SC-003, SC-004, SC-006.

## Scenario 3 — parallel remote indexing and partial availability

1. Parse a 500-eligible-block fixture and configure the deterministic SiliconFlow fake for success, delay, transient failure, permanent failure, wrong response index, non-1024 dimensions, and NaN.
2. Assert independent jobs run with configured concurrency, each valid result persists immediately, invalid vectors are rejected, and progress reflects indexed/eligible/failed counts.
3. Restart after a subset completes; assert completed profile/content hashes are not recomputed and only unfinished/retryable jobs resume.
4. Assert at least 95% complete in the benchmark without editor responsiveness regression and permanent failures produce `partial` rather than blocking valid blocks.

Evidence: FR-008–FR-014; SC-002, SC-005, SC-006.

## Scenario 4 — rate limits, retry, credentials, and egress

1. Inject MinerU and SiliconFlow 429 with/without `Retry-After`, timeout, offline, 5xx, auth rejection and quota deferral, plus terminal PDF rejection and corrupted MinerU result URL/archive.
2. Assert persisted backoff, six-attempt cap, no tight retry loop, accurate retryability, and restart recovery.
3. Install sentinel token/path/remote ids and inspect renderer DOM, preload DTOs, project Git, logs, diagnostics, and errors.
4. Assert no sentinel leaks, missing/locked credentials fail closed, only PDF payloads go to MinerU, only eligible block text goes to SiliconFlow, and failed requests never appear successful.

Evidence: FR-004, FR-012, FR-018; SC-004.

## Scenario 5 — retry, deletion, references, and late results

1. Retry parse/index after partial success; assert valid prior results remain available until replacements atomically publish.
2. Attempt removal with a known citation, with reference-reader `unknown`, and with zero citations.
3. Assert the first two fail closed; zero citations requires revision-bound confirmation then supersedes jobs and removes canonical content.
4. Deliver a late MinerU/vector result and assert tombstone/version fencing prevents resurrection.

Evidence: FR-015, FR-017; SC-007.

## Scenario 6 — real compiled Electron boundary

Run the packaged/compiled runtime harness through renderer → preload → main → external adapters → storage/Git:

- Verify exactly six source methods and one fixed receive-only event surface; no generic IPC/path/raw PDF/vector/secret.
- Close and reopen the app/project during upload polling and embedding; verify jobs resume only when the project is open and never write to a moved/wrong project session.
- Inject pending-write, rename, Git-init/commit, external request abort, and app-shutdown failures; verify recovery state rather than false success.
- Hash the project and inspect structured processing commits at import, parse publication, index terminal/partial publication, retry, and removal boundaries.

Evidence: FR-003, FR-010–FR-015, FR-018; SC-002, SC-004.

## Scenario 7 — UI and accessibility

At 960×640 and 200% text scale, System/Light/Dark, forced colors, reduced motion, keyboard-only, and screen-reader semantics:

- Reach import, list, detail/preview, retry, and remove confirmation.
- Distinguish queued/parsing/indexing/available/partial/failed without color alone.
- Recover focus after dialogs and announcements; ensure progress does not spam live regions.

Evidence: FR-013, FR-019; SC-008 (post-launch), SC-009.

## Pass condition

All applicable commands and scenarios pass with deterministic fakes. Real MinerU/SiliconFlow smoke uses user-supplied disposable fixtures and credentials only, never in default CI. Provider policy unknowns are accepted by the recorded product decision; contract drift, model removal or vector-profile mismatch returns the feature to design review.

## Deterministic validation record

Validated on 2026-07-13 with the repository-owned fake adapters and fixtures. The complete source matrix (`test/contract/sources`, `test/unit/sources`, `test/integration/sources`, and `test/runtime/sources`) passed with 51 tests and 268 assertions.

| Scenario | Executable evidence | Result |
| --- | --- | --- |
| 1 — batch and duplicates | `import-service`, `source-library`, and `import-runtime` tests | Pass |
| 2 — MinerU normalization | `mineru-adapter`, `artifact-normalizer`, `parse-pipeline`, `parse-publication`, and `media-protocol` tests | Pass |
| 3 — indexing and partial availability | `embedding-adapter`, `index-repository`, `indexing-pipeline`, and `index-progress` tests | Pass |
| 4 — rate limits, credentials, egress | `scheduler`, `service-credentials`, `source-redaction`, and service IPC tests | Pass |
| 5 — retry and deletion | `retry-source`, `remove-source`, `source-controls`, and `recovery-runtime` tests | Pass |
| 6 — compiled boundary and portability | `bundle-boundary`, `security-baseline`, `source-portability`, `import-runtime`, and `recovery-runtime` tests against a production build | Pass |
| 7 — UI and accessibility | `source-library`, `source-detail`, `source-controls`, and `accessibility-runtime` tests | Pass |

Fixture constraints: PDFs use minimal deterministic byte fixtures rather than copyrighted documents; archive fixtures use stored ZIP entries so malformed paths, symlinks, declared expansion, JSON, and media integrity can be controlled exactly; the benchmark uses 500 generated eligible blocks with deterministic 1024-dimensional vectors; accessibility media/viewport coverage is contract-level in CI, while the compiled Electron harness supplies the real renderer/preload/main boundary. Live provider calls remain intentionally excluded because they require user credentials and would make default validation non-deterministic.
