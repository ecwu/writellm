# Phase 26: Agent request diagnostic traces

Status: Checkpoint 76.1 complete.

## Checkpoint 76.1

- [x] Add content-addressed project-local trace payloads, per-request state, ordered records, and
  reconstruction views with legacy-unavailable behavior.
- [x] Require a durable Main acknowledgement before every traced Agent provider attempt and retain
  physical retries, safe response metadata, structured responses, and timing.
- [x] Correlate invalid tool input, injected Writing Skills, compaction, titles, and Agent image
  generation without duplicating authoritative successful tool results.
- [x] Verify migrations, deduplication, reconstruction, fail-closed network ordering, privacy and
  capacity limits, recovery paths, and the required non-release gates.

## Local evidence

- ADR 069 and the architecture amendment make trace rows diagnostic evidence only. Migration 0040
  adds immutable SHA-256 payload objects, request state, ordered references, JSON1 reconstruction
  views, constraints, indexes, and explicit `legacy_unavailable` projection. The established
  forward-migration backup, integrity, failure recovery, clone, and snapshot paths continue to
  carry the project database and passed in the canonical and packaged suites.
- Worker/Main trace messages now carry correlation IDs explicitly and require Main's transactional
  ACK before the provider stream can start. Pi's transformed `onPayload` body is captured without
  request headers; physical retries, allowlisted response headers, structured assistant items,
  continuity values, tool calls, usage, TTFT, and total duration are retained. Serialization,
  size, or SQLite failures terminate before network dispatch with `trace_capture_failed` or
  `trace_payload_too_large`.
- Raw pre-validation tool names/arguments, immutable injected Skill entrypoint/reference content,
  compaction source and escaped prompt, session titles, and Agent image request/response metadata
  are correlated to the next request. Existing `agent_events` remain authoritative for successful
  tool results; image bytes remain assets. Notebook, embeddings, and reranking remain outside this
  checkpoint.
- The repository and migration tests cover semantic JSON reconstruction, legacy rows, ordered run
  timelines, duplicate objects, 8 MiB document and 32 MiB attempt rejection, and private-body log
  exclusion. A representative 12-request long-history/tool-schema sample measured 7,936,308 raw
  bytes versus 330,580 stored payload bytes, a 95.83% reduction; SQL reconstruction of all 12 took
  about 1.73 seconds on the local Electron runtime.
- `pnpm check:fast` passed. The canonical `pnpm test` gate passed 217 files with three skipped
  benchmark files and 1,204 tests with three skipped benchmark tests. `pnpm check:electron` passed
  the same suite plus the production build. `pnpm check:e2e` passed all 47 fresh scenarios without
  flakes, skips, or failures. `pnpm check:package` passed migration recovery fixtures, native/ASAR
  inventory, all 12 packaged smoke scenarios, the log privacy scan, and all 34 packaged Electron
  scenarios, then structurally verified the no-Team-ID DMG and ZIP. The release signing gate was
  intentionally not run.
- Candidate `v0.2026.8.47` local package evidence: release metadata advanced to `0.2026.8.47` and
  the complete no-Team-ID macOS arm64 gate reverified 31 recovery fixtures from 29 sources,
  Electron 43.4.1 / ABI 148 native resources, 53,288 ASAR entries, all 12 packaged smoke scenarios,
  and all 34 packaged E2E scenarios without flakes, skips, or failures. It produced the unpacked
  App, a 238,730,171-byte DMG
  (`1bec8665de8a6dba930da675de950a4fdbfe389fb289813cb1a1c68d507be1e9`), and a
  236,896,362-byte ZIP
  (`d6bc755e29934735b9a51f642dc49a7390f5d8fa6f0edd171b9d928aeede2081`). The evidence truthfully
  records the pre-tag source as dirty; the clean source commit, tag verification, and push remain
  pending. No Developer ID signing, notarization, release, promotion, or publication ran.
