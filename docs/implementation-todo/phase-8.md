# Phase 8: Rebuildable Index And Retrieval

## Phase overview

- Purpose: build deterministic project-local chunks, FTS/vector indexes, embedding generations, hybrid retrieval, reranking, citations, and search UI.
- Checkpoints: 17–19.
- Current status: Completed after audit remediation; Checkpoints 17–19 are complete and verified.
- Implementation state: indexing and retrieval functionality exists, with session-capability, compatibility, filtering, cancellation, and provenance remediation at the end of this file.

> **历史记录：benchmark 结论已降级。** The historical Checkpoint 18 record used an 8-dimensional vector at 100k chunks. CP19.5 renames that run to `sqlite-vec correctness smoke`; it cannot support a performance conclusion. New performance evidence must use representative text/metadata and the current embedding dimension at 10k/50k/100k, with build, incremental update/delete, cold-start, query p50/p95, RSS, file size, and rebuild measurements.

### Checkpoint 17: Project Index Database And Deterministic Chunk Pipeline

- [x] Add the project-local `index.sqlite` connection and manifest schema.
- [x] Launch one project-bound Index utility process with a narrow protocol and centralized logging port.
- [x] Define deterministic chunk IDs from parse revision, source block range, chunker version, and content hash.
- [x] Implement chunking from normalized blocks, not from unstructured Markdown alone.
- [x] Preserve heading path, page/bbox, source block IDs, table/formula/image references, and item metadata in `chunk_sources`.
- [x] Merge short adjacent text blocks and split only overlong text with deterministic overlap.
- [x] Implement idempotent add/update/delete jobs and generation build/switch.
- [x] Implement full deletion and rebuild from active parse revisions and normalized artifacts.
- [x] Handle Index utility crash, project close, and missing/corrupt `index.sqlite`.
- [x] Add golden chunk fixtures and equivalent-rebuild tests.

Acceptance criteria: deleting `index.sqlite` loses no authoritative knowledge; rebuild produces equivalent active chunks and provenance; a partial generation never becomes active.

Checkpoint 17 verification: the project-bound Index utility exclusively owns index schema v1 and all `index.sqlite` writes under WAL/NORMAL/foreign-key/busy-timeout pragmas, while Main retains project/session authority and exchanges only strict request-ID-correlated commands plus a centralized logging MessagePort. Deterministic chunking reads and hashes active normalized manifests/blocks, merges compatible short blocks, preserves atomic table/formula/list/image-caption units, splits only overlong Unicode text with fixed overlap, and records stable chunk IDs plus item, revision, heading, page/bbox, provider block, asset, and segment provenance. Durable item-upsert, item-delete, rebuild, build, and publish jobs rebuild the complete active source set; build commits only a non-active generation and publish rechecks the current source generation before one-transaction activation. Golden and database tests prove idempotent chunk sets, deletion/recreation equivalence, and invalid-candidate isolation. Packaged Electron E2E forces the Index utility to crash after a committed build, then deletes and corrupts `index.sqlite` across separate reopen cycles; scheduler retry and Main recovery recreate equivalent active generations without MinerU re-upload. Biome passes on 224 files with only the existing generated shadcn sidebar cookie warning; Node/web TypeScript, 58 Electron-hosted Vitest files with 267 tests, the production build including `index-worker.js`, all 9 Electron Playwright tests, and `git diff --check` pass.

### Checkpoint 18: FTS5, Embeddings, sqlite-vec, And Generation Compatibility

- [x] Implement FTS5 indexing behind a search repository.
- [x] Benchmark and test `unicode61` and `trigram` on representative Chinese and English fixtures.
- [x] Implement the approved dual-index or short-query fallback strategy.
- [x] Install sqlite-vec and implement the `VectorIndex` abstraction.
- [x] Load the packaged extension from a platform/architecture resource path.
- [x] Define embedding generation records with provider, model, revision, dimension, metric, normalization, chunker version, and content fingerprint.
- [x] Implement project-local embedding jobs using `EmbeddingGateway.embedBatch`.
- [x] Cache/reuse vectors only when content hash and the complete embedding contract match.
- [x] Reject incompatible dimensions, model revisions, normalization strategies, or chunker versions.
- [x] Implement vector upsert, deletion, query, generation switch, and rebuild.
- [x] Add development and packaged extension/vector smoke tests.
- [x] Benchmark at 100k representative chunks before considering another vector engine.

Acceptance criteria: Chinese and English fixtures have an explicit tested path; incompatible vectors cannot mix; a packaged app can build and query the project-local vector index.

Checkpoint 18 verification (historical; 8D benchmark conclusion superseded by CP19.5): index schema v2 keeps `unicode61` and trigram FTS repositories plus sqlite-vec tables behind narrow `FtsIndex` and `VectorIndex` interfaces in the project-bound Index utility. Representative bilingual fixtures prove dual-index retrieval and the mandatory short-query prefix fallback, while all FTS literals are quoted before MATCH. Immutable embedding generations record the provider, endpoint-sensitive contract hash, model/revision, dimension, metric, normalization, chunker version, and active source-set fingerprint. Durable project-local embedding jobs call the existing audited `EmbeddingGateway` in bounded batches, reuse cached vectors only by exact content and complete contract hash, resume safely, recheck the active source generation before atomic activation, and reject dimension, source, model/revision, normalization, or generation-ID collisions without replacing the old active vectors. The native preparation step copies sqlite-vec to platform/architecture resources and the unpacked macOS arm64 artifact loaded that exact resource through packaged `better-sqlite3`, inserted a vector, and returned an exact nearest-neighbor match. The 100,000-chunk development benchmark used an 8-dimensional vector table; that run is now correctness smoke evidence only and does not support a performance conclusion. Biome passes on 230 files with only the existing generated shadcn sidebar cookie warning; Node/web TypeScript, 59 Electron-hosted Vitest files with 269 tests, the production build, all 9 Electron Playwright tests, packaged vector smoke, and `git diff --check` pass.

