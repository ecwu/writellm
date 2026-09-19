# ADR 083: Tabbed Docking Workbench

Status: accepted
Date: 2026-09-19

## Decision

The user authorized replacing the fixed sidebar-09 composition with a persistent Menubar,
activity rail, one central content tab group and movable tool groups. Dockview React 8.3.1
(MIT only) owns docking; shadcn new-york remains the control and theme language.
Sections are unique, lazy-created, retained editor instances; only one content tab is visible.
Knowledge, Preview, Assets and Checks are singleton tabs. Content cannot split or dock into tools.
Agent, Outline, Find, References, Writing Rules and Comments may dock left, right or below.
No popout windows or Enterprise capabilities are introduced.

Notebook becomes up to ten independent transient instances per project session, each with an
explicit notebookId. This supersedes ADR 058's single-conversation restriction; ADR 062's
read-only tool profile and memory-only content remain mandatory. The explicitly approved plan
restores a shared three-slot Agent/Notebook admission limit at the Main model gateway, superseding
ADR 074's quota removal. Overflow fails immediately; there is no waiting queue.
Closing a Notebook destroys its state; closing or switching projects revokes every instance.

Versioned local layout preferences live in app.sqlite settings, keyed by projectId. Only safe
section IDs, content kinds, tool placement, ordering and sizes are retained. Notebook state and
tabs never persist. Invalid layouts recover to defaults; restoring never starts provider work.

## Consequences

Preserve flush barriers, revision conflict checks, project capability revocation, renderer
isolation and diagnostics. Switching away from an editor first saves its body and title; a
failure blocks navigation. Layout reset preserves open content and live Notebook instances.
All content navigation shares open-or-activate semantics.

Alternatives were continuing bespoke resizable panels (requires implementing docking),
FlexLayout and Golden Layout. Dockview was selected for current npm adoption and sustained releases.
No project schema migration or portable layout files are needed.
