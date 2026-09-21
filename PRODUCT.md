# WriteLLM Product Context

WriteLLM is a local-first Electron writing application for one portable project at a time. Its
core working surface combines a BlockNote manuscript editor, a project knowledge base, and a
proposal-based writing Agent. Authors keep direct control of every manuscript mutation.

## Users And Use Scene

The primary user is an author working for long periods on a structured manuscript. The interface
must remain calm, dense enough for sustained desktop work, and keyboard-accessible.

WriteLLM is a desktop-only application. Mobile layouts and special narrow-window adaptation or
verification are outside the product scope. The configured desktop Agent sidebar must remain
usable, with its controls kept non-overlapping and its resize handle working.

## Product Principles

- Keep manuscript content and project state local and authoritative in the project container.
- Make navigation and editing immediate while presenting stale or incomplete states explicitly.
- Keep AI assistance reviewable: the Agent proposes typed changes and never writes directly.
- Preserve context during workspace changes; secondary tools should not unnecessarily unmount the
  editor or steal focus.

## Visual World

The renderer uses the official shadcn/ui `new-york` language with neutral application surfaces,
compact controls, clear typography, and Lucide icons. A global command menu (native on macOS, shadcn Menubar on Windows/Linux) and the established
activity rail are persistent. Dockview React 8.3.1 supplies one central content tab group and
dockable tools on the left, right, or bottom. New surfaces extend those components and Tailwind
tokens; they do not introduce decorative gradients, bespoke cards, one-off shadows, or a parallel
component system.

## Workspace Navigation

Sections retain one editor per open tab. Knowledge, Preview, Assets, and Checks are singleton
content tabs; Notebooks are independently disposable in-memory tabs. Outline, Agent, Find,
References, Writing Rules, and Comments are movable tools. Local layouts restore per project,
excluding Notebook sessions. Delivery evidence belongs in docs/current-plan.md.
The global Layout menu controls tool and content visibility, creates Notebooks, and restores
default tool placement. Layout controls do not occupy a separate toolbar above the tabs.

A fixed status bar spans the bottom of the active project, below the activity rail and all docked
tools. It opens Knowledge from index readiness, lists live Agent work and every open Notebook,
and navigates to the selected conversation or tab. It remains subscribed while tools are closed.
The right side shows saved chapter/full-manuscript word counts and the shared Autocomplete menu;
non-editor tabs show only manuscript counts. Character counts and detailed completion errors use
tooltips. The bar follows the existing theme and does not participate in saved docking layouts.
