# Phase 7: MinerU And Parsed Knowledge

## Phase overview

- Purpose: submit and resume MinerU parsing, publish safe raw revisions, normalize provider output, and expose parsed knowledge with provenance.
- Checkpoints: 15–16.
- Current status: Completed after audit remediation; Checkpoints 15–16 are complete and verified.
- Implementation state: functional MinerU workflow and parsed viewer exist, with task-state and activation-order remediation at the end of this file.

> **历史记录：部分设计已过时。** 本 Phase 的历史 verification 曾记录 encrypted signed-URL recovery capabilities。该设计已被 CP19.5 superseded：新实现不得持久化 signed/download URL、ciphertext 或 recovery capability；恢复必须通过 persisted `remote_task_id` 重新 polling 获取临时 URL。历史 verification 只证明当时的实现状态，不是当前目标。

### Checkpoint 15: Durable MinerU Submit, Poll, Download, And Publish

Implementation scope: use only the official MinerU API documentation to freeze the precise submit/status/result contract, then add a project-local parse-task/revision state machine, a credential-scoped MinerU utility adapter, and idempotent scheduler handlers. The implementation order is schema/contracts, submit persistence barrier, durable poll transitions, bounded download/archive validation, atomic raw-revision publication, restart/cancellation handling, then adversarial fixtures and review. Checkpoint 15 preserves raw provider output and a safe manifest but does not normalize blocks or build the parsed viewer owned by Checkpoint 16.

- [x] Define the MinerU adapter contract and capability limits independently of UI and job handlers.
- [x] Implement submit and persist `remote_task_id` immediately before further polling.
- [x] Implement durable polling without duplicate resubmission.
- [x] Persist remote state transitions and retry metadata.
- [x] Implement download to project temp storage with content-length and hash checks.
- [x] Validate archive format and reject path traversal, absolute entries, unsafe symlinks, excessive expanded size, excessive file count, and unexpected file types.
- [x] Extract only into a project temp directory.
- [x] Preserve the provider's raw output and response manifest.
- [x] Atomically publish a new parse revision under `knowledge/parsed/<item>/<revision>/`.
- [x] Handle cancellation according to provider capability without pretending a remote task was cancelled when only local polling stopped.
- [x] Resume after project reopen at submit, poll, download, extraction, and pre-publish boundaries.
- [x] Add fixtures and mock HTTP tests for all retry and restart boundaries.

Acceptance criteria: reopening the project resumes the same remote task; no unsafe or partial archive is published; each stage is idempotent and traceable to source hash and remote task ID.

Checkpoint 15 verification (historical; signed-URL portion superseded by CP19.5): project schema v10 persisted parse tasks and encrypted signed-URL recovery capabilities, raw parse revisions, and durable state-transition events without storing provider bodies or plaintext credentials/URLs. The current target removes the encrypted capability and keeps only the remote task/recovery metadata, then refreshes the URL by polling.

Raw ZIPs are manually extracted with lazy entry iteration into project temp storage, rejecting traversal, absolute/backslash paths, symlinks and non-regular files, encryption or unsupported compression, duplicate paths, unexpected extensions, expansion ratios, per-file/total byte limits, and file-count limits. Publication uses a provenance manifest, deterministic staging paths, and one atomic directory rename. Fresh-service restart tests cover the remote-ID barrier, upload/poll, durable download, extraction, and post-rename reconciliation while proving one allocation, one download, and one published revision. Review also exposed and fixed the Checkpoint 8 production `p-queue` native-ESM/default-export interop once real handlers activated the queue. Biome passes on 210 files with only the existing generated shadcn sidebar cookie warning; Node/web TypeScript, 55 Electron-hosted Vitest files with 252 tests, the production build including `mineru.js`, all 8 Electron Playwright tests, and `git diff --check` pass.

### Checkpoint 16: MinerU Normalization And Parsed Document Viewer

