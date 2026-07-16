# Phase 10: Export, Packaging, And Release Confidence

## Phase overview

- Purpose: deliver manuscript/project export, portable snapshots, native packaging, cross-platform recovery CI, and release gates.
- Checkpoints: 24–26.
- Current status: Not started.
- Implementation state: planned only; do not begin until the agent phase and prior release prerequisites pass.

### Checkpoint 24: Manuscript Export And Project Portability

- [ ] Implement whole-manuscript native JSON export with outline and section revision metadata.
- [ ] Implement deterministic whole-manuscript Markdown export from section headings and BlockNote bodies.
- [ ] Make the lossy nature of Markdown explicit where unsupported BlockNote structures exist.
- [ ] Export or copy manuscript assets using project-relative references.
- [ ] Finalize verified project snapshot/clone UI and conflict-safe destination handling.
- [ ] Validate a project copied or restored to Windows/macOS/Linux-compatible paths.
- [ ] Ensure opening a project with a missing index schedules rebuild rather than failing manuscript access.
- [ ] Add export fixtures and moved/restored project E2E tests.

Acceptance criteria: users can export the article and move or snapshot the complete project without hidden absolute-path dependencies; native content remains lossless and Markdown limitations are explicit.

### Checkpoint 25: Native Packaging

- [ ] Enable electron-builder native dependency rebuilding for Electron 43.
- [ ] Configure sequential rebuilding and ASAR unpack rules for better-sqlite3, sqlite-vec, and native resources.
- [ ] Audit pnpm build-script allowlists from the lockfile.
- [ ] Copy sqlite-vec binaries into platform/architecture resource directories.
- [ ] Keep Pino/thread-stream/transport assets available in packaged builds.
- [ ] Verify BlockNote, Pi, AI SDK provider lazy imports, utility entrypoints, and MessagePort protocols in packaged artifacts.
- [ ] Smoke-test installed or unpacked artifacts rather than source-mode paths.

Acceptance criteria: each target artifact creates and opens a project, persists BlockNote content, loads sqlite-vec, starts Pi and utility processes, and performs a local vector insert/search without source-tree dependencies.

### Checkpoint 26: Cross-Platform Recovery CI And Release Gate

- [ ] Add CI builds for Windows x64, macOS arm64, macOS x64, and Linux x64.
- [ ] Run Vitest and Playwright Electron E2E at appropriate layers.
- [ ] Test app/project migrations, backup/restore, project locking, stale sessions, moved project paths, BlockNote persistence/materialization repair, vector loading, Unicode paths, lease recovery, MinerU polling recovery, index rebuild, agent interruption, tool authorization, stale proposal rejection, and accepted mutation lineage.
- [ ] Test CSP, navigation restrictions, IPC sender rejection, and safeStorage backend reporting.
- [ ] Test centralized logging transport, cross-process aggregation, Error serialization, redaction, rotation/retention, and shutdown flush in packaged artifacts.
- [ ] Define artifact retention, migration-fixture retention, and release gating.

Acceptance criteria: all required target-platform jobs pass on real packaged artifacts before release.
