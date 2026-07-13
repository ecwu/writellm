# Phase 0 Research: Workspace navigation redesign

## Renderer navigation ownership

**Decision**: Replace the 002 hover/pinned tool-panel session with a renderer-only discriminated navigation session containing `activeCategory`, per-category last valid selection, compact list/detail pane, visited categories, and a Settings return point.

**Rationale**: 013 requires a stable master-detail workspace, while 002 panels are temporary siblings with hover preview and close semantics. The new state remains project-session-only and needs no router, global store, IPC, or persistence.

**Alternatives considered**: Reusing ToolPanel as-is would unmount or temporarily overlay core content and cannot express category selection restoration. A router/global store would add identity and lifecycle complexity without a URL or multi-window requirement.

## Owner state and persistent mounting

**Decision**: Navigation stores identities only. Writing orientation, chapter editor, source library, source detail, and settings owners keep their own DTOs, drafts, revisions, actions, and guards. A project category mounts on first visit and then remains mounted while inactive; Settings mounts only while open so write-only secret drafts follow owner close/cleanup rules.

**Rationale**: Current orientation and source components combine load, draft/event reconciliation, selection, and actions. Copying those into the shell would create a second truth. Keeping project owners mounted preserves BlockNote selection, pending save generation, source subscriptions, and scroll without persisting navigation state.

**Alternatives considered**: Unmount/rebuild loses internal editor and async context. Shell-owned merged DTOs duplicate owner policies. Keeping Settings hidden indefinitely would retain write-only secret input longer than the accepted settings lifecycle.

## Sections projection

**Decision**: Derive `SectionNavigationItem` directly from the current orientation owner draft in outline order. `chapterRef !== null` means a chapter exists; select it through the existing Chapter API. A missing chapter shows planning context and only calls `openForOutlineItem` from the explicit owner-provided Start writing action.

**Rationale**: 003 already owns title, summary, status, order, revision, and chapter link; 004 owns create/load/save. Showing the live owner draft keeps the list and editing view coherent without an extra persisted intention field.

**Alternatives considered**: A new list-sections IPC or navigation document duplicates canonical orientation. Showing only the saved baseline makes the navigation contradict unsaved edits.

## Knowledge Base projection and consistency

**Decision**: Reuse `listSources`, `getSource`, source events, retry, and remove. Render structured Markdown as bounded text in owner order; display status, progress, counts, retryability, and eligibility only from 006 read models. Fence detail/page results by source identity, request generation, and source version; event sequence gaps trigger authoritative resync.

**Rationale**: 006 already validates external artifacts, owns versions, and redacts paths/remote data. Generation/version fencing prevents late responses from replacing a newer selection or mixing pages from different versions.

**Alternatives considered**: Reading `full.md` or vectors in renderer violates the sandbox and duplicates eligibility rules. Rendering external Markdown as trusted HTML expands active-content risk without product value.

## Original PDF preview boundary

**Decision**: Keep FR-009 by amending the 006 owner contract: expose an app-owned current `sourceVersionId` plus preview availability, add a fixed current-version-fenced route to the existing `writellm-source` protocol, and render through bundled `pdfjs-dist` 6.1.200 display APIs. Main performs active-session/source/version checks, fixed-path resolution, signature/size/hash verification, and bounded single-range streaming. No path, generic file method, plugin, raw exception, or remote asset crosses the boundary.

