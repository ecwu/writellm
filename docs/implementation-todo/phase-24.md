# Phase 24: Agent Tool Layering And Demand Profiles

Status: Checkpoint 75 and its LM Studio union-schema compatibility maintenance are complete under
ADR 067.
Recorded: 2026-08-28

## Checkpoint 75

- [x] Accept Protocol v12 description layering, demand groups, exact active-envelope budgeting,
  and provider-neutral object-root schemas under ADR 067.
- [x] Add the bounded `activate_tool_groups` contract and preserve outer writing/Notebook profiles.
- [x] Enforce the active set in Worker and Main and carry it through continuation and overflow
  recovery.
- [x] Centralize shared guidance, shorten tool descriptions, and add envelope/schema guards.
- [x] Complete focused, static, Electron, and fresh real-Electron verification.

## Checkpoint 75 compatibility maintenance

- [x] Replace empty object-root union wrappers with projected root properties while retaining the
  original `allOf` branch constraints.
- [x] Add regression coverage for non-empty union roots and valid `read_section` and
  `generate_image` arguments.
- [x] Complete focused, static, Electron, and no-identity macOS package verification.

## Scope boundary

No UI mode, classifier model call, database migration, durable profile preference, provider fork,
new worker, generic permission surface, direct manuscript mutation, dependency, package/release,
commit, tag, push, hosted CI, signing, notarization, promotion, or publication is authorized.

## Local evidence

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-24.md#local-evidence).