# Planning Decision Checklist: Workspace navigation redesign

**Purpose**: Record the review gates that must be accepted before tasks or implementation.

## Feature design acceptance

- [x] Accept `spec.md` without changing the current scope, including embedded original PDF preview.
- [x] Accept the renderer-only navigation session, owner-state boundaries, persistent project-category mounting, and category-external Settings lifecycle in `plan.md`.
- [x] Accept the official `sidebar-09` mapping: approximately 350 px collapsible composite sidebar containing a 64 px rail + context list, inset main, sticky trigger/separator/breadcrumb header, and progressive list/detail disclosure below roughly 720 CSS px.
- [x] Accept official source-owned Base UI Lyra primitives with Neutral, Inter, Lucide and radius none for workspace and launch; retain only 44px target/Electron state adaptations and exclude cookie persistence, global `⌘/Ctrl+B`, Radix/Sheet/Skeleton, and mail/account sample behavior.
- [x] Accept the accessibility contract: native navigation buttons/lists, textual current state, 44 px targets, explicit constrained Back path, hidden/inert focus handling, and independent named scrolling.

## Producer and security acceptance

- [x] Amend and accept the 006 plan/contract with the current-version fields and fixed original-PDF route defined in `contracts/source-preview-amendment.md`.
- [x] Amend and accept ADR-005 to cover local renderer preview of canonical PDF bytes through the fixed, active-session/current-version-fenced protocol.
- [x] Accept `pdfjs-dist` 6.1.200 after license, exact lockfile, Vite/worker and Electron-engine review; retain sandboxed Electron, CSP, offline and maximum-file behavior as mandatory implementation failure-boundary evidence.
- [x] Confirm no new independent ADR is required because the delta remains within the existing 006/ADR-005 source-content boundary; reopen ADR assessment if implementation expands capability.

## Foundation and regression acceptance

- [x] Register and review 012 icon placements for Sections, Knowledge Base, Settings, and the sidebar toggle; approve icon-only wide-rail admission and visible-label compact strip.
- [x] Confirm matching controls use shadcn components rather than local visual reimplementations; no Radix Sidebar/Sheet/Tabs or second UI/theme/icon system is introduced.
- [x] Confirm all 001–006, 011, and 012 owner/IPC/storage/security behavior remains authoritative and included in regression evidence.
- [x] Update `specs/README.md` with every Spec/Plan/ADR/tasks/implementation status change in the same change as its source of truth.

Until every applicable item is checked and the source documents say Accepted, `tasks.md` must remain missing and implementation must not begin.
