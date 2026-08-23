# Phase 13: Agent Review Experience

Status: Checkpoints 63–64 are complete.
Recorded: 2026-08-23

## Checkpoint 63: Agent Status Motion And Semantic Proposal Review

Decision: user-authorized implementation completed. No new ADR is required because the bounded
presentation projection cannot participate in proposal approval or mutation application.

### User outcome

- Agent work uses a compact, state-specific thinking indicator without turning the writing surface
  into an always-animated display.
- Brief, Outline, Writing Rules, section, and generated-image proposals render through dedicated,
  domain-readable review controls instead of forcing every change through a text diff.
- The ordinary timeline and Writing Task change set present the same proposal facts and retain the
  existing immutable review, refresh, conflict, batch, and continuation behavior.

### Scope

- [x] Add exact-pinned, audited Renderer-only motion dependencies and thin Agent wrappers with
  theme, reduced-motion, lifecycle, and accessibility behavior.
- [x] Add an optional bounded semantic presentation projection for Brief fields, Outline
  operations, and Writing Rules while preserving legacy proposal payload parsing.
- [x] Replace the generic Proposal diff call sites with one reusable full/compact dispatcher and
  dedicated Brief, Outline, Writing Rules, section, and generated-image views.
- [x] Add focused shared/Main/Renderer coverage and fresh affected Real-Electron coverage.
- [x] Pass static, Electron, complete E2E, responsive visual, reduced-motion, Impeccable, and diff
  gates and record exact local evidence.

### Acceptance gate

- Proposal mutation payloads remain the sole apply/refresh/conflict/Undo authority. Presentation is
  bounded, Renderer-safe, optional, and ignored by every mutation decision path.
- New Brief proposals show only changed named fields; Outline proposals show ordered
  create/update/move/delete operations with resolved context; Writing Rules show semantic rule
  changes; generated images show the candidate and insertion metadata; section text changes retain
  unified/split diff where it is meaningful.
- Historical proposals without semantic presentation use an explicit legacy diff fallback. The
  timeline and compact task change set reuse the same dispatcher.
- The 360–640 px Agent panel, light/dark themes, keyboard and screen-reader paths, hidden/offscreen
  behavior, and `prefers-reduced-motion` path remain usable.
- Focused tests, `pnpm check:fast`, `pnpm check:electron`, fresh complete `pnpm check:e2e`, bounded
  screenshot inspection, scoped Impeccable, and `git diff --check` pass. No package/release gate,
  hosted CI, commit, push, signing, notarization, promotion, or publication runs.

### Local evidence

- Exact-pinned `border-beam@1.3.0` and `thinking-orbs@0.2.0` passed local package-source review;
  both are Renderer-only, dependency-free, MIT packages with bounded animation lifecycles,
  offscreen handling, and reduced-motion behavior. `pnpm install --frozen-lockfile` passed.
- Focused shared/Main/Renderer coverage passed 4 files / 61 tests. The complete Electron-hosted
  gate passed 189 files / 1054 tests with three intentional benchmark skips, followed by the
  production build.
- The fresh complete Real-Electron gate passed 41/41 scenarios. It directly asserts the running
  thinking indicator, review attention wrapper, Brief presentation, Outline presentation, and
  retained section diff behavior.
- Full-width section review plus 640 px semantic Outline runtime screenshots were inspected.
  Scoped Impeccable detection returned no findings; `pnpm check:fast` and `git diff --check`
  passed.
- The complete E2E run exposed an existing mobile References selector race. The test now targets
  the mobile sidebar that actually contains Manuscript references and waits for its responsive
  transition; its focused rerun and the final full suite passed. Product behavior was unchanged.

### Explicit exclusions

No inline proposal editing, full Outline snapshot, generic JSON/schema diff framework, database
migration, new IPC channel, Agent tool or authority, direct manuscript write, provider/worker
change, package/release action, hosted CI, commit, push, signing, notarization, promotion, or
publication is authorized.

### Hands-on package addendum

The user separately authorized one local hands-on build after Checkpoint 63 completion. The
no-identity macOS arm64 package gate passed Electron 43.1.0 / ABI 148 preparation, arm64 native and
ASAR/resource inventory, 12/12 packaged smoke scenarios, 28/28 packaged E2E scenarios, and DMG/ZIP
structural inspection. It produced the no-Team-ID App, DMG, and ZIP under `dist/macos-arm64` from
the current dirty worktree. No candidate, commit, tag, push, hosted CI, Apple Developer ID signing,
notarization, release, promotion, or publication ran.

## Checkpoint 64: Dependency Security And Compatibility Refresh

Decision: user-authorized implementation under ADR 056. This checkpoint upgrades the current
fixed-stack dependency lines needed to remove production advisories and compatible maintenance
drift without taking the deferred Vite 8, TypeScript 7, Vitest 4, better-sqlite3 13, Pi 0.84,
Kysely 0.29, KaTeX 0.18, @shadcn/react 0.3, or thinking-orbs 0.3 migrations.

### Scope

- [x] Upgrade the approved Electron 43, BlockNote, PDF.js, Mermaid, Kysely, provider, Renderer,
  data, formatting, and test dependency lines while preserving exact-pin/caret policy.
