# ADR 084: macOS Native Application Menu

Status: accepted
Date: 2026-09-21

## Decision

The user authorized moving the macOS global command surface into Electron's native application
menu. Windows and Linux retain the shadcn Menubar. This narrowly supersedes ADR 083's requirement
for a persistent in-window Menubar on every platform. The native window frame remains; macOS
window titles use the active project display name, or WriteLLM when no project is open.

Main owns the fixed menu template, sender authorization and project capability checks. A bounded
Zod state projection and command subscription cross preload; no arbitrary menu templates or code
cross that boundary. Both presentations reuse command availability and existing Renderer actions.
Native accelerators own migrated macOS shortcuts, while editor-specific shortcuts remain intact.
Project save/close and app quit retain existing flush and shutdown coordination.

## Consequences

Menu state is ephemeral and reset on navigation, renderer failure and window closure. Windowless
New project, Open project and Settings recreate the main window before dispatch. Existing project
and application databases need no migration. Lifecycle logs use the shared correlation context.

Keeping duplicate menus wastes workspace; a custom frameless titlebar adds unnecessary drag and
window-control complexity. Neither alternative is adopted. This is maintenance, not a new Phase,
and does not authorize signing, publication or changes to other platforms.
