# ADR 084: macOS Native Application Menu

Status: accepted
Date: 2026-09-21

## Decision

The user authorized moving macOS global commands into Electron's native application menu.
Windows and Linux retain the shadcn Menubar.
This replaces only ADR 083's requirement for an in-window Menubar on macOS.
Keep the native window frame.
The macOS window title shows the active project display name. If no project is open, it shows WriteLLM.

Main owns the fixed menu template, sender authorization, and project capability checks.
Preload exposes bounded Zod state and a command subscription. It does not expose arbitrary menu templates or code.
Both menus reuse command availability and existing Renderer actions.
Native accelerators handle migrated macOS shortcuts. Editor-specific shortcuts remain intact.
Project save/close and app quit retain existing flush and shutdown coordination.

## Consequences

Menu state exists only in memory. Reset it on navigation, renderer failure, and window closure.
If no window is open, New project, Open project, and Settings recreate the main window before dispatch.
Existing project and application databases need no migration. Lifecycle logs use the shared correlation context.

Duplicate menus waste workspace. A custom frameless titlebar adds drag and window-control complexity.
Neither alternative is adopted.
This maintenance does not start a new Phase or authorize signing, publication, or changes to other platforms.