- [x] Refresh vulnerable transitive packages only within their parent-declared compatible ranges
  and prove a reproducible frozen installation.
- [x] Characterize persisted BlockNote v1-v3 documents and custom image, math, Mermaid, nesting,
  stable-ID, and no-op serialization behavior across the upgrade.
- [x] Add focused malicious/legitimate PDF and Mermaid controls and recheck parameterized Kysely
  usage without adding a new application security mechanism.
- [x] Pass production and complete dependency audits plus focused, static, Electron, recovery,
  E2E, package, and diff gates and record exact local evidence.

### Acceptance gate

- `pnpm audit --prod` reports no advisories and the complete audit reports no high or critical
  advisory. Any remaining low/moderate build-only advisory must be proven absent from the package
  or unreachable and recorded rather than hidden through an incompatible override.
- Existing BlockNote documents load with stable block IDs, approved block kinds and properties,
  canonical content, and content hashes. No no-op editor round trip creates a semantic mutation,
  and BlockNote's new native Math/Diagram or collaboration features are not admitted.
- Electron custom protocols, PDF worker/resource loading, Renderer CSP, provider and Agent tool
  contracts, project version history, database migration/backup, native SQLite/sqlite-vec, all
  three worker roles, and packaged runtime smoke remain intact.
- `pnpm check:fast`, canonical Electron Vitest/build, recovery fixtures, fresh complete E2E,
  no-identity package gate, frozen install, audits, and `git diff --check` pass. No release gate,
  hosted CI, commit, push, signing, notarization, promotion, or publication runs.

### Local evidence

- The direct dependency lines named by ADR 056 were updated together. Same-major pnpm overrides
  refresh `fast-uri`, `brace-expansion`, `undici`, and `tar` only within parent-admitted ranges;
  `pnpm install --frozen-lockfile` passed against the resulting reproducible lockfile.
- The original production audit contained 19 advisories: seven high, eleven moderate, and one
  low. Final `pnpm audit --prod` and complete `pnpm audit` both reported zero advisories. Source
  inspection found no `Kysely<any>`, user-derived `sql.lit`, or dynamic JSON-path construction.
- Focused characterization passed 5 files / 58 tests for persisted BlockNote v1-v3 content,
  stable IDs, custom image/math/Mermaid/nested blocks, no-op canonical JSON and content hashes,
  malicious/legitimate Mermaid attributes, malformed PDF fail-closed cleanup, and Google provider
  contracts. The focused BlockNote Real-Electron control scenario also passed.
- `pnpm check:fast` passed. The canonical Electron-hosted gate passed 192 files / 1062 tests with
  three intentional benchmark skips, followed by the production build. All 25 recovery fixtures
  from 23 sources passed with manifest SHA-256
  `4b4d3e989fbedf3d8caff2f51c673bc0bce9fb42d572c1d2fb3f6064d00046d9`.
- The fresh complete Real-Electron suite passed 42/42 scenarios. It covers BlockNote 0.54 slash
  menu, formatting, Mermaid, keyboard, narrow-layout and stable replacement focus behavior in
  addition to provider/Agent, project history, PDF worker, custom protocol, and CSP regressions.
- The final no-identity macOS arm64 package gate passed Electron 43.4.1 / embedded Node 24.18.1 /
  ABI 148 preparation, Mach-O arm64 `better-sqlite3` 12.11.1 and `sqlite-vec` 0.1.9 inventory,
  53,145 ASAR entries, all 12 packaged runtime smoke scenarios, 29/29 packaged E2E scenarios, and
  DMG/ZIP structural inspection. The first package attempt had one Settings mouse-click
  acknowledgement timeout despite the dialog opening; a focused rerun passed, the unrelated
  Agent-context setup switched to the global keyboard Settings entry, and the complete final gate
  passed with no flaky, skipped, or failed scenario.
- Biome formatting/static checks and `git diff --check` passed. The scoped Impeccable hook's sole
  report was an exact `<img>` string inside a sanitizer test rather than rendered UI; that exact
  test-only false positive is suppressed with no product finding left open.

### Explicit exclusions

No BlockNote native Math/Diagram or collaboration feature, product capability, IPC, persistence
format, database migration, Agent-runtime migration, toolchain-major migration, candidate/release
action, hosted CI, commit, tag, push, Apple Developer ID signing, notarization, promotion, or
publication was introduced or run.

### Hands-on App addendum

The user separately authorized a local trial App build after Checkpoint 64 completion. The
unpacked-only no-identity macOS arm64 package gate rebuilt Electron 43.4.1 / ABI 148, verified the
Mach-O arm64 native modules and 53,145 ASAR entries, passed all 12 packaged runtime smoke and 29/29
packaged E2E scenarios with no flaky, skipped, or failed scenario, and produced
`dist/macos-arm64/mac-arm64/WriteLLM.app` from the current dirty worktree. The gate did not produce
a DMG or ZIP. No candidate, release gate, hosted CI, commit, tag, push, Apple Developer ID signing,
notarization, promotion, or publication ran.
