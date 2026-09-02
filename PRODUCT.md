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
compact controls, clear typography, and Lucide icons. A global Menubar and the established
`sidebar-09` workspace shell are persistent. New surfaces extend those components and Tailwind
tokens; they do not introduce decorative gradients, bespoke cards, one-off shadows, or a parallel
component system.

## Current Delivery Boundary

Checkpoint 29 adds exact manuscript-wide literal Find and navigation. It reuses the current shell,
secondary sidebar, and editor rather than creating a standalone search page.
