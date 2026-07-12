# 003 Plan Decisions

- [x] Named three-method IPC namespace and discriminated results selected.
- [x] Main-owned handwritten runtime parser selected; no schema dependency.
- [x] Single canonical snapshot with Node atomic replacement selected.
- [x] Integer revision, session mutation idempotency and main-generated UUID selected.
- [x] Move buttons plus HTML drag enhancement share one reorder command.
- [x] Bun tests plus compiled Electron runtime validation selected.
- [x] Successful 003 content saves consume ADR-001 main-owned Git commits; history UI remains outside 003.
- [ ] Maintainer accepts 003 spec and plan.
- [ ] Maintainer accepts the durable orientation storage ADR/contract.
- [ ] Maintainer accepts the 003-defined extension of 002 project leave orchestration for dirty Save/Discard/Stay; no durable selection location is added.
- [x] 003 safely refuses linked-item deletion; 004 create/link and linked-delete transactions are a future extension and do not gate 003.

Unchecked items are implementation gates, not unresolved technical clarifications.
