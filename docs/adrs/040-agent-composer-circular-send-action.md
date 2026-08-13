# ADR 040: Agent Composer Circular Send Action

Status: accepted for Checkpoint 48; implementation authorized
Date: 2026-08-13

## Context

The Checkpoint 48 composer still presents its primary idle Send action as a paper-plane icon plus
the word `Send`. Hands-on comparison with the supplied Codex reference shows that this occupies
more of the constrained footer than necessary and gives the primary action the same horizontal
shape as configuration controls.

The user's reference uses a filled circular button with an upward arrow. This is recognizable as
the final submit action, keeps the footer compact, and creates a clear endpoint after the model
selector. WriteLLM must retain an explicit accessible name and must not blur the distinct Queue,
Steer, and Stop actions shown while a run is active.

## Decision

When the Agent is idle, the primary submit control is an icon-only circular shadcn Button using
the Lucide `ArrowUp` icon. It retains `aria-label="Send"`, the existing enablement conditions,
keyboard focus treatment, click behavior, and test identifier through its accessible role. The
button uses the established primary and disabled color tokens; no one-off color, shadow, or
animation is introduced.

The running-state Queue, Queue/Steer disclosure, retry, and Stop controls do not adopt the arrow
button. Their different labels and shapes continue to communicate that they modify or control an
existing run rather than start a new one.

This amends ADRs 038 and 039 only for the idle Send affordance. Agent submission, run lifecycle,
capacity checks, incompatible-session handling, IPC, persistence, and provider behavior do not
change.

## Alternatives Considered

- Keep the paper-plane icon and remove only the word. The plane reads as message transport but is
  visually less direct than the supplied upward-submit reference and retains the old metaphor.
- Apply the circular arrow to Queue as well. This would hide the important difference between
  starting a run and queuing or steering an active run.
- Hand-author a larger custom control. The official shadcn icon button already provides the needed
  states and focus behavior, so a parallel primitive would be unnecessary.

## Consequences

The footer gains a compact, visually dominant endpoint and more room for the model label. The
visible button no longer contains the word `Send`, so its accessible name and tooltip semantics
must remain stable and covered by runtime tests.

Checkpoint 48 remains Renderer and documentation work only. No migration, dependency, provider
request, prompt, permission, worker, package, release, or hosted CI boundary changes.