**Rationale**: The original PDF is already canonical 006 data but is intentionally absent from its renderer DTO/preview protocol. Electron recommends controlled custom protocols over `file://`; PDF.js accepts a URL/typed data and supports range fetching, allowing a local sandboxed viewer without enabling Electron plugins. References: [Electron protocol](https://www.electronjs.org/docs/latest/api/protocol), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html), [pdfjs-dist](https://www.npmjs.com/package/pdfjs-dist).

**Alternatives considered**: `file://` or absolute path exposure violates the security baseline. Whole-PDF IPC/readFile duplicates up to 200 MB in memory. `<iframe>/<embed>` depends on plugin behavior and broader privileges. Treating Markdown/media as the original PDF does not satisfy the spec.

## Settings composition

**Decision**: Open Settings as a category-external application-level area. Compose the existing 005 provider panel with a new renderer form for 006 MinerU/SiliconFlow service APIs, while keeping each owner’s revision, secret, validation, error, and save semantics separate. Record category/item/focus before opening and restore a still-valid target on close.

**Rationale**: Both accepted namespaces already expose all required fixed methods and redacted summaries. Only information architecture and the missing source-service form are needed.

**Alternatives considered**: A generic settings bridge, combined secret repository, or project settings would violate ADR-004/005 and confuse global ownership. A modal Dialog is unsuitable for a long 200%-zoom settings workspace.

## Visual structure from the reference

**Decision**: Treat the official [shadcn/ui `sidebar-09`](https://ui.shadcn.com/blocks/sidebar#sidebar-09) registry source as the named composition reference. Adapt its outer collapsible wrapper containing a fixed icon sidebar and a flex-filling context sidebar, its CSS width variables, category-click expansion, inset main, sticky trigger/separator/breadcrumb header, and dense two-line list rows. Use a default composite width around 350 px (`clamp(21.875rem, 30vw, 25rem)`), a 64 px rail, and a flexible main canvas. Use semantic background/card/muted/border/ring tokens, restrained 1 px boundaries, 88–112 px information-dense list rows, 18–20 px icons inside 44 px targets, and distinct current/hover/focus states.

**Rationale**: The block confirms the screenshot is a deliberate nested-sidebar layout rather than an inferred three-column grid. Its 350 px provider width leaves about 610 px for main content at 960 px. Semantic Rhea tokens keep light, dark, and forced-color modes valid.

**Alternatives considered**: Pixel-copying the black palette breaks themes. Three equal columns weaken hierarchy. Installing the sample without product adaptation imports mail/account behavior and incompatible interaction defaults.

## Official sidebar source adaptation

**Decision**: Reimplement the reviewed `sidebar-09` composition in feature-owned workspace components using existing Rhea/Base UI primitives. Do not run the registry block as an overwrite and do not add the fetched New York/Radix `Sidebar` primitive verbatim.

**Reviewed source snapshot (2026-07-13)**:

- [`sidebar-09` registry JSON](https://ui.shadcn.com/r/styles/new-york-v4/sidebar-09.json): SHA-256 `e552d5b8df3f83ade04600b9b71b8620f5fdfd85182e84fc54628e3a73e0e4f8`.
- [`sidebar` primitive registry JSON](https://ui.shadcn.com/r/styles/new-york-v4/sidebar.json): SHA-256 `a58ce44fe368b62399bf501ea1dfb2a3ba886a11decc01585875508ae633c49f`.
- A changed upstream fingerprint requires a fresh diff review; it does not silently supersede this plan.

**Rationale**: The reviewed official source writes a seven-day `sidebar_state` cookie, registers global `⌘/Ctrl+B`, switches its subtree to a Sheet using `useIsMobile`, uses default 28–32 px controls, and imports Radix `Slot` plus Sheet/Skeleton dependencies. Those conflict with 013 session-only layout, BlockNote bold, persistent owner identity/responsive design, 012’s 44 px target, and ADR-003’s selected Base UI boundary. The useful portions are composition and styles, which shadcn’s source-owned model permits the project to adapt and audit.

**Alternatives considered**: Verbatim `shadcn add sidebar-09` risks overwriting owned components and adds unused mail search, Unreads switch, account/avatar/dropdown, random sample state, Radix, Sheet, Skeleton, and extra tokens. Adding a parallel Sidebar design system violates ADR-003. Ignoring the source would discard a precise, user-supplied implementation reference.

## Source-to-product mapping

**Decision**: Map official block concepts explicitly: `AppSidebar` outer wrapper → `WorkspaceNavigationFrame`; first inner Sidebar → project/category rail; second inner Sidebar → Sections/Knowledge Base context list; `NavUser` footer → distinct Settings entry; `SidebarInset` → stable detail main; sticky Breadcrumb header → project/category/item location header; mail rows → owner-provided Section/source navigation rows. Exclude Search, Unreads, account/billing/logout, anchors/router URLs, and random/shuffled data.

**Rationale**: This gives implementation and review a line-by-line source relationship without importing unrelated product semantics or business state.

**Alternatives considered**: A loose “looks similar” instruction is not auditable. Copying mail semantics would create unsupported requirements.

## Responsive, keyboard, focus, and scroll behavior

**Decision**: Keep all three columns at 960×640/100%. Below roughly 720 CSS px, use a horizontal category command strip and show either list or detail with a visible Back action. Use native buttons and nav/region/main landmarks, normal Tab order, explicit focus migration before hiding a pane, and independent rail/list/main/Settings scroll regions. Do not use resolution media queries or remount owners at breakpoints.

**Rationale**: A 960 px physical window at 200% exposes roughly 480 CSS px, where three readable columns cannot coexist. Progressive disclosure preserves current category, list entry, main content, and return path without a new Sheet primitive.

**Alternatives considered**: Horizontal workspace scrolling loses location and focus. A drawer requires a new overlay/focus contract. Incomplete tablist/listbox semantics add keyboard complexity without benefit.

## UI foundation and icon use

**Decision**: Reuse Button, Tooltip, ScrollArea, Separator, Badge, Card, EmptyState, StatusNotice/Alert, Dialog only for owner confirmations, Typeset, semantic tokens, and Lucide named imports. Keep `WorkspaceNavigationFrame`, category rail, context list, feature-local breadcrumb, detail, and Settings as feature compositions. Add reviewed 012 action placements for Sections, Knowledge Base, Settings, and sidebar toggle; do not add the Radix Sidebar/Sheet/Tabs primitives.

**Rationale**: ADR-003 requires composition before extending shared primitives. The new navigation does not demonstrate a missing base control.

**Alternatives considered**: A second sidebar/navigation kit or feature-owned color/icon system violates the accepted foundation. Roving focus may be proposed later only with a shared behavior contract and runtime evidence.

## ADR assessment

**Decision**: No new independent ADR is required. Pure navigation is covered by ADR-003 and existing owner contracts. The PDF route must be accepted as an amendment to 006 plan/contract and ADR-005 before implementation.

**Rationale**: The amendment stays inside the existing source-content/security owner, adds no durable schema, generic capability, process, or new ownership boundary.

**Alternatives considered**: Calling the contract unchanged would hide a real renderer content boundary. A generic file-access ADR would authorize more capability than the feature needs.
