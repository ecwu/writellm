# Implementation Plan: PDF 知识库摄取与索引

Branch: `006-source-library-processing`
Date: 2026-07-12  
Spec: [spec.md](./spec.md)  
Status: Draft — refreshed after clarification; maintainer acceptance pending

## Summary

为当前可移动项目提供批量 PDF 摄取：main 通过原生文件对话框接收本地 PDF，原子保存原件并以内容指纹去重；main-owned 持久调度器调用用户配置的 MinerU Precision API 完成 OCR/结构解析，验证并发布 Markdown、媒体和稳定内容块；再调用用户配置的硅基流动 Embeddings API，以固定 `BAAI/bge-m3` 为合格内容块生成持久 1024 维向量。资料在解析、索引、部分失败、重试和重启中保持可理解、可恢复，只有当前资料版本中结构有效且向量有效的块可供 007 消费。

本 feature 不实现搜索、排序、引用插入、AI 写作或替换资料。MinerU 与硅基流动 key 是 006 自有的 application-global secret/data-egress boundary；它们复用 ADR-004 的 fail-closed 安全模式但不扩写或依赖 005 的 provider contract。用户自行取得、配置并选择使用第三方 API；第三方保留、驻留和训练政策不作为产品验收门禁。实现前必须接受 ADR-005。

## Current baseline

- 001、002、003、004、011 已实现；ADR-001/002/003 已接受。006 的硬依赖为 001、002、011；005 不再是硬依赖。
- Project main 已有 active `{ projectId, projectRoot, sessionId }`、串行写队列、原子 JSON、pending recovery 与 isomorphic-git adapter；006 必须复用/抽取这些边界，而不是建立第二套项目 authority。
- Preload 按 namespace 显式暴露 named methods；renderer 保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- 当前没有持久后台 job engine、006-owned MinerU/硅基流动 credential 或 source-library implementation。
- 旧 006 design artifacts 只覆盖 FR-001–FR-010 且仍研究本地 PDF parser，已由本轮 Phase 0/1 artifacts 替换。

## Technical Context

**Language/Version**: TypeScript 7.0.2, React 19.2.7, Electron 43.1.0, Bun 1.3.14.

**Primary Dependencies**: existing Vite/Electron/React stack and `isomorphic-git`; no local model runtime or native vector dependency. Main uses narrow HTTP adapters for MinerU Precision API v4 and SiliconFlow `POST /v1/embeddings` with fixed model `BAAI/bge-m3`.

**External Integration**: MinerU Precision Extract API v4 signed local upload, async polling, result ZIP. `vlm`, OCR, tables and formulas enabled. Official public pages disagree on some limits, so v1 enforces conservative 200 MB/200 pages and one local source per durable app job. Full PDFs and derived results leave the device.

**Storage**: ADR-001 portable project: canonical PDF/Markdown/validated block/media/vector artifacts under `sources/`; churn-heavy queue leases/downloads/temp extraction under ignored `runtime/`; multi-file publication through `runtime/pending` and structured Git `processing` commits. Dedicated encrypted MinerU credential under application `userData`, never project/Git.

**Processing**: main owns import, session fencing, job repository/scheduler, both third-party network adapters and publication. Default parse concurrency is 1/project; embedding requests use bounded batches with at most 2 active requests/project, persisted provider-aware throttling, exponential backoff with jitter and six automatic attempts.

**Testing**: Bun domain/contract/integration tests; deterministic MinerU/SiliconFlow fakes; malicious ZIP and PDF fixtures; compiled Electron runtime covering IPC, filesystem/Git recovery, network failure and restart; optional user-credentialed third-party smoke outside default CI.

**Target Platform**: single-author Electron desktop, macOS/Windows/Linux, one active project/window; background means non-blocking while app runs and resume after reopen, not an OS daemon after application exit.

**Performance Goals**: acknowledge 100 selections within 10 seconds before full hash/copy/upload; do not block editor interaction; index at least 95% of 500 eligible benchmark blocks while isolating permanent failures. No invented MinerU completion SLA.

**Constraints**: named typed IPC only; main validates all renderer and external data; no generic file/job API; no secrets/paths/raw external errors; exact version/profile checks prevent late results; referenced or unknown-reference sources cannot be deleted; app shutdown resumes later rather than promising continued processing.

## Constitution Check — pre-research gate

| Principle | Status | Evidence / gate |
|---|---|---|
| I. Secure Desktop Boundary | PASS WITH DESIGN | Main owns dialogs, files, both credentials, network, scheduler and publication. Renderer receives safe DTOs/media protocol identities. MinerU PDF egress and SiliconFlow block-text egress are isolated in ADR-005. |
| II. Typed, Minimal IPC | PASS WITH DESIGN | [contract.md](./contracts/contract.md) defines six user-facing methods and one fixed receive-only event surface; automatic jobs are not exposed as generic controls. |
| III. Specification-Driven, Minimal Evolution | PENDING ACCEPTANCE | Spec/plan and ADR-005 require maintainer acceptance before tasks. No Constitution exception is required. |
| IV. Verification at the Failure Boundary | PASS WITH DESIGN | [quickstart.md](./quickstart.md) covers real Electron, filesystem/Git, both external services, archive validation, restart, leak and accessibility boundaries. |

