# Planning Decision Checklist: Workspace navigation redesign

**Purpose**: Record the review gates that must be accepted before tasks or implementation.

## Feature design acceptance

- [x] Accept `spec.md` without changing the current scope, including embedded original PDF preview.
- [x] Accept the renderer-only navigation session, owner-state boundaries, persistent project-category mounting, and category-external Settings lifecycle in `plan.md`.
- [x] Accept the official `sidebar-09` mapping: approximately 350 px collapsible composite sidebar containing a 64 px rail + context list, inset main, sticky trigger/separator/breadcrumb header, and progressive list/detail disclosure below roughly 720 CSS px.
- [x] Accept feature-local Rhea/Base UI adaptation instead of verbatim registry installation; exclude cookie persistence, global `⌘/Ctrl+B`, Radix/Sheet/Skeleton, undersized targets, and mail/account sample behavior.
- [x] Accept the accessibility contract: native navigation buttons/lists, textual current state, 44 px targets, explicit constrained Back path, hidden/inert focus handling, and independent named scrolling.

## Producer and security acceptance

- [ ] Amend and accept the 006 plan/contract with the current-version fields and fixed original-PDF route defined in `contracts/source-preview-amendment.md`.
- [ ] Amend and accept ADR-005 to cover local renderer preview of canonical PDF bytes through the fixed, active-session/current-version-fenced protocol.
- [ ] Accept `pdfjs-dist` 6.1.200 after license, exact lockfile, Vite, sandboxed Electron, CSP, worker, offline, and maximum-file verification.
- [x] Confirm no new independent ADR is required because the delta remains within the existing 006/ADR-005 source-content boundary; reopen ADR assessment if implementation expands capability.

## Foundation and regression acceptance

- [ ] Register and review 012 icon placements for Sections, Knowledge Base, and Settings; approve icon-only wide-rail admission and visible-label compact strip.
- [x] Confirm no new shared Radix Sidebar/Sheet/Tabs primitive or second UI/theme/icon system is needed; the reviewed block topology remains feature composition over existing primitives.
- [x] Confirm all 001–006, 011, and 012 owner/IPC/storage/security behavior remains authoritative and included in regression evidence.
- [x] Update `specs/README.md` with every Spec/Plan/ADR/tasks/implementation status change in the same change as its source of truth.

Until every applicable item is checked and the source documents say Accepted, `tasks.md` must remain missing and implementation must not begin.