- [x] Define a versioned `NormalizedKnowledgeBlock` schema with stable local ID, ordinal, type, text/Markdown, heading path, page, bounding box, provider block ID, asset references, and content hash.
- [x] Normalize the active MinerU raw output into `blocks.jsonl`, `document.md`, `images/`, and `manifest.json` without discarding raw artifacts.
- [x] Preserve tables, formulas, captions, images, and reading-order provenance.
- [x] Record normalization version and allow re-normalization from raw output without re-upload.
- [x] Validate that every referenced image/asset exists and remains contained under the parse revision.
- [x] Define activation rules so a failed new parse revision does not replace the prior active revision.
- [x] Build a parsed document viewer with Markdown/content view, page/source metadata, image display, parse status, and raw-result diagnostics.
- [x] Add tests using representative PDF, DOCX, PPTX, scanned image, table, formula, multi-column, and malformed provider fixtures.

Acceptance criteria: the UI can inspect normalized content and images with provenance; changing the normalizer does not require re-upload; an invalid revision never becomes active.

Checkpoint 16 verification: project schema v11 records immutable versioned normalization runs and one transactionally selected active parse revision per knowledge item. The official MinerU `content_list.json` reading order and page/bbox/type fields are converted by the credential-free Import/API utility into stable block, Markdown, and content-addressed image artifacts; Main independently validates the exact staging layout, schemas, ordinals, references, hashes, sizes, and image inventory before atomic rename and active-revision commit. Re-normalization reads the preserved raw revision without another upload, while malformed provider paths, incomplete utility output, and failed newer revisions leave the prior active revision untouched. Strict project-session IPC and the shadcn parsed-result viewer expose content/Markdown, image, source page/bbox/provider IDs, parse state, and raw-result provenance. Representative PDF, DOCX, PPTX, scanned OCR, multi-column, table, formula, image/caption, malicious asset, utility-output, restart-safe activation, and Electron UI fixtures pass. Biome passes on 217 files with only the existing generated shadcn sidebar cookie warning; Node/web TypeScript, 57 Electron-hosted Vitest files with 264 tests, the production build with utility normalization bundled into `mineru.js`, all 9 Electron Playwright tests, and `git diff --check` pass.

## Audit remediation

The 2026-07-16 completion audit reopened this Phase. These items are required before the affected Checkpoints can return to completed and verified:

- [x] Propagate permanent durable-job failure into a terminal `parse_tasks` state and allow an explicit retry to create or resume actionable work rather than returning a stranded non-terminal task.
- [x] Make cancellation win against every late poll/download transition, including remote failure responses, and add concurrency regression tests. Correction (2026-07-16 implementation audit): cancellation barrier checks are implemented after poll, remote-failure, completion, download-refresh, archive-persist, extraction, and publish commit; the dedicated cancellation-race concurrency regression test is still missing and is backfilled under Checkpoint 19.7.
- [x] Close or prove idempotent the crash window between remote allocation and `remote_task_id` persistence, and revalidate final redirected download URLs against the approved policy.
- [x] Add monotonic activation arbitration so an older parse revision or normalization run that completes late cannot replace a newer active revision.
- [x] Add monotonic activation arbitration so an older parse revision or normalization run that completes late cannot replace a newer active revision; invalid newer candidates leave the prior active revision intact. Correction (2026-07-16 implementation audit): the monotonic guard and invalid-candidate tests exist, but the reverse-completion-order and concurrent-normalization tests this item promised are still missing and are backfilled under Checkpoint 19.7.

Remediation verification: exhausted durable MinerU jobs now persist terminal parse-task failure with an explicit retry path; cancellation is checked after poll, remote-failure, completion, and publish/download barriers. Allocation carries the parse-task idempotency key, and the worker validates both the signed source URL and the final redirected URL. Normalization activation only replaces a newer active revision when the candidate is not older; invalid candidates leave the prior activation intact. MinerU workflow, request, normalization, and recovery tests pass.