### Checkpoint 19: Hybrid Retrieval, Reranking, Citations, And Search UI

- [x] Implement FTS and vector candidate retrieval with configurable limits.
- [x] Implement deterministic reciprocal-rank fusion.
- [x] Implement optional `RerankGateway` refinement over a bounded candidate set.
- [x] Return stable citation IDs, source item, parse revision, chunk, title, snippet, page, heading path, source block IDs, and asset references.
- [x] Implement filters by knowledge item, file type, parse revision, and optional page/heading fields.
- [x] Add a separate citation-expansion API rather than returning full source documents in initial search results.
- [x] Implement graceful behavior when rerank is unconfigured or unavailable.
- [x] Build knowledge search UI with score/debug information behind a developer option, source preview, page context, and image links.
- [x] Add ranking fixtures, deletion/update tests, query-embedding compatibility tests, rerank failure fallback tests, and bounded-result tests.

Acceptance criteria: retrieval is deterministic before rerank; rerank improves ordering without losing provenance; every result shown to the user or agent can be traced back to normalized source blocks and project files.

Checkpoint 19 verification: strict project-session search contracts cap FTS/vector candidates at 200, fusion at 200, initial results at 50, and citation expansion at 20. The project-bound Index utility exposes only active-generation retrieval state, quoted FTS candidates, compatible sqlite-vec candidates, filtered provenance hydration, and active citation expansion; initial hydration omits per-block detail while expansion returns the bounded block/page/bbox/provider/image provenance. File extension is part of deterministic index schema v3 metadata and source generation fingerprints. Main obtains a query embedding only when the configured provider's full endpoint-sensitive contract exactly matches the active embedding generation and rechecks that contract inside the audited model-execution credential boundary. Reciprocal-rank fusion uses fixed rank constant 60 with stable chunk-ID tie-breaking; optional bounded reranking preserves all provenance and falls back to RRF when configuration, credentials, provider execution, or output correlation is unavailable. Stable citation IDs resolve only within the active generation, so deleted and superseded chunks cannot be expanded. Filters cover knowledge item, file type, parse revision, page range, and normalized heading text. The shadcn knowledge UI exposes source/file/page/heading filters, short results, a developer-only score view, on-demand citation preview, page context, source block lineage, and content-addressed images. Ranking improvement, deterministic ties, query contract mismatch, rerank unconfigured/failure, strict bounds, combined filters, deletion, parse-revision update, IPC authorization/stale sessions, text citation, image citation, index crash, missing-index rebuild, and corrupt-index recovery pass. Biome passes on 236 files with only the existing generated shadcn sidebar cookie warning; Node/web TypeScript, 61 Electron-hosted Vitest files with 276 tests, the production build, all 9 Electron Playwright tests, final unpacked sqlite-vec smoke, and `git diff --check` pass.

## Audit remediation

The 2026-07-16 completion audit reopened this Phase. These items are required before the affected Checkpoints can return to completed and verified:

- [x] Carry and validate the active `projectSessionId` on every Index utility request and response, rejecting delayed messages after close or project switch.
- [x] Add stale-session protocol tests and logical-corruption verification for persisted source/chunk fingerprints, not only SQLite structural integrity.
- [x] Represent model revision independently from model ID in provider configuration and the complete embedding contract; reject and test revision drift without silently reusing vectors.
- [x] Define bounded cleanup for obsolete index/vector generations and embedding cache entries.
- [x] Add a reproducible package command and packaged workflow test that builds and queries an active project vector generation, not only a direct extension insert/search smoke.
- [x] Apply knowledge item, file type, parse revision, page, and heading filters during FTS/vector candidate generation before Top-K truncation; add recall regression fixtures.
- [x] Resolve citation assets by the citation's `parseRevisionId`, not the knowledge item's independently changing active parse revision, and test the parse/index activation race.
- [x] Track search and citation request abort controllers as project-scoped work and abort embedding/rerank utilities during close or switch.
- [x] Add packaged embedding/rerank hybrid-search E2E coverage, including provider failure fallback, stale sessions, filtered retrieval, and text/image citation provenance.

Remediation verification: Index utility messages now carry the project session capability in both directions and stale responses terminate the utility. Active source/chunk fingerprints are verified on open, obsolete generations/cache rows are bounded, and filters are applied inside FTS/vector candidate SQL before the final limit. Provider model revisions participate in embedding fingerprints and contract hashes. Citation assets use the citation parse revision, and search/citation abort controllers are registered with project lifetime cleanup. `smoke:packaged-hybrid` runs through Electron, builds an active project index plus embedding generation in a temporary SQLite database, and verifies FTS and sqlite-vec results with distance 0. Index, retrieval, provider, and Electron regression tests pass.
