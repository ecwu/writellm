# WriteLLM Product Context

WriteLLM stores writing projects locally and opens one portable project at a time.
It combines a BlockNote manuscript editor, a project knowledge base, and a writing Agent.
The Agent proposes changes. Authors control whether each manuscript change is applied.

## Users And Work

The primary user is an author working for long periods on a structured manuscript. The interface
must support long desktop sessions, show information compactly, and support keyboard use.

WriteLLM is a desktop-only application. Mobile layouts and special narrow-window adaptation or
verification are outside the product scope. The configured desktop Agent sidebar must remain
usable, with its controls kept non-overlapping and its resize handle working.

## Product Principles

- Keep manuscript content and project state local and authoritative in the project container.
- Make navigation and editing immediate while presenting stale or incomplete states explicitly.
- Keep AI changes reviewable. The Agent proposes typed changes and never writes directly.
- Preserve context during workspace changes. Keep the editor mounted and preserve focus unless the action requires a change.

## Interface

The renderer uses the official shadcn/ui `new-york` preset, compact controls, clear typography, and Lucide icons.
Keep the global command menu and activity rail available.
Use the native menu on macOS and the shadcn Menubar on Windows and Linux.
Dockview React 8.3.1 provides one central content tab group and tools that dock left, right, or below.
Use these components and Tailwind tokens for new screens.
Do not add decorative gradients, custom cards, one-off shadows, or a separate component system.

## Workspace Navigation

Sections retain one editor per open tab. Knowledge, Preview, Assets, and Checks are singleton
content tabs; Each Notebook tab stores its state in memory. Closing the tab discards that state. Outline, Agent, Find,
References, Writing Rules, and Comments are movable tools. Local layouts restore per project and exclude Notebook sessions.
Current delivery state belongs in `docs/current-plan.md`.
The global Layout menu controls tool and content visibility, creates Notebooks, and restores
default tool placement. Layout controls do not occupy a separate toolbar above the tabs.

A fixed status bar spans the bottom of the active project, below the activity rail and all docked
tools. It opens Knowledge from index readiness, lists live Agent work and every open Notebook,
and navigates to the selected conversation or tab. It remains subscribed while tools are closed.
The right side shows saved chapter/full-manuscript word counts and the shared Autocomplete menu;
non-editor tabs show only manuscript counts. Character counts and detailed completion errors use
tooltips. The bar follows the existing theme and does not participate in saved docking layouts.