**Gate conclusion**: Phase 0/1 design work is allowed. Implementation is blocked. There is no Constitution exception.

## Phase 0 research decisions

[research.md](./research.md) records the complete rationale and alternatives. The frozen proposed direction is:

1. MinerU Precision API v4, signed upload, `vlm` + OCR/table/formula, async poll and validated result archive; lightweight/local parser alternatives rejected.
2. Dedicated safeStorage-protected MinerU and SiliconFlow credentials; feature 005’s generation credential is not reused.
3. Untrusted archive normalization into app-owned version/chunk/media identities; remote ids/schema never become canonical authority.
4. SiliconFlow `BAAI/bge-m3` dense embeddings with a fixed 1024-dimensional profile and bounded main-owned adapter.
5. Main-owned JSONL job ledger, leases, idempotency, bounded concurrency/backoff and session/version fencing; no SQLite or renderer queue.
6. Canonical artifacts/vectors tracked in portable project, intermediates ignored; processing commits occur only at user-value publication boundaries.
7. Six source-library IPC methods, replayable/gap-recoverable events, a narrow 006→007 reader, and fail-closed citation reference guard.

**Third-party policy decision**: MinerU and SiliconFlow credentials are supplied by the user. Configuring and using them is the user's choice to use those services; the product protects credentials and limits payloads but does not verify or promise either provider's retention, deletion, residency, subprocessors or training policy. Those unknowns do not block acceptance.

## Project Structure

### Documentation

```text
specs/006-source-library-processing/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/contract.md
└── checklists/
    ├── requirements.md
    └── plan-decisions.md
```

### Planned source delta

```text
src/
├── main/
│   ├── sources/
│   │   ├── source-repository.ts
│   │   ├── import-service.ts
│   │   ├── artifact-normalizer.ts
│   │   ├── job-repository.ts
│   │   ├── scheduler.ts
│   │   ├── mineru-adapter.ts
│   │   ├── index-repository.ts
│   │   ├── reference-reader.ts
│   │   └── handlers.ts
│   ├── credentials/mineru-credentials.ts
│   ├── credentials/siliconflow-credentials.ts
│   └── project/project-transaction.ts
├── preload/preload.cts
├── shared/sources.ts
└── renderer/features/sources/
    ├── SourceLibrary.tsx
    ├── SourceDetail.tsx
    ├── source-state.ts
    └── source-library.css
test/
├── fixtures/sources/
├── unit/sources/
├── contract/sources/
├── integration/sources/
└── runtime/sources/
```

**Structure decision**: retain the existing Electron layers. Project paths, credentials, network, queue and vectors remain main-owned; shared holds exact DTO/domain contracts; renderer composes 011 primitives. Do not copy legacy v1 code, IPC, persistence, UI, tests or dependencies.

## Phase 1 design

### Data and lifecycle

[data-model.md](./data-model.md) freezes schema-v1 `SourceCatalog`, `Source`, immutable `SourceVersion`, `ContentBlock`, `MediaAsset`, `IndexProfile`, `EmbeddingRecord`, and `ProcessingJob`, plus storage layout, identities, eligibility and transitions.

- Import acknowledgement precedes heavy work. A same-name/size item stays a provisional candidate until SHA-256; exact duplicate pending data is removed and never becomes a Source/job.
- Retry operates on the immutable source version and preserves valid artifacts. A new parsing/index profile atomically publishes only after full validation.
- Source availability is derived: `available` when all eligible blocks have current valid vectors; `partial` when some are valid and others failed/ineligible; failure cannot erase valid prior output.
- Closing the app aborts active network work safely. Expired durable leases resume when the same project is reopened; jobs never continue in a separate OS daemon.
- Delete checks the shared reference reader. `unknown` fails closed; revision-bound confirmation supersedes jobs and late results cannot resurrect data.

### Interfaces

[contracts/contract.md](./contracts/contract.md) freezes:

- Renderer/preload six-method source contract plus a separate seven-method fixed service-credential namespace, bounded DTOs, stable errors and replay recovery.
- Main-only MinerU adapter and strict archive normalization boundary.
- Main-only SiliconFlow embedding adapter, bounded request/response validation and stable errors.
- Main-domain `SourceIndexReader` consumed by 007.
- `SourceReferenceReader` extended by 007 citation schemas; failure/unknown prevents deletion.

### Transactions and Git

1. Extract reusable ADR-001 `ProjectTransaction` from current feature-specific repositories: serialized per-project queue, pending manifest, atomic replace, Git commit, recovery outcome.
2. Extend Git adapter with typed structured metadata so 006 can create `Actor: system`, `Event: processing`, `Content-Change: false` commits instead of the current chapter-oriented hard-coded trailers.
3. Publish boundaries: accepted import/original; validated parse manifest; bounded index terminal/partial checkpoint; retry outcome; removal. Heartbeats/leases/attempt scheduling do not commit.
4. Canonical vectors remain project-tracked because FR-010/007 require portable persistent readiness; temporary downloads, leases, model cache and staging remain ignored.

