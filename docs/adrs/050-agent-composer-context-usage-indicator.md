# ADR 050: Agent Composer Context Usage Indicator

Status: accepted for Checkpoint 55; implementation authorized
Date: 2026-08-18

## Context

The Agent Details dialog already reports the latest model request's context usage and context
window, but authors must leave the composer to inspect it. Hands-on use of the Codex composer
showed that a compact circular indicator beside the model summary makes this capacity visible
without adding another configuration control or disturbing the writing flow.

Usage and capacity are run-specific. Pairing the latest usage with the currently selected model's
window can report a false percentage after a model change, so the composer must not synthesize a
value from unrelated snapshots.

## Decision

Checkpoint 55 adds a read-only circular context-usage indicator immediately before the existing
model/Thinking trigger. It remains part of that elastic composer group and is not a fifth action.
The indicator appears only when the latest valid assistant usage can be paired with its originating
run and that run matches the conversation's current model selection. Unknown or mismatched usage is
hidden rather than presented as zero.

The neutral ring exposes its exact meaning through a hover/focus tooltip: whole-percent used and
left values plus compact used/window token counts. Estimated usage retains an explicit `~` marker.
The ring is keyboard-focusable, uses progress semantics, has no click action, and never changes to
warning colors. Agent Details keeps its existing usage presentation and consumes the same matched
snapshot so the two surfaces cannot disagree.

The ring stays fixed-width while the model label truncates first. Approval, model/Thinking, Send,
Queue, Steer, retry, and Stop behavior remain unchanged, including narrow-panel containment.

## Consequences

Context pressure becomes visible during ordinary writing without adding an IPC method, persisted
state, provider request, dependency, or model capability. The Renderer derives the snapshot from
existing assistant events and immutable run records. A model switch intentionally hides the last
model's ring until the newly selected model produces a trustworthy usage measurement.

## Alternatives Rejected

- Show an empty or zero-percent ring before the first response. This presents unknown usage as a
  measured value.
- Divide the latest usage by the current selection's catalog window. Tokenization and context
  limits belong to the originating run, so this can produce a false percentage after switching.
- Open Agent Details on click. The reference interaction is informational; adding navigation would
  make the status mark compete with the adjacent model control.
- Add threshold colors. The composer is a calm writing surface and the precise tooltip already
  communicates capacity without another warning system.
