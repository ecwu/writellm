# Contract: Workspace category, list, detail, and Settings composition

**Status**: Accepted with 013 plan — maintainer accepted 2026-07-13.

## Ownership

- Workspace navigation owns category/item identity, focus/scroll restoration, responsive visibility, and Settings return context.
- 003 owns orientation data/drafts/order/save/delete and the orientation leave guard.
- 004 owns chapter creation/loading/editor state/save/conflicts/export and its leave guard.
- 006 owns sources, events, versions, previews, processing status, eligibility, retry/removal, and source service credentials.
- 005 owns generation provider settings and secret/validation rules.
- Navigation never calls a mutation as a side effect of category, item, Back, or Settings activation.

## Wide layout

```text
sidebar-09-inspired nested wrapper                  main inset
┌────────┬──────────────────────────┐┌───────────────────────────────┐
│ 64 px  │ context list            ││ sticky trigger + breadcrumb   │
│ rail   │ composite total ≈350 px │├───────────────────────────────┤
│        │                          ││ current item detail           │
└────────┴──────────────────────────┘└───────────────────────────────┘
status region
```

- Outer layout: `clamp(21.875rem, 30vw, 25rem) minmax(0, 1fr)`.
- Composite sidebar: `4rem minmax(0, 1fr)`, `overflow: hidden`, horizontal nested composition.
- At 960×640/100%, all three regions remain present and independently scrollable.
- Each grid child uses `min-width: 0` and `min-height: 0`.
- Surfaces use only 011 semantic tokens; the reference image is not a literal palette contract.
- Desktop collapse reduces the composite to the 64 px rail without unmounting the context owner. Category activation expands it. The sticky main trigger is always at least 44×44 CSS px and restores the list.
- Sidebar expanded/collapsed state is session-only; cookies, localStorage, files, and appearance preferences are prohibited.

## Reviewed shadcn block mapping

| Official `sidebar-09` source | WriteLLM 013 mapping |
|---|---|
| Outer `Sidebar collapsible="icon"` | `WorkspaceNavigationFrame` controlled by session `sidebarExpanded` |
| First nested non-collapsible Sidebar | 64 px project/category rail |
| Second nested non-collapsible Sidebar | current Sections/Knowledge Base context list |
| `SidebarInset` | stable main detail region |
| Sticky `SidebarTrigger + Separator + Breadcrumb` | 44 px toggle + project/category/item location header |
| `NavUser` footer | distinct application-level Settings entry |
| Mail rows | native-button owner navigation projections |
| Search/Unreads/account/random sample state | excluded; no accepted product requirement |

The official `components/ui/sidebar.tsx` is not copied verbatim: no cookie, global `⌘/Ctrl+B`, Radix `Slot`, Sheet/use-mobile subtree switch, Skeleton, or 28–32 px action target enters 013.

## Constrained layout

- Below approximately 720 CSS px, categories and Settings appear in a horizontal command strip.
- The content area shows either the current category list or its detail.
- Item activation moves focus to the detail Back action or heading before hiding the list.
- `Back to Sections` / `Back to Knowledge Base` restores the prior item focus; if invalid, use the list heading/first item.
- The project owner tree remains mounted; hidden regions are removed from Tab order and accessibility tree with controlled `hidden`/`inert` behavior.
- Breakpoints change CSS visibility/layout, not business owner identity. `(min-resolution)` and JS-remount breakpoints are prohibited.
- Unlike the stock Sidebar primitive, constrained mode does not move business-owner children into a Sheet; the progressive list/detail regions remain in the existing owner tree.

## Navigation semantics

- Category rail: `<nav aria-label="Workspace categories">` with native buttons.
- Sections and Knowledge Base have persistent accessible names; current category has `aria-pressed="true"` plus visible text in the adjacent heading and non-color styling.
- Settings is visually separated and never participates in the project-category pressed set.
- Context list is a named region/navigation with a semantic list. Each item is one full-width native button containing title, summary, and textual state.
- Current item uses one consistent `aria-current` contract plus non-color selected styling.
- Main detail is the single `<main>` for the active project item; Settings replaces the visible main landmark while open.
- The main sticky location header exposes project → category → item with semantic breadcrumb markup. It is feature-local until another accepted consumer proves a shared primitive need.
- Do not claim tablist/listbox roles unless a complete keyboard composite contract is separately accepted.

## Density and long content

- Category targets are at least 44×44 CSS px; icons are decorative 18–20 px Lucide SVGs.
- Normal list rows are approximately 88–112 px and include title, up to two visual summary lines, and textual status/chapter association.
- Visual truncation cannot remove the full accessible title/description. Similar names remain distinguishable by accessible content and owner metadata.
- Hover, current, and focus-visible are three distinct states. Selection never relies only on color/icon.
- Each detail view exposes at most one primary next action; destructive actions retain visible text.

## Mounting and state preservation

- Sections mounts with the project. Knowledge Base mounts lazily on first visit and remains mounted for that project session.
- Inactive project categories may be hidden/inert but cannot be unmounted solely because navigation changed.
- Settings owners mount when Settings opens and unmount on close so owner-defined close behavior clears secret inputs.
- Navigation stores no business draft, canonical DTO, retry/delete state, credential, or secret.
- Switching cannot implicitly save, discard, create a chapter, retry processing, or remove data.

## Async ordering

- Category/item state is latest-event-wins.
- Owner responses require an identity/generation fence; source pages also require current `sourceVersionId`.
- Removed items invalidate selection and all pending results before fallback renders.
- Source event gaps/resync requests discard incremental assumptions and re-read owner state.

## Focus and keyboard

- Standard Tab/Shift+Tab order moves category → list → main → Settings/other reachable controls.
- In wide mode, category/item activation keeps focus on its trigger for rapid scanning.
- Before hiding a focused region, move focus to a named visible fallback.
- Opening Settings records the Settings trigger and moves focus to its heading/first control. Closing restores the trigger or a stable project fallback.
- Escape is not a global navigation shortcut; existing Dialog/overlay owners retain Escape priority.

## Scroll

- Rail, context list, main detail, and Settings each have at most one primary named ScrollArea.
- Category changes preserve current-session list/detail scroll for already mounted owners; nothing is persisted.
- PDF preview may have one bounded named internal viewport. It must not force the outer detail back to top on processing updates.

## Icon placements

- 013 must add reviewed 012 placements for `sections-category`, `knowledge-base-category`, and `settings` in the category rail.
- The sidebar toggle is also a reviewed placement and must not use `⌘/Ctrl+B`; no global toggle shortcut is introduced in 013.
- Icon-only wide-rail usage requires 44 px target, accessible name, keyboard/hover tooltip, neighboring persistent category heading, and ambiguity review.
- Constrained command strip uses icon plus visible label.
- No visible AI agent placeholder, disabled item, or future category is permitted.
