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

- Protocol v12 exposes nine core writing tools and seven disjoint demand groups whose merge covers
  the complete writing tool set. Notebook remains restricted to Knowledge search and citation
  reads, and both Worker and Main reject tools outside the current active set.
- Activation is isolated, bounded to one through three unique groups, monotonic within a run, reset
  for a new run, and capacity-checked before mutation. Run start, continuation, compaction, and
  overflow recovery use the exact active envelope and message budget.
- Every model-visible parameter schema has an object root with `properties`; union roots retain
  their original constraints through `allOf`. The strict OpenAI-compatible loopback Harness
  accepted the full request and streamed a response without a provider-specific branch.
- A real LM Studio run accepted the earlier empty root wrapper but emitted 370 `read_section({})`
  calls, each rejected by Worker preflight at `/`. Root unions now project every branch property,
  the intersection of required fields, and merged literal discriminators onto the model-visible
  object root while retaining the original union beneath `allOf`. Regression coverage verifies
  non-empty `read_section` and `generate_image` roots, valid variants, and rejection of `{}`.
- The compatibility maintenance passed 44 focused schema, Worker, session, and budget tests plus
  `pnpm check:fast`. `pnpm check:electron` passed 201 files / 1,160 tests with three intentional
  benchmark skips and completed the production build; the fresh `pnpm check:e2e` build passed all
  47/47 scenarios with no flaky, skipped, or failed scenario.
- The final no-identity `pnpm check:package` verified all 27 recovery cases from 25 sources,
  Electron 43.4.1 / ABI 148, arm64 native modules, 53,287 ASAR entries, all 12 packaged smoke
  scenarios, and 34/34 packaged E2E scenarios. It produced the trial App, DMG, and ZIP under
  `dist/macos-arm64`; release signing, notarization, and publication did not run.
- 153 focused shared-contract, Worker, Main, and provider tests plus the two-test prompt-budget
  baseline passed. `pnpm check:fast` passed.
- `pnpm check:electron` passed 201 files / 1,158 tests with three intentional benchmark skips and
  completed the production build. The final fresh `pnpm check:e2e` build passed all 47/47 scenarios
  with no flaky, skipped, or failed scenario.
- The separately authorized local `pnpm check:package` refreshed the intentionally changed Agent
  recovery-source digest, verified all 27 recovery cases from 25 sources, Electron 43.4.1 / ABI
  148, arm64 native modules, 53,287 ASAR entries, all 12 packaged smoke scenarios, and 34/34
  packaged E2E scenarios. It produced the no-Team-ID App, DMG, and ZIP from the current dirty
  worktree. `pnpm check:release`, Apple Developer ID signing, notarization, and publication did not
  run.
