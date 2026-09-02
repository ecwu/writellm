# ADR 039: Agent Approval Shorthand And Desktop Composer

Status: accepted for Checkpoint 48; implementation authorized; `Section` shorthand superseded by ADR 043
Date: 2026-08-13

## Context

ADR 038 replaced the separately visible Agent settings with one compact composer row, but the
first approval presentation used long action sentences such as `Approve eligible edits` plus a
shield icon. Hands-on use in the normal Agent panel width shows two problems: the long approval
trigger can collide with the model trigger, and the shield visually borrows Codex's automatic-
approval metaphor even when WriteLLM is in manual review mode.

WriteLLM already has three stable approval modes. Their existing short names are recognizable,
fit the operating surface, and do not need an icon to restate the concept. The menu can carry the
full policy explanation without placing it in the collapsed composer.

## Decision

The approval trigger and menu option titles use the same stable shorthand:

- `Manual`: review every proposed manuscript change.
- `Section`: automatically apply section edits and review other changes.
- `YOLO`: automatically apply all changes permitted by the existing Main-owned policy.

The collapsed trigger contains only the selected shorthand and a disclosure chevron. It has no
shield or replacement status icon. Its accessible name continues to identify it as the approval
policy selector, and the menu descriptions retain the behavioral truth that the shorthand omits.

The composer footer allocates width by priority. Add and approval remain compact, Send remains
fully visible, and the model/effort trigger owns the elastic middle space and truncates its visible
label when needed while keeping its complete accessible name. Composer controls must shrink
within their own boxes and must never paint over one another.

This amends ADR 038 only for approval naming, iconography, and desktop width allocation. The
persisted `manual`, `section_auto`, and `yolo` values, Main-owned eligibility and mandatory-review
rules, run snapshots, IPC, Agent tools, and model behavior do not change.

## Alternatives Considered

- Keep the long trigger and hide only the shield. This still leaves the collision and makes the
  most frequently scanned row read like an explanation instead of a compact state summary.
- Use `Manual`, `Section auto`, and `Auto`. This is more literal, but it discards the established
  `YOLO` vocabulary and makes the two automatic choices less immediately distinct.

## Consequences

The footer becomes shorter, calmer, and stable at the supplied panel width. Users rely on the
menu descriptions for exact policy details, while the trigger remains easy to scan. `YOLO` is an
interface label only and does not imply arbitrary computer, filesystem, shell, or network access.

Checkpoint 48 remains Renderer and documentation work only. No migration, dependency, provider
request, prompt, permission, worker, package, release, or hosted CI boundary changes.
