# ADR 083: Tabbed Docking Workbench

Status: accepted
Date: 2026-09-19

Current rule: ADR 084 replaces the in-window macOS Menubar with the native application menu. Windows and Linux retain the shadcn Menubar.

## Decision

The user authorized replacing the fixed sidebar-09 composition.
The shell uses a persistent Menubar, activity rail, one central content tab group, and movable tool groups.
Dockview React 8.3.1 (MIT only) manages docking. shadcn new-york provides controls and themes.
Create each section editor when first opened. Retain one editor instance per section.
Only one content tab is visible. Knowledge, Preview, Assets, and Checks each have one tab.
Content cannot split or dock into tools.
Agent, Outline, Find, References, Writing Rules, and Comments can dock left, right, or below.
Do not add popout windows or Enterprise capabilities.

Each project session supports up to ten independent Notebook instances, each with an explicit notebookId.
This replaces ADR 058's single-conversation restriction.
Keep ADR 062's read-only tools and memory-only content.
The approved plan restores a shared three-slot Agent/Notebook admission limit at the Main model gateway.
This replaces ADR 074's removal of that limit.
Reject overflow immediately. Do not add a waiting queue.
Closing a Notebook destroys its state. Closing or switching projects revokes every instance.

Versioned local layout preferences live in app.sqlite settings, keyed by projectId.
Store only safe section IDs, content kinds, tool placement, ordering, and sizes.
Never persist Notebook state or tabs. If a layout is invalid, restore defaults.
Restoring a layout never starts provider work.

## Consequences

Preserve flush barriers, revision conflict checks, project capability revocation, renderer isolation, and diagnostics.
Before switching away from an editor, save its body and title. If saving fails, block navigation.
Layout reset preserves open content and live Notebook instances.
Every content navigation action opens the tab or activates its existing tab.

Alternatives were continuing custom resizable panels (requires implementing docking),
FlexLayout and Golden Layout. Dockview was selected for current npm adoption and sustained releases.
No project schema migration or portable layout files are needed.

## 2026-09-26 Tool-close sizing clarification

When a docked tool closes, give its released horizontal space to the retained content area.
Preserve the widths of surviving side groups where the grid permits it.
User-resized widths take precedence over defaults.
This rule applies during closing. Pointer and keyboard resizing remain available afterward.
Bottom groups that span the content can grow with it.
Closing the final content tab retains the existing empty content surface.

## 2026-10-05 Default tool tab placement

Outline, Find, References, Writing Rules, and Comments share an existing left tool group when opened.
If multiple left tool groups exist, choose the group closest to the content area.
Exclude bottom groups, right groups, and groups that contain Agent from this selection.
Add and activate the new tab without changing the group width.
If no eligible group exists, create a left group with the existing default width.
Opening an existing tool activates its tab without moving it.
Agent continues to open in its own right group by default.

Preserve saved layouts without automatic consolidation.
Users can still split, move, and resize tool groups.
Closing a tab removes only that tool.
Closing the final tab releases its group space to the content area under the sizing rule above.
New projects and layout reset retain left Outline, central content, and right Agent.
The existing layout schema supports grouped tabs without a migration.
