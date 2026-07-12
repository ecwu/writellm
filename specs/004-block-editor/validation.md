# Feature 004 implementation validation

## Dependency acceptance gate

- Bun: 1.3.14.
- Exact packages: `@blocknote/core`, `@blocknote/react`, and `@blocknote/ariakit` 0.51.4.
- License: all three package manifests declare MPL-2.0.
- Peer audit: Ariakit requires React/React DOM 18 or 19; the repository pins React/React DOM 19.2.7. Bun reported no unresolved peers.
- Exclusions: no `@blocknote/xl-*`, Mantine, remark, marked, markdown-it, or other Markdown parser was introduced.
- Install passed with the exact package versions.
- `bun run typecheck` passed after editor integration.
- `bun run build` passed (447 modules; BlockNote included in the compiled renderer).

Further runtime, journey, accessibility, failure-injection, and final release-gate evidence follows as checks complete.

## Scenario and failure-boundary evidence

- Create/open: unlinked outline creation persists revision 0 and the orientation link through one pending transaction; repeated mutation IDs return the same chapter. Recovery replays both retained snapshots before committing, preventing orphan/dangling success.
- Editing: the renderer uses a schema restricted to the accepted paragraph, heading, bullet/number/check list, table, code, quote, and image blocks. Adapter coverage includes create/edit/move/split/merge/delete and valid-empty normalization.
- Citations: complete split/merge mappings are preserved; cut, deleted, mismatched, ambiguous, and missing anchors receive stable `needs-review` reasons with no proximity rebinding.
- Saving: 100 successive save/reopen cycles passed. Stale saves return `REVISION_CONFLICT`; exact mutation retries recover an injected history failure; newer local generations remain dirty after older saves finish.
- Leave safety: chapter dirty state owns save/discard/cancel orchestration while a chapter is active and cannot be overwritten by the orientation panel.
- Markdown: paste conversion is previewed before insertion; export retains exact preview bytes, validates ownership/expiry, uses a main-owned dialog, and keeps cancellation/failure separate from canonical revision state.
- Security: 2 MiB, 10,000 block, depth 32, and 10,000 citation ceilings are frozen and tested. Plain-object/exact-property, identity, schema, unique block ID, block property, inline content, UTF-16 range, and quoted-text checks run in main.
- Accessibility/platform: keyboard save semantics, live status, modal focus patterns, responsive chrome, forced colors, reduced motion, and semantic theme integration are covered by integration/runtime assertions.
- Compiled runtime: the sandboxed preload executes with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`; the runtime gate observes an actual BlockNote `contenteditable` mount. This gate exposed and fixed sandbox-incompatible preload runtime imports.

## Final release gates

- `bun run typecheck`: PASS.
- `bun run test`: PASS — 123 tests, 0 failures, 656 assertions.
- `bun run build`: PASS — 448 modules transformed.
- `bun run test:smoke`: PASS — compiled bridge, startup, and single-instance lifecycle.
- `bun run test:ui-runtime`: PASS — secure chapter bridge inventory, actual BlockNote mount, and sandboxed startup.

Platform executed: macOS/Darwin. Windows/Linux behavior is covered through platform-neutral repository tests and explicit keyboard/responsive/forced-colors contracts; native execution on those platforms remains CI/release-matrix evidence rather than a claim from this machine.
