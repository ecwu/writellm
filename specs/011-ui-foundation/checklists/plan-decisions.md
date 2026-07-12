# Planning Decisions Checklist: 共享 UI Foundation

**Purpose**: Record the maintainer's accepted cross-feature UI/appearance architecture before tasks or implementation.
**Created**: 2026-07-12
**Feature**: [../spec.md](../spec.md)
**Plan**: [../plan.md](../plan.md)
**ADR**: [../../../docs/adr/003-ui-foundation.md](../../../docs/adr/003-ui-foundation.md)

## Acceptance gate

- [x] CHK001 Accept `011-ui-foundation/spec.md` and its explicit non-regression boundary for 001.
- [x] CHK002 Accept `011-ui-foundation/plan.md`, including the order 001 → 011 → 002.
- [x] CHK003 Accept ADR-003 as the project-wide renderer UI/appearance architecture.
- [x] CHK004 Confirm no changes to 001 historical spec/plan/ADR/contract are required.
- [x] CHK005 Confirm 002 implementation waits for completed 011 and that 002's unaccepted design-system decision will be aligned later.

## Architecture choices

- [x] CHK006 Accept source-owned shadcn components under `src/renderer/components/ui` and reject a remote registry/separate package for now.
- [x] CHK007 Accept Tailwind CSS v4 + Vite plugin + semantic CSS variables as the renderer styling foundation.
- [x] CHK008 Accept Base UI as the primitive base and Rhea/neutral as the initial compact product style.
- [x] CHK009 Accept persisted System/Light/Dark through main-owned versioned storage and a separate two-method appearance bridge.
- [x] CHK010 Accept source-owned shadcn/typeset with editor/reading/compact presets and bounded font/rhythm preferences.
- [x] CHK011 Accept the initial 11 primitives and 4 patterns; all other components remain demand-driven.
- [x] CHK012 Accept Happy DOM + React Testing Library + user-event for DOM contracts and a dedicated compiled Electron UI fixture/runtime harness.

## Implementation safeguards

- [x] CHK013 Require exact dependency/CLI versions, license review and lockfile audit in future tasks before installation.
- [x] CHK014 Require component generation one logical group at a time with source/DOM/token/dependency diff review.
- [x] CHK015 Require all existing 001 checks and quickstart scenarios to pass with the six-method project bridge and project storage unchanged.
- [x] CHK016 Require System/Light/Dark first-paint/runtime/restart, corrupt storage, Typeset, forced-colors, reduced-motion, keyboard, 200%-zoom and 960×640 validation.
- [x] CHK017 Require audited system font IDs only; no enumeration, arbitrary font, upload or remote font in 011.
- [x] CHK018 Require any future primitive/pattern/variant to use the FoundationExtensionRequest evidence fields.

## Notes

- All decisions were accepted through three maintainer Q&A rounds on 2026-07-12.
- This completed checklist unblocks `speckit-tasks`; it does not install dependencies or modify product code by itself.
