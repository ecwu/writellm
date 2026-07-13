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

### Accepted PDF.js candidate review (2026-07-13)

- `pdfjs-dist` is exactly pinned at `6.1.200` in `package.json` and `bun.lock` with
  integrity metadata; no CDN or runtime registry dependency is used.
- The installed package declares Apache-2.0 and includes its license. Its Node engine
  floor is `>=22.13.0 || >=24`; Electron 43 ships Node 24.17.0, so the target runtime
  satisfies the package floor. The renderer uses the browser display build, not the
  Node canvas path or optional native canvas dependency.
- A disposable Vite 8 production probe successfully emitted a local display bundle
  and separate local `pdf.worker` asset from `pdfjs-dist/build/pdf.mjs` and
  `pdfjs-dist/build/pdf.worker.mjs?url`; the normal application production build also
  passed after locking the dependency.
- Sandbox/CSP/offline fetch, accessible canvas/text-layer behavior, cancellation,
  fixed-route ranges, and the 200 MB boundary remain explicit implementation
  failure-boundary tests; candidate acceptance does not claim those unimplemented
  product paths already work.

**Decision**: Accept exact `pdfjs-dist` 6.1.200 for the planned display-only renderer
boundary. Any version change or use of its full viewer/editor/Node canvas surfaces
requires a new dependency and capability review.

## Settings composition

**Decision**: Open Settings as a category-external application-level area. Compose the existing 005 provider panel with a new renderer form for 006 MinerU/SiliconFlow service APIs, while keeping each owner’s revision, secret, validation, error, and save semantics separate. Record category/item/focus before opening and restore a still-valid target on close.

**Rationale**: Both accepted namespaces already expose all required fixed methods and redacted summaries. Only information architecture and the missing source-service form are needed.

**Alternatives considered**: A generic settings bridge, combined secret repository, or project settings would violate ADR-004/005 and confuse global ownership. A modal Dialog is unsuitable for a long 200%-zoom settings workspace.

## Visual structure from the reference

**Decision**: Treat the official [shadcn/ui `sidebar-09`](https://ui.shadcn.com/blocks/sidebar#sidebar-09) registry source as the named composition reference and the official Base UI **Lyra** registry as the component/style source. Use Neutral tokens, Inter-first typography, Lucide icons, radius none, 1 px boundaries, compact text, a 64 px rail, and a flexible main canvas. Retain 44 px pointer targets as the accepted desktop accessibility constraint.

**Rationale**: The maintainer supplied the Lyra preset as the exact visual target. The block confirms the nested-sidebar topology, while the registry provides reviewed source-owned primitives instead of local approximations.

**Alternatives considered**: Pixel-copying the black palette breaks themes. Three equal columns weaken hierarchy. Installing the sample without product adaptation imports mail/account behavior and incompatible interaction defaults.

## Official shadcn source adoption

**Decision**: Compose the reviewed `sidebar-09` topology from source-owned shadcn Base UI Lyra primitives. Matching controls use the official registry structure and classes, adapted only for Lucide icon substitution, application state callbacks, focus-return targets, and the accepted 44 px pointer target. The launch project picker uses the same primitives and tokens.

**Reviewed source snapshot (2026-07-13)**:

- [`sidebar-09` registry JSON](https://ui.shadcn.com/r/styles/new-york-v4/sidebar-09.json): SHA-256 `e552d5b8df3f83ade04600b9b71b8620f5fdfd85182e84fc54628e3a73e0e4f8`.
- [`sidebar` primitive registry JSON](https://ui.shadcn.com/r/styles/new-york-v4/sidebar.json): SHA-256 `a58ce44fe368b62399bf501ea1dfb2a3ba886a11decc01585875508ae633c49f`.
- A changed upstream fingerprint requires a fresh diff review; it does not silently supersede this plan.

**Rationale**: The demo block's cookie, global shortcut, Sheet and mail/account behavior remain unsuitable, but its components should not be re-created. Lyra already uses the accepted Base UI boundary and supplies the requested compact, square, neutral visual language.

**Alternatives considered**: Verbatim demo installation adds unrelated mail/account behavior and persistence. Locally restyling HTML or maintaining parallel custom primitives caused visual drift and was rejected by the maintainer.

## Source-to-product mapping

**Decision**: Map official block concepts explicitly: `AppSidebar` outer wrapper → `WorkspaceNavigationFrame`; first inner Sidebar → project/category rail; second inner Sidebar → Sections/Knowledge Base context list; `NavUser` footer → distinct Settings entry; `SidebarInset` → stable detail main; sticky Breadcrumb header → project/category/item location header; mail rows → owner-provided Section/source navigation rows. Exclude Search, Unreads, account/billing/logout, anchors/router URLs, and random/shuffled data.

**Rationale**: This gives implementation and review a line-by-line source relationship without importing unrelated product semantics or business state.

**Alternatives considered**: A loose “looks similar” instruction is not auditable. Copying mail semantics would create unsupported requirements.

## Responsive, keyboard, focus, and scroll behavior

**Decision**: Keep all three columns at 960×640/100%. Below roughly 720 CSS px, use a horizontal category command strip and show either list or detail with a visible Back action. Use native buttons and nav/region/main landmarks, normal Tab order, explicit focus migration before hiding a pane, and independent rail/list/main/Settings scroll regions. Do not use resolution media queries or remount owners at breakpoints.

**Rationale**: A 960 px physical window at 200% exposes roughly 480 CSS px, where three readable columns cannot coexist. Progressive disclosure preserves current category, list entry, main content, and return path without a new Sheet primitive.

**Alternatives considered**: Horizontal workspace scrolling loses location and focus. A drawer requires a new overlay/focus contract. Incomplete tablist/listbox semantics add keyboard complexity without benefit.

## UI foundation and icon use

**Decision**: Use shadcn Base UI Lyra components for every matching control and keep only product-level compositions such as `WorkspaceNavigationFrame`, category rail, context list, detail, Settings and launch-project workflow. Add reviewed 012 action placements for Sections, Knowledge Base, Settings, and sidebar toggle; do not add Radix or a second primitive stack.

**Rationale**: ADR-003 requires composition before extending shared primitives. The new navigation does not demonstrate a missing base control.

**Alternatives considered**: A second sidebar/navigation kit or feature-owned color/icon system violates the accepted foundation. Roving focus may be proposed later only with a shared behavior contract and runtime evidence.

## ADR assessment

**Decision**: No new independent ADR is required. Pure navigation is covered by ADR-003 and existing owner contracts. The PDF route must be accepted as an amendment to 006 plan/contract and ADR-005 before implementation.

**Rationale**: The amendment stays inside the existing source-content/security owner, adds no durable schema, generic capability, process, or new ownership boundary.

**Alternatives considered**: Calling the contract unchanged would hide a real renderer content boundary. A generic file-access ADR would authorize more capability than the feature needs.