### Scheduling and failure semantics

- One parse job per source version; one embedding job per eligible chunk/profile. Idempotency keys and CAS prevent duplicates.
- Remote `pending/running/done/failed` is observation only. App job state is authoritative and checks project session/source version/profile before every write.
- Retryable: network/timeout/429/selected 5xx/service processing errors; use `Retry-After` or persisted full-jitter backoff. Auth/input/size/page/corrupt/malformed archive are terminal or user-action failures.
- Local removal is a tombstone. Public MinerU docs do not support promising remote cancellation/deletion.
- SiliconFlow timeout, throttling, malformed vectors or wrong response indices fail only affected jobs; main validates count, identity, 1024 dimensions and finite values before persistence.

## Verification Matrix

| Failure boundary | Required evidence |
|---|---|
| Dialog/import/storage | 100-item bounded acknowledgement; unreadable/mixed batch; provisional duplicate cleanup; atomic copy/hash; no wrong-project write. |
| Renderer/preload/main | Exact namespace/methods/event channel; strict inputs/sender/session; no path/PDF/vector/secret/remote id; gap resync. |
| MinerU transport | Signed upload/poll/download fakes; conservative limits; 429/backoff/auth/quota/malformed; egress disclosure and sentinel redaction. |
| Archive normalization | Traversal/symlink/zip-bomb/schema/id/order/media attacks rejected; valid portions and app identities deterministic. |
| SiliconFlow embedding | Fixed `BAAI/bge-m3` profile, bounded batches, finite 1024-d output; auth/429/timeout/NaN/wrong index/dimension isolated and redacted. |
| Durable queue/restart | Lease expiry, attempt cap, idempotency, completed-result reuse, same project/version fencing, shutdown/reopen recovery. |
| Project transaction/Git | Pending/rename/commit/recovery failures do not report success; processing trailers; bounded commits; portable canonical data. |
| Retry/removal/reference | Valid results preserved; reference and unknown block deletion; confirmation CAS; late results cannot resurrect. |
| UI/accessibility | Stage/partial/searchability understandable without color; keyboard/focus/live-region; themes, reduced motion, 960×640, 200%. |

## Constitution Check — Phase 1 design re-check

| Principle | Status | Design evidence / remaining gate |
|---|---|---|
| I. Secure Desktop Boundary | PASS IN DESIGN, ACCEPTANCE PENDING | Files/network/credentials/scheduler are main-owned; safe media protocol and strict normalization prevent path/active-content exposure. ADR-005 records PDF and block-text egress. |
| II. Typed, Minimal IPC | PASS IN DESIGN | Six user operations plus one fixed event receiver; no start-job, generic IPC, arbitrary path/media or internal adapter exposure. |
| III. Specification-Driven, Minimal Evolution | PENDING ACCEPTANCE | Clarifications are resolved; spec, plan, contracts and ADR-005 require one maintainer acceptance decision. |
| IV. Verification at the Failure Boundary | PASS IN DESIGN | Quickstart maps FR-001–FR-019 and SC-001–SC-009 to fake adapters, malicious fixtures, storage/Git faults and compiled Electron runtime. |

**Post-design implementation gate: PENDING ACCEPTANCE.** Do not generate `tasks.md` or product code until the 006 spec, plan, contracts and ADR-005 are reviewed and marked Accepted, with registry statuses updated in the same change. All prior service-policy, 005 dependency and local-model probe blockers are resolved by the recorded clarifications.

## Complexity Tracking

No Constitution exception is requested. The persistent scheduler, two narrow external adapters, immutable version/profile fencing, archive validator and reference guard are directly required by FR-003–FR-021 and the security baseline. SQLite, OS background daemon, local embedding runtime, ANN database, generic job API, remote sync, replacement/version UI, and a bundled local MinerU/Python runtime are explicitly excluded from v1.

## Implementation phases after gate acceptance

1. **Foundation and ADR**: accept ADR-005; add protected 006 credential storage; extract project transaction metadata support.
2. **Domain/storage/import**: schemas, catalog/version repository, native batch dialog, pending copy/hash/duplicate lifecycle, Git publication.
3. **MinerU parsing**: credential availability, adapter, scheduler/leases/backoff, malicious archive validation, atomic normalized publication.
4. **Remote indexing**: SiliconFlow adapter, fixed `BAAI/bge-m3` profile, block jobs/vector persistence, eligibility and partial state.
5. **IPC/UI**: six-method namespace, safe media protocol, replayable events, source list/detail/preview/retry/remove using 011 primitives.
6. **Consumer/reference contracts**: 007 reader and fail-closed chapter citation guard.
7. **Failure-boundary validation**: deterministic, malicious, restart, Git/storage, compiled Electron, performance and accessibility scenarios in quickstart.
