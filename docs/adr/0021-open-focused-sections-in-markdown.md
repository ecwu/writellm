---
id: ADR-0021
title: Open focused sections directly in Markdown
date: 2026-07-11
scope: project
initiative: DOC
project_prd: ../project-prd.md
initiative_prd: null
task_tracker: ../task-tracker.md
prd_decisions: [WLL-FR-002, WLL-FR-003]
related_tasks: [DOC-002]
depends_on: []
external_task_gates: []
supersedes: []
superseded_by: ADR-0022
decision_status: SUPERSEDED
implementation_status: IMPLEMENTED
last_updated: 2026-07-11
---

# ADR-0021: Open focused sections directly in Markdown

## Context

The workspace currently opens in a table-like section list even though composition navigation already exists in the persistent outline. Authors must take an extra action before reaching the primary Markdown authoring surface, and the list duplicates structure navigation and section metadata available elsewhere.

## Decision

Markdown is the default and only manuscript authoring view. Creating or opening a workspace and selecting any section in the composition outline opens that section directly in the Markdown editor. The separate section-list mode, its toggle option, renderer component, and dedicated styles are removed. Evidence coverage remains a distinct review mode, and the composition outline remains the place to navigate, create, and reorder sections.

## Alternatives considered

| Alternative | Why it was not selected |
| --- | --- |
| Keep the list but default to Markdown | Retains duplicated UI and an unsupported route that Product explicitly asked to remove. |
| Merge list metadata into the editor | Adds unrelated density to the focused authoring surface; metadata and structure remain available through the outline and inspector. |

## Consequences and constraints

- Workspace entry and outline navigation become one-step Markdown authoring flows.
- Evidence coverage remains reachable from the editor toggle and can return to Markdown.
- Section creation and ordering remain in the composition outline; this decision does not remove functional lists in knowledge, history, settings, or review workflows.
- When no section is focused, the workspace shows a small empty-state instruction rather than restoring a list fallback.

## Linked implementation work

| Task | Contribution to this decision |
| --- | --- |
| DOC-002 | Remove the list route and assets, set Markdown defaults, and verify renderer types/build behavior. |

### Completion conditions

- [x] No manuscript list mode, toggle, component, or dedicated list styles remain.
- [x] Opening a workspace and selecting an outline section resolve to Markdown.
- [x] Typecheck and relevant automated verification pass.

## Status history

| Date | Decision status | Implementation status | Change and evidence |
| --- | --- | --- | --- |
| 2026-07-11 | ACCEPTED | IN_PROGRESS | Product requested removal of all manuscript list views and direct Markdown entry; DOC-002 claimed for implementation. |
| 2026-07-11 | ACCEPTED | IMPLEMENTED | List mode and assets removed; Markdown is the initial and outline-selection destination. Typecheck, 59 unit tests, production build, and diff validation pass. |
| 2026-07-11 | SUPERSEDED | IMPLEMENTED | ADR-0022 replaces per-section physical Markdown storage with one block document; the focused authoring outcome remains, but the file-oriented implementation is retired. |
