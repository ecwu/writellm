# Planning Decision Checklist: PDF 知识库摄取与索引

Purpose: record design completeness and acceptance gates; checked items are designed, not implementation-complete.
Feature: [spec.md](../spec.md)  
Plan: [plan.md](../plan.md)

- [x] CHK001 FR-001–FR-019 and SC-001–SC-009 map to the Phase 1 model, contracts, quickstart and explicit out-of-scope boundaries.
- [x] CHK002 MinerU integration is frozen to Precision API v4 signed upload, async poll, `vlm` + OCR/table/formula and validated Markdown/JSON/media output.
- [x] CHK003 Durable schema v1, immutable source version, app-owned chunk identity, profile-bound vectors, queue leases/idempotency and stale-result fencing are defined.
- [x] CHK004 Named IPC, bounded DTO/pagination/events, strict sender/current-session validation, stable errors and redaction are defined.
- [x] CHK005 Duplicate candidate lifecycle, retry preservation, partial availability, app-close resume, fail-closed reference guard and local deletion tombstone are defined.
- [x] CHK006 Storage/Git publication boundaries and canonical-versus-runtime artifact layout are defined against accepted ADR-001.
- [x] CHK007 SiliconFlow `BAAI/bge-m3` adapter, 1024-dimensional profile, bounded payloads, throttling and response validation are defined.
- [x] CHK008 Objective batch, benchmark, accessibility, limit/backoff and failure-boundary validation scenarios are defined.
- [x] CHK009 User-supplied third-party credentials constitute the user's choice to use those services; provider policy unknowns are explicitly not a product acceptance gate.
- [ ] CHK010 ADR-005 covering MinerU and SiliconFlow credentials, transport and data egress is accepted. **BLOCKER**
- [x] CHK011 Dependency 005 and local-model probes are removed; 006 owns narrow MinerU/SiliconFlow configuration and remote embedding.
- [ ] CHK012 Feature spec, plan and contracts are maintainer Accepted and `specs/README.md` is updated in the same change. **BLOCKER**

Until CHK010 and CHK012 are checked, tasks and implementation remain prohibited.
